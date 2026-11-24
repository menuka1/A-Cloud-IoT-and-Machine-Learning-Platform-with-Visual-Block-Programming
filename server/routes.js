'use strict';
const express = require('express');
const { get, all, run, tx } = require('./db');
const auth = require('./auth');
const svc = require('./services');
const ml = require('./ml');
const builder = require('./builder');

const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intId = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw bad('Invalid id'); return n; };

// ================= AUTH =================
const authLimiter = auth.rateLimit({ windowMs: 15 * 60 * 1000, max: 40, keyFn: (r) => 'auth:' + r.ip });
api.post('/auth/register', authLimiter, wrap((req, res) => {
  const name = str(req.body.name, 60), email = str(req.body.email, 120).toLowerCase(), pw = typeof req.body.password === 'string' ? req.body.password : '';
  if (name.length < 2) throw bad('Name must be at least 2 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw bad('Enter a valid email address');
  if (pw.length < 8 || pw.length > 128) throw bad('Password must be 8-128 characters');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password needs at least one letter and one number');
  if (get('SELECT id FROM users WHERE email = ?', email)) throw bad('An account with this email already exists', 409);
  const r = run('INSERT INTO users (name, email, password_hash, created_at) VALUES (?,?,?,?)', name, email, auth.hashPassword(pw), Date.now());
  const user = { id: Number(r.lastInsertRowid), name, email };
  const d = run('INSERT INTO dashboards (user_id, name, created_at) VALUES (?,?,?)', user.id, 'My Dashboard', Date.now());
  res.status(201).json({ token: auth.signToken(user), user });
}));
api.post('/auth/login', authLimiter, wrap((req, res) => {
  const email = str(req.body.email, 120).toLowerCase(), pw = typeof req.body.password === 'string' ? req.body.password : '';
  const u = get('SELECT * FROM users WHERE email = ?', email);
  if (!u || !auth.checkPassword(pw, u.password_hash)) throw bad('Wrong email or password', 401);
  res.json({ token: auth.signToken(u), user: { id: u.id, name: u.name, email: u.email } });
}));
api.get('/auth/me', auth.requireUser, (req, res) => res.json({ user: req.user }));
api.put('/auth/password', auth.requireUser, authLimiter, wrap((req, res) => {
  const { current, next } = req.body; const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!auth.checkPassword(String(current || ''), u.password_hash)) throw bad('Current password is wrong', 401);
  if (typeof next !== 'string' || next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) throw bad('New password must be 8+ chars with a letter and a number');
  run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(next), u.id); res.json({ ok: true });
}));

// ================= DEVICE-FACING (token auth) =================
const deviceLimiter = auth.rateLimit({ windowMs: 60 * 1000, max: 240, keyFn: (r) => 'dev:' + (r.deviceToken || r.ip) });
function deviceAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = req.headers['x-device-token'] || (h.startsWith('Bearer ') ? h.slice(7) : '') || req.query.token;
  const dev = typeof token === 'string' && token ? get('SELECT * FROM devices WHERE token = ?', token) : null;
  if (!dev) return res.status(401).json({ error: 'Invalid device token' });
  req.device = dev; req.deviceToken = token; next();
}
api.post('/ingest', deviceAuth, deviceLimiter, wrap((req, res) => res.json({ ok: true, ...svc.ingest(req.device, req.body) })));
api.get('/ingest', deviceAuth, deviceLimiter, wrap((req, res) => { const { token, ...rest } = req.query; res.json({ ok: true, ...svc.ingest(req.device, rest) }); })); // GET for very simple boards
api.get('/device/commands', deviceAuth, deviceLimiter, (req, res) => {
  run('UPDATE devices SET last_seen = ? WHERE id = ?', Date.now(), req.device.id);
  res.json({ commands: svc.takePendingCommands(req.device) });
});

