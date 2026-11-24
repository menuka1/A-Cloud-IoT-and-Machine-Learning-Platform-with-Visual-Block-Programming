'use strict';
// End-to-end test: spawns an isolated server (temp DB) and drives the whole platform.
const { spawn } = require('child_process'); const path = require('path'); const os = require('os'); const fs = require('fs'); const net = require('net'); const WebSocket = require('ws');
const PORT = 3111, MQ = 19883, B = `http://localhost:${PORT}/api`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tronic-'));
const srv = spawn(process.execPath, [path.join(__dirname, 'index.js')], { env: { ...process.env, PORT, MQTT_PORT: MQ, DATA_DIR: dir }, stdio: 'pipe' });
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, body, token, extra = {}) {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j };
}
// minimal MQTT 3.1.1 client
const enc = (s) => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
const rl = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; o.push(d); } while (n); return Buffer.from(o); };
const pkt = (type, body) => Buffer.concat([Buffer.from([type]), rl(body.length), body]);
function mqtt(user) {
  return new Promise((res, rej) => {
    const s = net.connect(MQ, '127.0.0.1'); const got = [];
    s.on('data', (d) => { if (d[0] === 0x20) { if (d[3] !== 0) rej(new Error('connack ' + d[3])); else res({ s, got }); } else if ((d[0] >> 4) === 3) got.push(d.toString()); });
    s.on('error', rej);
    s.write(pkt(0x10, Buffer.concat([enc('MQTT'), Buffer.from([4, 0x80, 0, 30]), enc('c' + Math.random()), enc(user)])));
  });
}
(async () => {
  await sleep(2500);
  console.log('Auth');
  let r = await call('POST', '/auth/register', { name: 'Test User', email: 'T@x.com', password: 'abc12345' }); ok(r.s === 201 && r.j.token, 'register'); const T = r.j.token;
  r = await call('POST', '/auth/register', { name: 'Dup', email: 't@x.com', password: 'abc12345' }); ok(r.s === 409, 'duplicate email rejected (case-insens.)');
  r = await call('POST', '/auth/register', { name: 'Weak', email: 'w@x.com', password: 'abcdefgh' }); ok(r.s === 400, 'weak password rejected');
  r = await call('POST', '/auth/login', { email: 't@x.com', password: 'wrong' }); ok(r.s === 401, 'bad login rejected');
  r = await call('POST', '/auth/login', { email: 't@x.com', password: 'abc12345' }); ok(r.s === 200, 'login'); 
  r = await call('GET', '/devices'); ok(r.s === 401, 'API needs auth');
  r = await call('POST', '/auth/register', { name: 'Other', email: 'o@x.com', password: 'abc12345' }); const T2 = r.j.token;

  console.log('Devices + HTTP ingest');
  r = await call('POST', '/devices', { name: 'Greenhouse', board: 'esp32' }, T); ok(r.s === 201 && r.j.token.startsWith('tr_'), 'create device'); const dev = r.j;
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`); const events = []; await new Promise((x) => ws.on('open', x)); ws.send(JSON.stringify({ type: 'auth', token: T })); ws.on('message', (m) => events.push(JSON.parse(m)));
  await sleep(300);
  r = await call('POST', '/ingest', { temp: 24.5, hum: 60, relay: true }, null, { 'x-device-token': dev.token }); ok(r.s === 200 && r.j.stored === 3, 'ingest via header token');
  r = await fetch(`${B}/ingest?token=${dev.token}&temp=25&hum=61`); ok(r.status === 200, 'ingest via GET query (simple boards)');
  r = await call('POST', '/ingest', { temp: 1 }, null, { 'x-device-token': 'tr_nope' }); ok(r.s === 401, 'bad token rejected');
  r = await call('GET', `/devices/${dev.id}/readings`, null, T2); ok(r.s === 404, "other user can't read my device");
  r = await call('GET', `/devices/${dev.id}/readings`, null, T); ok(r.j.length === 2 && r.j[0].data.temp === 24.5, 'readings stored');
  ok(events.some((e) => e.type === 'reading'), 'live websocket event received');

  console.log('Rules / commands');
  await call('POST', '/rules', { deviceId: dev.id, field: 'temp', op: '>', threshold: 30, message: 'Too hot', cmdName: 'fan', cmdValue: '1' }, T);
  await call('POST', '/ingest', { temp: 35 }, null, { 'x-device-token': dev.token }); await sleep(200);
  r = await call('GET', '/alerts', null, T); ok(r.j.some((a) => a.message === 'Too hot'), 'rule fired -> alert');
  r = await call('GET', '/device/commands', null, null, { 'x-device-token': dev.token }); ok(r.j.commands.some((c) => c.name === 'fan' && c.value === '1'), 'rule queued command; device polled it');
  r = await call('GET', '/device/commands', null, null, { 'x-device-token': dev.token }); ok(r.j.commands.length === 0, 'command delivered once');
  r = await call('POST', `/devices/${dev.id}/commands`, { name: 'led', value: 1 }, T); ok(r.s === 200, 'dashboard sends command');

  console.log('ML');
  for (let i = 0; i < 80; i++) { const t = 15 + (i % 20); await call('POST', '/ingest', { temp: t, hum: 100 - t * 2 + (i % 3) * 0.1, fan: t > 25 ? 'on' : 'off' }, null, { 'x-device-token': dev.token }); }
  r = await call('POST', '/ml/models', { name: 'Humidity est', algorithm: 'linear_regression', config: { features: ['temp'], target: 'hum' } }, T); ok(r.s === 201, 'create regression'); const m1 = r.j;
  r = await call('POST', `/ml/models/${m1.id}/train`, { source: { type: 'device', deviceId: dev.id } }, T); ok(r.s === 200 && r.j.metrics.r2 > 0.9, 'train from device data r2=' + r.j.metrics?.r2);
  r = await call('POST', `/ml/models/${m1.id}/predict`, { inputs: { temp: 20 } }, null, { 'x-device-token': dev.token }); ok(Math.abs(r.j.output.value - 60) < 2, 'predict via device token -> ' + r.j.output?.value);
  r = await call('POST', `/ml/models/${m1.id}/predict`, { inputs: { temp: 20 } }, T2); ok(r.s === 404, "other user can't use my model");
  r = await call('POST', `/ml/models/${m1.id}/predict`, { inputs: {} }, T); ok(r.s === 400, 'missing input -> clean 400');
  r = await call('POST', '/ml/models', { name: 'Fan clf', algorithm: 'knn', config: { features: ['temp'], target: 'fan' } }, T);
  r = await call('POST', `/ml/models/${r.j.id}/train`, { source: { type: 'csv', csv: 'temp,fan\n10,off\n12,off\n30,on\n33,on\n11,off\n31,on\n' } }, T); ok(r.s === 200, 'train from pasted CSV');
  r = await call('POST', '/ml/models', { name: 'Anom', algorithm: 'anomaly', config: { features: ['temp', 'hum'], threshold: 3 } }, T);
  const an = r.j; await call('POST', `/ml/models/${an.id}/train`, { source: { type: 'device', deviceId: dev.id } }, T);
  await call('PUT', `/ml/models/${an.id}`, { autoDeviceId: dev.id }, T);
  events.length = 0; await call('POST', '/ingest', { temp: 300, hum: -200 }, null, { 'x-device-token': dev.token }); await sleep(300);
  ok(events.some((e) => e.type === 'prediction' && e.output.anomaly), 'auto-run model pushed live anomaly prediction');
  r = await call('GET', '/alerts', null, T); ok(r.j.some((a) => /anomaly/.test(a.message)), 'anomaly raised alert');
  r = await call('GET', `/ml/models/${m1.id}/export`, null, T); ok(r.j.state?.weights, 'model export (run on-device)');

  console.log('MQTT');
  const dev2 = (await call('POST', '/devices', { name: 'Pico', board: 'raspberry-pico-w' }, T)).j;
  let failed = false; try { await mqtt('tr_wrong'); } catch { failed = true; } ok(failed, 'MQTT bad token refused');
  const c = await mqtt(dev2.token); ok(true, 'MQTT connect with token');
  c.s.write(pkt(0x82, Buffer.concat([Buffer.from([0, 1]), enc(`tronic/${dev2.token}/cmd`), Buffer.from([0])])));
  c.s.write(pkt(0x30, Buffer.concat([enc(`tronic/${dev2.token}/data`), Buffer.from(JSON.stringify({ volt: 3.3 }))])));
  await sleep(600); r = await call('GET', `/devices/${dev2.id}/readings`, null, T); ok(r.j[0]?.data.volt === 3.3, 'MQTT publish ingested');
  await call('POST', `/devices/${dev2.id}/commands`, { name: 'led', value: 1 }, T); await sleep(400); ok(c.got.some((g) => g.includes('"led"')), 'command pushed to device over MQTT');
  c.s.destroy(); ws.close();

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); srv.kill(); await sleep(700); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
