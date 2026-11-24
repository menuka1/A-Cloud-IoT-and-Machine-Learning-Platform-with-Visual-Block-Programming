'use strict';
// Runs GENERATED code for real against an isolated TronicIOT server and checks what happens.
const { spawn, spawnSync } = require('child_process'); const path = require('path'); const os = require('os'); const fs = require('fs');
const builder = require('./builder');
const PORT = 3112, MQ = 19884, B = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tronic-b-'));
const srv = spawn(process.execPath, [path.join(__dirname, 'index.js')], { env: { ...process.env, PORT, MQTT_PORT: MQ, DATA_DIR: dir }, stdio: 'pipe' });
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, body, token) { const r = await fetch(B + '/api' + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j; try { j = await r.json(); } catch {} return { s: r.status, j }; }
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const hasPy = !spawnSync(PY, ['--version']).error;
const cat = builder.catalog();
const resolve = (prog, board) => JSON.parse(JSON.stringify(prog, (k, v) => (typeof v === 'string' && v[0] === '@' ? cat.boards[board].defaults[v.slice(1)] : v)));

// Test program: fake sensor -> cloud ML (model M) -> send; handlers fan (digital) + led (pwm)
const mkProg = (M) => ({ interval: 1, setup: [{ type: 'log', text: 'booted', value: '' }],
  loop: [{ type: 'read_random', var: 'temp', min: 20, max: 30 }, { type: 'ml_predict', model: M, inputs: [{ k: 'temp', v: 'temp' }], var: 'pred', key: 'value' }, { type: 'send_cloud', fields: [{ k: 'temp', v: 'temp' }, { k: 'pred', v: 'pred' }] }],
  handlers: [{ name: 'fan', body: [{ type: 'if', left: 'cmd_value', op: '>=', right: '0.5', then: [{ type: 'write_digital', pin: '@dout2', value: '1' }], else: [{ type: 'write_digital', pin: '@dout2', value: '0' }] }] },
    { name: 'led', body: [{ type: 'write_pwm', pin: '@pwm', value: 'cmd_value' }, { type: 'log', text: 'led level', value: 'cmd_value' }] }] });

const RUNNABLE = {
  'pc-python': { cmd: PY, args: (f) => [f], needsPy: true, fan: /pin 2 -> HIGH/, pwm: /PWM 200\/255/ },
  'rpi-python': { cmd: PY, args: (f) => [f], needsPy: true, fan: /pin 27 -> HIGH/, pwm: /PWM 200\/255/ },   // no GPIO on this PC -> falls back to simulation
  'pc-nodejs': { cmd: process.execPath, args: (f) => [f], fan: /pin 2 -> HIGH/, pwm: /PWM 200\/255/ },
  'esp32-micropython': { cmd: PY, args: (f) => [f], needsPy: true, shim: true, fan: /OUT pin=26 val=1/, pwm: /PWM pin=27 level=200/ },
  'esp8266-micropython': { cmd: PY, args: (f) => [f], needsPy: true, shim: true, fan: /OUT pin=12 val=1/, pwm: /PWM pin=13 level=200/ },
  'picow-micropython': { cmd: PY, args: (f) => [f], needsPy: true, shim: true, fan: /OUT pin=13 val=1/, pwm: /PWM pin=15 level=200/ },
};

function staticCheckCpp(code) { // no C++ compiler on most dev PCs: at least catch structural mistakes
  const stripped = code.replace(/"(\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/gm, ''); const bal = { '(': 0, '{': 0, '[': 0 }; const pair = { ')': '(', '}': '{', ']': '[' };
  for (const ch of stripped) { if (bal[ch] !== undefined) bal[ch]++; if (pair[ch]) bal[pair[ch]]--; }
  const used = new Set(stripped.match(/\bv_[a-z0-9_]+/g) || []); const declared = new Set([...stripped.matchAll(/float (v_[a-z0-9_]+)/g)].map((m) => m[1]));
  return Object.values(bal).every((n) => n === 0) && [...used].every((u) => declared.has(u)) && /void setup\(\)/.test(code) && /void loop\(\)/.test(code);
}

(async () => {
  await sleep(2500);
  let r = await call('POST', '/auth/register', { name: 'Builder Test', email: 'b@x.com', password: 'abc12345' }); const T = r.j.token;
  const dev = (await call('POST', '/devices', { name: 'Gen board', board: 'esp32' }, T)).j;
  const other = (await call('POST', '/auth/register', { name: 'Other', email: 'o@x.com', password: 'abc12345' })).j.token;

  console.log('Catalog + validation');
  r = await call('GET', '/builder/catalog', null, T); ok(r.j.targets && Object.keys(r.j.targets).length === 9 && r.j.blocks.send_cloud, 'catalog lists 9 board/language targets');
  r = await call('POST', '/builder/generate', { target: 'esp32-arduino', name: 'x', program: { interval: 5, loop: [{ type: 'read_analog', var: 'a', pin: '4', mode: 'percent' }] }, settings: { serverUrl: 'http://192.168.1.5:3000' } }, T);
  ok(r.j.ok === false && /ADC|analog/i.test(r.j.errors[0].msg) && r.j.errors[0].id, 'ESP32 ADC2 pin rejected with a block-specific error');
  r = await call('POST', '/builder/generate', { target: 'esp32-arduino', name: 'x', program: { interval: 5, loop: [{ type: 'set_var', var: 'a', value: 'ghost' }] }, settings: { serverUrl: 'http://192.168.1.5:3000' } }, T); ok(r.j.ok === false && /never set/.test(r.j.errors[0].msg), 'unset variable rejected');
  for (const tid of ['esp32-arduino', 'pc-python', 'pc-nodejs']) { r = await call('POST', '/builder/generate', { target: tid, name: 'x', program: { interval: 5, loop: [{ type: 'log', text: 'a"; evil(); //', value: '' }] }, settings: { serverUrl: 'http://192.168.1.5:3000' } }, T);
    const code = r.j.ok ? r.j.files[0].content : ''; const line = code.split('\n').find((l) => l.includes('evil')) || ''; ok(r.j.ok === false || (line.includes('\\"; evil(); //') && (tid !== 'esp32-arduino' || staticCheckCpp(code))), tid + ': quote/code injection in a text field stays an escaped string'); }
  r = await call('POST', '/builder/generate', { target: 'pc-python', name: 'x', program: { interval: 5, loop: [{ type: 'log', text: 'hi', value: '' }] }, settings: { serverUrl: 'javascript:alert(1)' } }, T); ok(r.j.ok === false, 'bad server URL rejected');
  r = await call('POST', '/builder/generate', { target: 'pc-python', name: 'x', deviceId: dev.id, program: { interval: 5, loop: [{ type: 'log', text: 'hi', value: '' }] }, settings: { serverUrl: 'http://x.com' } }, other); ok(r.s === 404, "can't generate with someone else's device token");

  console.log('Projects');
  r = await call('POST', '/projects', { name: 'My project', target: 'esp32-arduino', program: mkProg(1), deviceId: dev.id }, T); ok(r.s === 201 && r.j.program.loop.length === 3, 'save project'); const pid = r.j.id;
  r = await call('GET', '/projects', null, other); ok(r.j.length === 0, "other user can't see my projects");
  r = await call('PUT', `/projects/${pid}`, { name: 'Renamed', target: 'pc-python', program: mkProg(1) }, T); ok(r.j.name === 'Renamed' && r.j.target === 'pc-python', 'update project');
  r = await call('DELETE', `/projects/${pid}`, null, T); ok(r.j.ok, 'delete project');

  console.log('Every template x every target generates valid code');
  let bad = 0;
  for (const [tid, tg] of Object.entries(cat.targets)) for (const t of cat.templates) {
    const res = builder.generate({ target: tid, program: resolve(t.program, tg.board), settings: { serverUrl: 'http://192.168.1.5:3000' }, token: 'tr_x', name: t.name });
    const expectedFail = tid === 'rpi-python' && JSON.stringify(t.program).includes('read_analog');
    if (!!res.ok === expectedFail) { bad++; console.log('   ', tid, t.id, res.ok ? 'should have failed' : res.errors.map((e) => e.msg).join('|')); }
    if (res.ok && tg.lang === 'arduino' && !staticCheckCpp(res.files[0].content)) { bad++; console.log('    C++ structure check failed', tid, t.id); }
    if (res.ok && tg.lang === 'nodejs') { const f = path.join(dir, 'chk.js'); fs.writeFileSync(f, res.files[0].content); if (spawnSync(process.execPath, ['--check', f]).status) { bad++; console.log('    node syntax error', t.id); } }
    if (res.ok && hasPy && (tg.lang === 'python' || tg.lang === 'micropython')) { const f = path.join(dir, 'chk.py'); fs.writeFileSync(f, res.files[0].content); if (spawnSync(PY, ['-m', 'py_compile', f]).status) { bad++; console.log('    python syntax error', tid, t.id); } }
  }
  ok(bad === 0, `${Object.keys(cat.targets).length * cat.templates.length} template/target combinations all pass (C++ checked structurally only)`);

  console.log('Run the generated code for real');
  const m = (await call('POST', '/ml/models', { name: 'lin', algorithm: 'linear_regression', config: { features: ['temp'], target: 'y' } }, T)).j;
  const csv = 'temp,y\n' + Array.from({ length: 30 }, (_, i) => `${15 + i},${2 * (15 + i) + 1}`).join('\n');
  r = await call('POST', `/ml/models/${m.id}/train`, { source: { type: 'csv', csv } }, T); ok(r.s === 200 && r.j.metrics.r2 > 0.99, 'cloud ML model ready for the generated code to call');
  const procs = [];
  for (const [tid, spec] of Object.entries(RUNNABLE)) {
    if (spec.needsPy && !hasPy) { console.log('  SKIP ' + tid + ' (python not installed)'); continue; }
    const tg = cat.targets[tid]; const d = (await call('POST', '/devices', { name: tid, board: 'other' }, T)).j;
    await call('POST', `/devices/${d.id}/commands`, { name: 'fan', value: 1 }, T); await call('POST', `/devices/${d.id}/commands`, { name: 'led', value: 200 }, T);
    const res = builder.generate({ target: tid, program: resolve(mkProg(m.id), tg.board), settings: { serverUrl: B }, token: d.token, name: 'e2e' });
    if (!res.ok) { ok(false, tid + ' generate: ' + res.errors.map((e) => e.msg).join('|')); continue; }
    const f = path.join(dir, tid + '.' + (tg.lang === 'nodejs' ? 'js' : 'py')); fs.writeFileSync(f, res.files[0].content);
    const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }; if (spec.shim) env.PYTHONPATH = path.join(__dirname, 'test-shims');
    const p = spawn(spec.cmd, spec.args(f), { env, stdio: 'pipe' }); let log = ''; p.stdout.on('data', (b) => (log += b)); p.stderr.on('data', (b) => (log += b));
    procs.push({ tid, spec, d, p, get log() { return log; } });
  }
  await sleep(6000); procs.forEach((x) => x.p.kill());
  await sleep(500);
  for (const x of procs) {
    const rd = (await call('GET', `/devices/${x.d.id}/readings?limit=50`, null, T)).j;
    const good = rd.length >= 2 && rd.every((q) => q.data.temp >= 20 && q.data.temp <= 30 && Math.abs(q.data.pred - (2 * q.data.temp + 1)) < 0.5);
    ok(good, `${x.tid}: ${rd.length} readings reached the server, each with a correct cloud-ML prediction`);
    ok(x.spec.fan.test(x.log) && x.spec.pwm.test(x.log) && /booted/.test(x.log), `${x.tid}: received dashboard commands and drove the outputs (fan ON, LED level 200)`);
    if (!(good && x.spec.fan.test(x.log))) console.log('--- log of ' + x.tid + ':\n' + x.log.split('\n').slice(0, 15).join('\n'));
  }

  console.log('ESP8266 onboard LED is active-low');
  { const tg = cat.targets['esp8266-micropython']; const res = builder.generate({ target: 'esp8266-micropython', program: { interval: 1, loop: [{ type: 'write_digital', pin: 'LED', value: '1' }] }, settings: { serverUrl: B }, token: 'tr_x', name: 'led' });
    const f = path.join(dir, 'led.py'); fs.writeFileSync(f, res.files[0].content); if (hasPy) { const run = spawn(PY, [f], { env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONPATH: path.join(__dirname, 'test-shims') } }); let l = ''; run.stdout.on('data', (b) => (l += b)); await sleep(2500); run.kill(); ok(/OUT pin=2 val=0/.test(l), 'turning the LED "ON" drives GPIO2 LOW on ESP8266'); } }

  console.log('New blocks: calculate, map, repeat, AND/OR, uptime, comment');
  const S = (v, x) => ({ type: 'set_var', var: v, value: x });
  const blocksProg = { interval: 1, setup: [], handlers: [], loop: [S('a', '10'), S('b', '3'), S('zero', '0'),
    { type: 'calc', var: 'sum', left: 'a', op: '*', right: '3' }, { type: 'calc', var: 'rem', left: 'a', op: '%', right: '4' }, { type: 'calc', var: 'dz', left: 'a', op: '/', right: 'zero' },
    { type: 'map_range', var: 'mapped', value: '5', inMin: '0', inMax: '10', outMin: '0', outMax: '100', clamp: 'yes' },
    { type: 'map_range', var: 'clamped', value: '20', inMin: '0', inMax: '10', outMin: '0', outMax: '100', clamp: 'yes' },
    { type: 'map_range', var: 'unclamped', value: '20', inMin: '0', inMax: '10', outMin: '0', outMax: '100', clamp: 'no' },
    S('cnt', '0'), { type: 'repeat', times: 3, body: [{ type: 'change_var', var: 'cnt', by: '2' }] },
    { type: 'if', left: 'a', op: '>', right: '5', join: 'and', left2: 'b', op2: '<', right2: '5', then: [S('flag', '1')], else: [S('flag', '0')] },
    { type: 'if', left: 'a', op: '>', right: '50', join: 'or', left2: 'b', op2: '<', right2: '5', then: [S('flag2', '1')], else: [S('flag2', '0')] },
    { type: 'if', left: 'a', op: '>', right: '50', join: 'and', left2: 'b', op2: '<', right2: '5', then: [S('flag3', '1')], else: [S('flag3', '0')] },
    { type: 'read_uptime', var: 'up' }, { type: 'comment', text: 'hello comment' },
    { type: 'send_cloud', fields: ['sum', 'rem', 'dz', 'mapped', 'clamped', 'unclamped', 'cnt', 'flag', 'flag2', 'flag3', 'up'].map((k) => ({ k, v: k })) }] };
  for (const tid of ['esp32-arduino', 'esp8266-arduino', 'picow-arduino']) { const res = builder.generate({ target: tid, program: blocksProg, settings: { serverUrl: B }, token: 'tr_x', name: 'nb' });
    ok(res.ok && staticCheckCpp(res.files[0].content) && /fmod\(/.test(res.files[0].content) && /float mapRange/.test(res.files[0].content) && /isinf\(v\)/.test(res.files[0].content) && /for \(int rep0/.test(res.files[0].content) && /\) && \(/.test(res.files[0].content), tid + ': C++ for the new blocks has the expected structure (compile not run)'); }
  r = await call('POST', '/builder/generate', { target: 'pc-python', name: 'x', program: { interval: 5, loop: [{ type: 'calc', var: 'a', left: '1', op: '/', right: '0' }] }, settings: { serverUrl: B } }, T); ok(r.j.ok === false && /divide by zero/.test(r.j.errors[0].msg), 'literal divide-by-zero rejected');
  r = await call('POST', '/builder/generate', { target: 'pc-python', name: 'x', program: { interval: 5, loop: [{ type: 'map_range', var: 'a', value: '1', inMin: '5', inMax: '5', outMin: '0', outMax: '1', clamp: 'yes' }] }, settings: { serverUrl: B } }, T); ok(r.j.ok === false && /range cannot be empty/.test(r.j.errors[0].msg), 'empty map range rejected');
  r = await call('POST', '/builder/generate', { target: 'pc-python', name: 'x', program: { interval: 5, loop: [{ type: 'if', left: '1', op: '>', right: '0', join: 'and', left2: 'ghost', op2: '<', right2: '3', then: [], else: [] }] }, settings: { serverUrl: B } }, T); ok(r.j.ok === false && /never set/.test(r.j.errors[0].msg), 'second condition is validated too');
  const nbProcs = [];
  for (const [tid, spec] of Object.entries(RUNNABLE)) {
    if (spec.needsPy && !hasPy) continue; const d = (await call('POST', '/devices', { name: 'nb-' + tid, board: 'other' }, T)).j;
    const res = builder.generate({ target: tid, program: resolve(blocksProg, cat.targets[tid].board), settings: { serverUrl: B }, token: d.token, name: 'nb' }); if (!res.ok) { ok(false, tid + ': ' + res.errors.map((e) => e.msg).join('|')); continue; }
    const f = path.join(dir, 'nb-' + tid + '.' + (cat.targets[tid].lang === 'nodejs' ? 'js' : 'py')); fs.writeFileSync(f, res.files[0].content);
    const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }; if (spec.shim) env.PYTHONPATH = path.join(__dirname, 'test-shims');
    const p = spawn(spec.cmd, spec.args(f), { env, stdio: 'pipe' }); let log = ''; p.stdout.on('data', (x) => (log += x)); p.stderr.on('data', (x) => (log += x)); nbProcs.push({ tid, d, p, get log() { return log; } });
  }
  await sleep(4500); nbProcs.forEach((x) => x.p.kill()); await sleep(400);
  for (const x of nbProcs) {
    const rd = (await call('GET', `/devices/${x.d.id}/readings?limit=10`, null, T)).j; const q = rd[0]?.data || {};
    const good = rd.length >= 1 && q.sum === 30 && q.rem === 2 && q.mapped === 50 && q.clamped === 100 && q.unclamped === 200 && q.cnt === 6 && q.flag === 1 && q.flag2 === 1 && q.flag3 === 0 && typeof q.up === 'number' && q.up >= 0 && !('dz' in q);
    ok(good, `${x.tid}: calc / remainder / map / clamp / repeat / AND / OR / uptime all correct, divide-by-zero left out`); if (!good) console.log('    got', JSON.stringify(q), '\n' + x.log.slice(0, 600));
  }

  console.log(fails ? `\n${fails} FAILED` : '\nALL BUILDER TESTS PASSED'); srv.kill(); await sleep(700); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