// ml predict accepts a device token OR a user JWT
api.post('/ml/models/:id/predict', wrap((req, res) => {
  const id = intId(req.params.id); let ownerId;
  const h = req.headers.authorization || ''; const tok = req.headers['x-device-token'] || (h.startsWith('Bearer ') ? h.slice(7) : '');
  if (typeof tok === 'string' && tok.startsWith('tr_')) { const d = get('SELECT * FROM devices WHERE token = ?', tok); if (!d) throw bad('Invalid device token', 401); ownerId = d.user_id; }
  else { const u = tok ? auth.verifyToken(tok) : null; if (!u) throw bad('Not authenticated', 401); ownerId = u.id; }
  const m = get('SELECT * FROM ml_models WHERE id = ? AND user_id = ?', id, ownerId);
  if (!m) throw bad('Model not found', 404); if (m.status !== 'trained') throw bad('Model is not trained yet', 409);
  try { res.json({ model: m.name, output: ml.predict(m.algorithm, JSON.parse(m.state), req.body.inputs || req.body) }); }
  catch (e) { throw bad(e.message); }
}));

// ================= everything below needs a logged-in user =================
api.use(auth.requireUser);

function ownDevice(req) { const d = get('SELECT * FROM devices WHERE id = ? AND user_id = ?', intId(req.params.id), req.user.id); if (!d) throw bad('Device not found', 404); return d; }
const devView = (d, withToken = true) => ({ id: d.id, name: d.name, board: d.board, description: d.description, token: withToken ? d.token : undefined, last_seen: d.last_seen, online: svc.isOnline(d), created_at: d.created_at });
const BOARDS = ['esp32', 'esp8266', 'arduino', 'raspberry-pico-w', 'raspberry-pi', 'stm32', 'other'];

api.get('/overview', (req, res) => {
  const uid = req.user.id;
  const devices = all('SELECT * FROM devices WHERE user_id = ?', uid);
  res.json({
    devices: devices.length, online: devices.filter(svc.isOnline).length,
    readings: get('SELECT COUNT(*) c FROM readings WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?)', uid).c,
    models: get('SELECT COUNT(*) c FROM ml_models WHERE user_id = ?', uid).c,
    unseenAlerts: get('SELECT COUNT(*) c FROM alerts WHERE user_id = ? AND seen = 0', uid).c,
  });
});

// ---- devices ----
api.get('/devices', (req, res) => {
  res.json(all('SELECT * FROM devices WHERE user_id = ? ORDER BY id DESC', req.user.id).map((d) => {
    const last = get('SELECT ts, data FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT 1', d.id);
    return { ...devView(d), latest: last ? { ts: last.ts, data: JSON.parse(last.data) } : null };
  }));
});
api.post('/devices', wrap((req, res) => {
  const name = str(req.body.name, 60); if (name.length < 2) throw bad('Device name needs at least 2 characters');
  if (get('SELECT COUNT(*) c FROM devices WHERE user_id = ?', req.user.id).c >= 50) throw bad('Device limit reached (50)');
  const board = BOARDS.includes(req.body.board) ? req.body.board : 'other';
  const r = run('INSERT INTO devices (user_id, name, board, description, token, created_at) VALUES (?,?,?,?,?,?)', req.user.id, name, board, str(req.body.description, 300), auth.newDeviceToken(), Date.now());
  res.status(201).json(devView(get('SELECT * FROM devices WHERE id = ?', Number(r.lastInsertRowid))));
}));
api.put('/devices/:id', wrap((req, res) => {
  const d = ownDevice(req); const name = str(req.body.name, 60) || d.name;
  run('UPDATE devices SET name = ?, board = ?, description = ? WHERE id = ?', name, BOARDS.includes(req.body.board) ? req.body.board : d.board, req.body.description === undefined ? d.description : str(req.body.description, 300), d.id);
  res.json(devView(get('SELECT * FROM devices WHERE id = ?', d.id)));
}));
api.delete('/devices/:id', wrap((req, res) => { const d = ownDevice(req); run('DELETE FROM devices WHERE id = ?', d.id); res.json({ ok: true }); }));
api.post('/devices/:id/regenerate-token', wrap((req, res) => { const d = ownDevice(req); run('UPDATE devices SET token = ? WHERE id = ?', auth.newDeviceToken(), d.id); res.json(devView(get('SELECT * FROM devices WHERE id = ?', d.id))); }));
api.get('/devices/:id/readings', wrap((req, res) => {
  const d = ownDevice(req); const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 5000); const since = parseInt(req.query.since) || 0;
  const rows = all('SELECT ts, data FROM readings WHERE device_id = ? AND ts > ? ORDER BY id DESC LIMIT ?', d.id, since, limit).reverse();
  res.json(rows.map((r) => ({ ts: r.ts, data: JSON.parse(r.data) })));
}));
api.get('/devices/:id/fields', wrap((req, res) => {
  const d = ownDevice(req); const f = {};
  for (const r of all('SELECT data FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT 200', d.id)) for (const [k, v] of Object.entries(JSON.parse(r.data))) f[k] ||= typeof v;
  res.json(Object.entries(f).map(([name, type]) => ({ name, type })));
}));
api.delete('/devices/:id/readings', wrap((req, res) => { const d = ownDevice(req); run('DELETE FROM readings WHERE device_id = ?', d.id); res.json({ ok: true }); }));
api.get('/devices/:id/export.csv', wrap((req, res) => {
  const d = ownDevice(req); const rows = all('SELECT ts, data FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT 50000', d.id).reverse().map((r) => ({ ts: r.ts, ...JSON.parse(r.data) }));
  const cols = ['ts', ...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k !== 'ts')))];
  const cell = (v) => { if (v === undefined) return ''; let s = String(v); if (/^[=+\-@]/.test(s) && typeof v === 'string') s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  res.type('text/csv').attachment(`${d.name.replace(/[^\w.-]+/g, '_')}.csv`).send([cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n'));
}));
api.post('/devices/:id/commands', wrap((req, res) => {
  const d = ownDevice(req); const name = str(req.body.name, 40); if (!/^[\w.-]+$/.test(name)) throw bad('Command name: letters, numbers, _ . - only');
  const v = req.body.value; if (v === undefined || v === null) throw bad('Missing value');
  res.json({ ok: true, id: svc.sendCommand(d, name, v) });
}));

