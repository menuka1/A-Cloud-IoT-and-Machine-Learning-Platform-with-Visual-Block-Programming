'use strict';
const { WebSocketServer } = require('ws');
const { get, all, run } = require('./db');
const { verifyToken } = require('./auth');
const ml = require('./ml');

// ---------- realtime (browser dashboards) ----------
const clients = new Map(); // ws -> userId
function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws) => {
    const kill = setTimeout(() => { if (!clients.has(ws)) ws.close(4001, 'auth timeout'); }, 8000);
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw);
        if (m.type === 'auth') { const u = verifyToken(m.token); if (!u) return ws.close(4003, 'bad token'); clients.set(ws, u.id); ws.send(JSON.stringify({ type: 'ready' })); }
      } catch {}
    });
    ws.on('close', () => { clearTimeout(kill); clients.delete(ws); });
    ws.on('error', () => {});
  });
  return wss;
}
function push(userId, event) {
  const msg = JSON.stringify(event);
  for (const [ws, uid] of clients) if (uid === userId && ws.readyState === 1) ws.send(msg);
}

// ---------- ingest pipeline ----------
const KEY_RE = /^[A-Za-z0-9_.\-]{1,40}$/;
function sanitize(payload) {
  const out = {}; let n = 0;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return out;
  for (const [k, v] of Object.entries(payload)) {
    if (!KEY_RE.test(k) || n >= 50) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= 200) { const num = v.trim() !== '' && Number.isFinite(+v) ? +v : v; out[k] = num; }
    else continue;
    n++;
  }
  return out;
}

const insertCount = new Map();
const cooldown = new Map();
function ingest(device, payload, source = 'http') {
  const data = sanitize(payload);
  if (!Object.keys(data).length) throw Object.assign(new Error('No valid fields in payload (use flat JSON like {"temp":24.5})'), { status: 400 });
  const ts = Date.now();
  run('INSERT INTO readings (device_id, ts, data) VALUES (?,?,?)', device.id, ts, JSON.stringify(data));
  run('UPDATE devices SET last_seen = ? WHERE id = ?', ts, device.id);
  const c = (insertCount.get(device.id) || 0) + 1; insertCount.set(device.id, c);
  if (c % 200 === 0) run('DELETE FROM readings WHERE device_id = ? AND id NOT IN (SELECT id FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT 20000)', device.id, device.id);

  push(device.user_id, { type: 'reading', deviceId: device.id, ts, data, source });
  try { evaluateRules(device, data, ts); } catch (e) { console.error('rules:', e.message); }
  try { runAutoModels(device, data, ts); } catch (e) { console.error('automl:', e.message); }
  return { ts, stored: Object.keys(data).length };
}

function createAlert(userId, deviceId, level, message) {
  const ts = Date.now();
  const r = run('INSERT INTO alerts (user_id, device_id, level, message, ts) VALUES (?,?,?,?,?)', userId, deviceId, level, message, ts);
  push(userId, { type: 'alert', id: Number(r.lastInsertRowid), deviceId, level, message, ts });
}

const OPS = { '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a == b, '!=': (a, b) => a != b }; // eslint-disable-line eqeqeq
function evaluateRules(device, data, ts) {
  for (const r of all('SELECT * FROM rules WHERE device_id = ? AND enabled = 1', device.id)) {
    const v = ml.toNum(data[r.field]); if (Number.isNaN(v) || !OPS[r.op] || !OPS[r.op](v, r.threshold)) continue;
    if (ts - r.last_fired < 60000) continue;
    run('UPDATE rules SET last_fired = ? WHERE id = ?', ts, r.id);
    createAlert(device.user_id, device.id, 'warning', r.message || `${device.name}: ${r.field} ${r.op} ${r.threshold} (value ${v})`);
    if (r.cmd_name) sendCommand(device, r.cmd_name, r.cmd_value);
  }
}

function runAutoModels(device, data, ts) {
  for (const m of all("SELECT * FROM ml_models WHERE auto_device_id = ? AND status = 'trained'", device.id)) {
    const state = JSON.parse(m.state);
    const feats = state.features; if (!feats.every((f) => !Number.isNaN(ml.toNum(data[f])))) continue;
    const output = ml.predict(m.algorithm, state, m.algorithm === 'forecast' ? { steps: 5 } : data);
    run('INSERT INTO predictions (model_id, device_id, ts, input, output) VALUES (?,?,?,?,?)', m.id, device.id, ts, JSON.stringify(data), JSON.stringify(output));
    if (Math.random() < 0.02) run('DELETE FROM predictions WHERE model_id = ? AND id NOT IN (SELECT id FROM predictions WHERE model_id = ? ORDER BY id DESC LIMIT 2000)', m.id, m.id);
    push(device.user_id, { type: 'prediction', modelId: m.id, deviceId: device.id, ts, output });
    if (output.anomaly === true) {
      const k = 'a' + m.id; if (ts - (cooldown.get(k) || 0) > 60000) { cooldown.set(k, ts); createAlert(device.user_id, device.id, 'critical', `ML "${m.name}": anomaly on ${device.name} (score ${output.score}, ${output.worstFeature})`); }
    }
  }
}

// ---------- commands (dashboard -> device) ----------
const hooks = { mqttDeliver: null };
function sendCommand(device, name, value) {
  const ts = Date.now();
  const r = run('INSERT INTO commands (device_id, name, value, created_at) VALUES (?,?,?,?)', device.id, String(name).slice(0, 40), String(value).slice(0, 200), ts);
  const id = Number(r.lastInsertRowid);
  if (hooks.mqttDeliver && hooks.mqttDeliver(device, { id, name, value: String(value) })) run("UPDATE commands SET status = 'sent' WHERE id = ?", id);
  push(device.user_id, { type: 'command', deviceId: device.id, name, value, ts });
  return id;
}
function takePendingCommands(device) {
  const cmds = all("SELECT id, name, value FROM commands WHERE device_id = ? AND status = 'pending' ORDER BY id LIMIT 50", device.id);
  for (const c of cmds) run("UPDATE commands SET status = 'sent' WHERE id = ?", c.id);
  return cmds;
}

const isOnline = (d) => !!d.last_seen && Date.now() - d.last_seen < 90000;

module.exports = { attachWebSocket, push, ingest, sendCommand, takePendingCommands, createAlert, hooks, isOnline, sanitize };