// ---- dashboards & widgets ----
const WIDGETS = ['value', 'gauge', 'line', 'bar', 'switch', 'slider', 'status', 'ml', 'log'];
const loadDash = (d) => ({ ...d, widgets: all('SELECT * FROM widgets WHERE dashboard_id = ? ORDER BY id', d.id).map((w) => ({ ...w, config: JSON.parse(w.config) })) });
function ownDash(req, id = req.params.id) { const d = get('SELECT * FROM dashboards WHERE id = ? AND user_id = ?', intId(id), req.user.id); if (!d) throw bad('Dashboard not found', 404); return d; }
api.get('/dashboards', (req, res) => {
  let ds = all('SELECT * FROM dashboards WHERE user_id = ? ORDER BY id', req.user.id);
  if (!ds.length) { const r = run('INSERT INTO dashboards (user_id, name, created_at) VALUES (?,?,?)', req.user.id, 'My Dashboard', Date.now()); ds = all('SELECT * FROM dashboards WHERE id = ?', Number(r.lastInsertRowid)); }
  res.json(ds.map(loadDash));
});
api.post('/dashboards', wrap((req, res) => {
  const name = str(req.body.name, 60); if (!name) throw bad('Dashboard name required');
  if (get('SELECT COUNT(*) c FROM dashboards WHERE user_id = ?', req.user.id).c >= 20) throw bad('Dashboard limit reached (20)');
  const r = run('INSERT INTO dashboards (user_id, name, created_at) VALUES (?,?,?)', req.user.id, name, Date.now()); res.status(201).json(loadDash(get('SELECT * FROM dashboards WHERE id = ?', Number(r.lastInsertRowid))));
}));
api.put('/dashboards/:id', wrap((req, res) => { const d = ownDash(req); const n = str(req.body.name, 60); if (!n) throw bad('Name required'); run('UPDATE dashboards SET name = ? WHERE id = ?', n, d.id); res.json({ ok: true }); }));
api.delete('/dashboards/:id', wrap((req, res) => { const d = ownDash(req); run('DELETE FROM dashboards WHERE id = ?', d.id); res.json({ ok: true }); }));

function widgetBody(req) {
  const type = req.body.type; if (!WIDGETS.includes(type)) throw bad('Unknown widget type');
  const c = req.body.config || {}; const config = {};
  for (const k of ['deviceId', 'modelId', 'min', 'max', 'points', 'offValue', 'onValue', 'step']) if (c[k] !== undefined && c[k] !== '') config[k] = Number.isNaN(+c[k]) ? c[k] : +c[k];
  for (const k of ['field', 'command', 'unit', 'outputKey', 'color']) if (typeof c[k] === 'string') config[k] = c[k].slice(0, 40);
  if (config.deviceId !== undefined && !get('SELECT id FROM devices WHERE id = ? AND user_id = ?', config.deviceId, req.user.id)) throw bad('Device not found');
  if (config.modelId !== undefined && !get('SELECT id FROM ml_models WHERE id = ? AND user_id = ?', config.modelId, req.user.id)) throw bad('Model not found');
  return { type, title: str(req.body.title, 60) || type, size: ['s', 'm', 'l'].includes(req.body.size) ? req.body.size : 'm', config };
}
api.post('/dashboards/:id/widgets', wrap((req, res) => {
  const d = ownDash(req); const w = widgetBody(req);
  if (get('SELECT COUNT(*) c FROM widgets WHERE dashboard_id = ?', d.id).c >= 60) throw bad('Widget limit reached (60)');
  const r = run('INSERT INTO widgets (dashboard_id, type, title, config, size, created_at) VALUES (?,?,?,?,?,?)', d.id, w.type, w.title, JSON.stringify(w.config), w.size, Date.now());
  res.status(201).json({ id: Number(r.lastInsertRowid), dashboard_id: d.id, ...w });
}));
api.delete('/widgets/:id', wrap((req, res) => {
  const w = get('SELECT w.id FROM widgets w JOIN dashboards d ON d.id = w.dashboard_id WHERE w.id = ? AND d.user_id = ?', intId(req.params.id), req.user.id);
  if (!w) throw bad('Widget not found', 404); run('DELETE FROM widgets WHERE id = ?', w.id); res.json({ ok: true });
}));

// ---- ML ----
api.get('/ml/algorithms', (req, res) => res.json(ml.listAlgorithms()));
const modelView = (m) => ({ id: m.id, name: m.name, algorithm: m.algorithm, config: JSON.parse(m.config), metrics: m.metrics ? JSON.parse(m.metrics) : null, status: m.status, auto_device_id: m.auto_device_id, trained_at: m.trained_at, created_at: m.created_at });
function ownModel(req) { const m = get('SELECT * FROM ml_models WHERE id = ? AND user_id = ?', intId(req.params.id), req.user.id); if (!m) throw bad('Model not found', 404); return m; }
api.get('/ml/models', (req, res) => res.json(all('SELECT * FROM ml_models WHERE user_id = ? ORDER BY id DESC', req.user.id).map(modelView)));
api.post('/ml/csv-preview', wrap((req, res) => {
  let rows; try { rows = ml.parseCSV(String(req.body.csv || '')); } catch (e) { throw bad(e.message); }
  res.json({ rows: rows.length, columns: Object.keys(rows[0]).map((name) => ({ name, numeric: rows.every((r) => typeof r[name] === 'number') })), sample: rows.slice(0, 5) });
}));
api.post('/ml/models', wrap((req, res) => {
  const name = str(req.body.name, 60); if (name.length < 2) throw bad('Model name needs at least 2 characters');
  if (get('SELECT COUNT(*) c FROM ml_models WHERE user_id = ?', req.user.id).c >= 30) throw bad('Model limit reached (30)');
  let cfg; try { cfg = ml.validateConfig(req.body.algorithm, req.body.config || {}); } catch (e) { throw bad(e.message); }
  const r = run('INSERT INTO ml_models (user_id, name, algorithm, config, created_at) VALUES (?,?,?,?,?)', req.user.id, name, req.body.algorithm, JSON.stringify(cfg), Date.now());
  res.status(201).json(modelView(get('SELECT * FROM ml_models WHERE id = ?', Number(r.lastInsertRowid))));
}));
api.post('/ml/models/:id/train', wrap((req, res) => {
  const m = ownModel(req); const cfg = JSON.parse(m.config); const src = req.body.source || {}; let rows;
  if (src.type === 'csv') { if (String(src.csv || '').length > 2_000_000) throw bad('CSV too large (max 2 MB)'); try { rows = ml.parseCSV(src.csv); } catch (e) { throw bad(e.message); } }
  else if (src.type === 'device') {
    const dev = get('SELECT * FROM devices WHERE id = ? AND user_id = ?', intId(src.deviceId), req.user.id); if (!dev) throw bad('Device not found', 404);
    rows = all('SELECT ts, data FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT ?', dev.id, Math.min(parseInt(src.limit) || 5000, 20000)).reverse().map((r) => ({ ...JSON.parse(r.data), __ts: r.ts }));
  } else throw bad('Choose a training source: a device or a CSV');
  if (!rows.length) throw bad('That source has no data yet');
  let out; const t0 = Date.now();
  try { out = ml.train(m.algorithm, cfg, rows); } catch (e) { throw bad(e.message); }
  const metrics = { ...out.metrics, trainMs: Date.now() - t0 };
  run("UPDATE ml_models SET state = ?, metrics = ?, status = 'trained', trained_at = ? WHERE id = ?", JSON.stringify(out.state), JSON.stringify(metrics), Date.now(), m.id);
  res.json(modelView(get('SELECT * FROM ml_models WHERE id = ?', m.id)));
}));
api.put('/ml/models/:id', wrap((req, res) => {
  const m = ownModel(req); let auto = m.auto_device_id;
  if (req.body.autoDeviceId !== undefined) { if (req.body.autoDeviceId === null || req.body.autoDeviceId === '') auto = null; else { const d = get('SELECT id FROM devices WHERE id = ? AND user_id = ?', intId(req.body.autoDeviceId), req.user.id); if (!d) throw bad('Device not found'); auto = d.id; } }
  run('UPDATE ml_models SET name = ?, auto_device_id = ? WHERE id = ?', str(req.body.name, 60) || m.name, auto, m.id); res.json(modelView(get('SELECT * FROM ml_models WHERE id = ?', m.id)));
}));
api.delete('/ml/models/:id', wrap((req, res) => { const m = ownModel(req); run('DELETE FROM ml_models WHERE id = ?', m.id); res.json({ ok: true }); }));
api.get('/ml/models/:id/export', wrap((req, res) => { const m = ownModel(req); if (!m.state) throw bad('Train the model first', 409); res.attachment(`${m.name.replace(/[^\w.-]+/g, '_')}.json`).json({ name: m.name, algorithm: m.algorithm, state: JSON.parse(m.state) }); }));
api.get('/ml/models/:id/predictions', wrap((req, res) => { const m = ownModel(req); res.json(all('SELECT ts, device_id, input, output FROM predictions WHERE model_id = ? ORDER BY id DESC LIMIT ?', m.id, Math.min(parseInt(req.query.limit) || 50, 500)).reverse().map((p) => ({ ts: p.ts, device_id: p.device_id, input: JSON.parse(p.input), output: JSON.parse(p.output) }))); }));

// ---- visual builder (drag & drop code generator) ----
const baseCatalog = builder.catalog();
const userCustom = (uid) => all('SELECT * FROM custom_parts WHERE user_id = ? ORDER BY id', uid);
api.get('/builder/catalog', (req, res) => res.json(builder.catalog(userCustom(req.user.id))));
const builderCatalog = baseCatalog; // used for target checks below

// ---- My Kit: chosen board + owned parts; custom parts ----
const partIds = new Set(builder.lib.libraryMeta().parts.map((p) => p.id));
api.get('/kit', (req, res) => { const k = get('SELECT * FROM kits WHERE user_id = ?', req.user.id); res.json({ boardId: k?.board_id || '', parts: k ? JSON.parse(k.parts) : [], configured: !!k }); });
api.put('/kit', wrap((req, res) => {
  const boardId = typeof req.body.boardId === 'string' ? req.body.boardId : ''; const b = boardId ? builder.lib.boardById(boardId) : null;
  if (boardId && !b) throw bad('Unknown board'); if (b && !b.ready) throw bad(b.name + ' cannot generate code yet - pick a ready board or the simulator');
  const mine = new Set(userCustom(req.user.id).map((c) => 'cp_' + c.id));
  const list = [...new Set(Array.isArray(req.body.parts) ? req.body.parts.map(String) : [])].filter((id) => partIds.has(id) || mine.has(id));
  if (list.length > 500) throw bad('Too many parts');
  run('INSERT INTO kits (user_id, board_id, parts, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET board_id = excluded.board_id, parts = excluded.parts, updated_at = excluded.updated_at', req.user.id, boardId, JSON.stringify(list), Date.now());
  res.json({ boardId, parts: list, configured: true });
}));
api.get('/custom-parts', (req, res) => res.json(userCustom(req.user.id).map((c) => ({ ...c, params: JSON.parse(c.params) }))));
api.post('/custom-parts', wrap((req, res) => {
  const name = str(req.body.name, 50); if (name.length < 2) throw bad('Give your part a name (2+ letters)');
  const kind = req.body.kind; if (!builder.lib.CUSTOM_KINDS[kind]) throw bad('Choose what kind of part it is');
  const v = str(req.body.var, 24).toLowerCase(); if (v && !/^[a-z][a-z0-9_]{0,23}$/.test(v)) throw bad('Variable name: lowercase letters, digits and _');
  const p = req.body.params && typeof req.body.params === 'object' ? req.body.params : {}; const params = {};
  if (kind === 'analog') { params.mult = Number.isFinite(+p.mult) && p.mult !== '' ? +p.mult : 1; params.add = Number.isFinite(+p.add) && p.add !== '' ? +p.add : 0; }
  if (kind === 'digital_in') { params.active = p.active === 'low' ? 'low' : 'high'; params.pull = p.pull === 'up' ? 'up' : 'none'; }
  if (kind === 'digital_out') params.trigger = p.trigger === 'low' ? 'low' : 'high';
  params.note = str(String(p.note || ''), 200).replace(/[^\x20-\x7e]/g, '');
  if (get('SELECT COUNT(*) c FROM custom_parts WHERE user_id = ?', req.user.id).c >= 50) throw bad('Custom part limit reached (50)');
  const r = run('INSERT INTO custom_parts (user_id, name, kind, var, params, created_at) VALUES (?,?,?,?,?,?)', req.user.id, name, kind, v, JSON.stringify(params), Date.now());
  const c = get('SELECT * FROM custom_parts WHERE id = ?', Number(r.lastInsertRowid)); res.status(201).json({ ...c, params });
}));
api.delete('/custom-parts/:id', wrap((req, res) => {
  const id = intId(req.params.id); const r = run('DELETE FROM custom_parts WHERE id = ? AND user_id = ?', id, req.user.id); if (!r.changes) throw bad('Part not found', 404);
  const k = get('SELECT * FROM kits WHERE user_id = ?', req.user.id); if (k) run('UPDATE kits SET parts = ? WHERE user_id = ?', JSON.stringify(JSON.parse(k.parts).filter((x) => x !== 'cp_' + id)), req.user.id);
  res.json({ ok: true });
}));
const projView = (p) => ({ id: p.id, name: p.name, target: p.target, device_id: p.device_id, program: JSON.parse(p.program), updated_at: p.updated_at });
function projBody(req) {
  const name = str(req.body.name, 60); if (name.length < 2) throw bad('Project name needs at least 2 characters');
  if (!builderCatalog.targets[req.body.target]) throw bad('Unknown board / language');
  const pr = req.body.program; if (!pr || typeof pr !== 'object') throw bad('Missing program');
  const json = JSON.stringify(builder.normalize(pr)); if (json.length > 400000) throw bad('Program too large');
  let deviceId = null; if (req.body.deviceId) { const d = get('SELECT id FROM devices WHERE id = ? AND user_id = ?', intId(req.body.deviceId), req.user.id); if (!d) throw bad('Device not found'); deviceId = d.id; }
  return { name, target: req.body.target, json, deviceId };
}
api.get('/projects', (req, res) => res.json(all('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC', req.user.id).map(projView)));
api.post('/projects', wrap((req, res) => {
  const b = projBody(req); if (get('SELECT COUNT(*) c FROM projects WHERE user_id = ?', req.user.id).c >= 100) throw bad('Project limit reached (100)');
  const now = Date.now(); const r = run('INSERT INTO projects (user_id, name, target, device_id, program, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', req.user.id, b.name, b.target, b.deviceId, b.json, now, now);
  res.status(201).json(projView(get('SELECT * FROM projects WHERE id = ?', Number(r.lastInsertRowid))));
}));
api.put('/projects/:id', wrap((req, res) => {
  const p = get('SELECT * FROM projects WHERE id = ? AND user_id = ?', intId(req.params.id), req.user.id); if (!p) throw bad('Project not found', 404);
  const b = projBody(req); run('UPDATE projects SET name = ?, target = ?, device_id = ?, program = ?, updated_at = ? WHERE id = ?', b.name, b.target, b.deviceId, b.json, Date.now(), p.id);
  res.json(projView(get('SELECT * FROM projects WHERE id = ?', p.id)));
}));
api.delete('/projects/:id', wrap((req, res) => { const r = run('DELETE FROM projects WHERE id = ? AND user_id = ?', intId(req.params.id), req.user.id); if (!r.changes) throw bad('Project not found', 404); res.json({ ok: true }); }));
// Wi-Fi credentials are only used to build the code in this response - they are never stored.
api.post('/builder/generate', wrap((req, res) => {
  const { target, program, settings, name } = req.body; if (!program || typeof program !== 'object') throw bad('Missing program');
  let token = null; if (req.body.deviceId) { const d = get('SELECT * FROM devices WHERE id = ? AND user_id = ?', intId(req.body.deviceId), req.user.id); if (!d) throw bad('Device not found', 404); token = d.token; }
  const s = settings && typeof settings === 'object' ? settings : {};
  res.json(builder.generate({ target, program, settings: { wifiSsid: str(s.wifiSsid, 40), wifiPass: typeof s.wifiPass === 'string' ? s.wifiPass.slice(0, 70) : '', serverUrl: str(s.serverUrl, 200) }, token, name, boardId: typeof req.body.boardId === 'string' ? req.body.boardId : undefined, custom: userCustom(req.user.id) }));
}));

// ---- rules & alerts ----
api.get('/rules', (req, res) => res.json(all('SELECT r.*, d.name device_name FROM rules r JOIN devices d ON d.id = r.device_id WHERE r.user_id = ? ORDER BY r.id DESC', req.user.id)));
api.post('/rules', wrap((req, res) => {
  const d = get('SELECT * FROM devices WHERE id = ? AND user_id = ?', intId(req.body.deviceId), req.user.id); if (!d) throw bad('Device not found', 404);
  const field = str(req.body.field, 40), op = req.body.op, th = Number(req.body.threshold);
  if (!field) throw bad('Field required'); if (!['>', '<', '>=', '<=', '==', '!='].includes(op)) throw bad('Bad operator'); if (!Number.isFinite(th)) throw bad('Threshold must be a number');
  const cn = str(req.body.cmdName, 40); if (cn && !/^[\w.-]+$/.test(cn)) throw bad('Bad command name');
  if (get('SELECT COUNT(*) c FROM rules WHERE user_id = ?', req.user.id).c >= 100) throw bad('Rule limit reached');
  const r = run('INSERT INTO rules (user_id, device_id, field, op, threshold, message, cmd_name, cmd_value) VALUES (?,?,?,?,?,?,?,?)', req.user.id, d.id, field, op, th, str(req.body.message, 200), cn, str(String(req.body.cmdValue ?? ''), 200));
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
api.delete('/rules/:id', wrap((req, res) => { const r = run('DELETE FROM rules WHERE id = ? AND user_id = ?', intId(req.params.id), req.user.id); if (!r.changes) throw bad('Rule not found', 404); res.json({ ok: true }); }));
api.get('/alerts', (req, res) => res.json(all('SELECT a.*, d.name device_name FROM alerts a LEFT JOIN devices d ON d.id = a.device_id WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 100', req.user.id)));
api.post('/alerts/read', (req, res) => { run('UPDATE alerts SET seen = 1 WHERE user_id = ?', req.user.id); res.json({ ok: true }); });
api.delete('/alerts', (req, res) => { run('DELETE FROM alerts WHERE user_id = ?', req.user.id); res.json({ ok: true }); });

module.exports = api;
