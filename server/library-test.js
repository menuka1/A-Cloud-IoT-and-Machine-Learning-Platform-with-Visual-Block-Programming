'use strict';
// Tests for the parts library, My Kit, custom parts and the part -> code pipeline.
const { spawn, spawnSync } = require('child_process'); const path = require('path'); const os = require('os'); const fs = require('fs');
const builder = require('./builder'); const lib = builder.lib;
const PORT = 3113, MQ = 19885, B = `http://localhost:${PORT}`;
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cat = builder.catalog(); const meta = cat.library;
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'); const hasPy = !spawnSync(PY, ['--version']).error;

// pick distinct, valid pins for a part block (mirrors what the UI does)
function mkPart(type, board, extra = {}, used = new Set()) {
  const def = cat.blocks[type]; const pins = cat.boards[board].pins; const b = { type }; let ok2 = true;
  for (const f of def.fields) {
    if (f.kind === 'pin') {
      const dflt = typeof f.default === 'string' && f.default[0] === '@' ? cat.boards[board].defaults[f.default.slice(1)] : null;
      const valid = (p) => p.caps.includes(f.cap) && !(f.pullup && p.noPullup) && !used.has(p.id);
      const pick = pins.find((p) => p.id === dflt && valid(p)) || pins.find((p) => valid(p) && p.id !== 'LED') || pins.find(valid);
      if (!pick) { ok2 = false; b[f.k] = ''; } else { b[f.k] = pick.id; used.add(pick.id); }
    } else b[f.k] = typeof f.default === 'object' ? JSON.parse(JSON.stringify(f.default)) : f.default;
  }
  return { ...b, ...extra, _ok: ok2 };
}
const prog = (blocks, extra = {}) => ({ interval: 1, setup: [], loop: blocks, handlers: [], ...extra });

// tiny interpreter for primitive blocks, to check the maths of recipes
function interp(blocks, env) {
  const V = {}; const W = []; const val = (x) => (Number.isFinite(+x) && String(x).trim() !== '' ? +x : V[String(x).trim()]);
  const run = (arr) => arr.forEach((b) => {
    switch (b.type) {
      case 'read_analog': V[b.var] = env.analog[b.pin]; break; case 'read_digital': V[b.var] = env.digital[b.pin]; break;
      case 'calc': { const l = val(b.left), r = val(b.right); V[b.var] = b.op === '+' ? l + r : b.op === '-' ? l - r : b.op === '*' ? l * r : b.op === '/' ? l / r : l % r; break; }
      case 'set_var': V[b.var] = val(b.value); break;
      case 'write_digital': W.push(['d', b.pin, val(b.value) >= 0.5 ? 1 : 0]); break; case 'write_pwm': W.push(['p', b.pin, Math.max(0, Math.min(255, val(b.value)))]); break;
      case 'read_ultrasonic': V[b.var] = env.ultra; break; case 'read_dht': V[b.tvar] = env.t; V[b.hvar] = env.h; break;
      default: throw new Error('interp: ' + b.type);
    }
  });
  run(blocks); return { V, W };
}
function expandBlock(block, profile, custom = []) { const P = builder.normalize(prog([block])); const r = lib.expandProgram(P, { profile, vref: 3.3, custom }); if (r.errors.length) throw new Error(r.errors[0].msg); return r.program.loop; }
const near = (a, b) => Math.abs(a - b) < 1e-6;

(async () => {
  console.log('Library data');
  const tiers = { ready: 0, soon: 0, info: 0 }; meta.parts.forEach((p) => tiers[p.tier]++);
  ok(meta.boards.length === 46 && meta.boards.filter((b) => b.ready).length === 10, `46 boards listed, 10 ready (${meta.boards.filter((b) => b.ready).map((b) => b.id).join(', ')})`);
  ok(meta.parts.length > 400 && tiers.ready >= 120, `${meta.parts.length} parts: ${tiers.ready} ready, ${tiers.soon} coming soon, ${tiers.info} inventory-only`);
  ok(new Set(meta.parts.map((p) => p.id)).size === meta.parts.length, 'part ids are unique');
  ok(meta.parts.filter((p) => p.tier === 'ready' || p.tier === 'beta').every((p) => cat.blocks['p_' + p.id]) && meta.parts.filter((p) => p.tier === 'soon' || p.tier === 'info').every((p) => !cat.blocks['p_' + p.id]), 'only ready/beta parts have blocks; coming-soon parts do not pretend to');
  ok(['BME280', 'BH1750', 'MPU6050'].every((n) => meta.parts.find((p) => p.name === n)?.tier === 'beta'), 'I2C sensors are labelled beta (tested with simulated chips, not real hardware)');
  ok(['NEO-6M', 'SIM800L', 'OLED 0.96 Inch', 'Servo Motor SG90', 'BME680'].every((n) => meta.parts.find((p) => p.name === n)?.tier === 'soon'), 'I2C/UART/display/servo parts are honestly marked "coming soon"');
  ok(meta.parts.find((p) => p.name === 'MPU6886') && meta.parts.filter((p) => p.name === 'MPU6886').length === 1 && meta.parts.find((p) => p.name === 'BME680').cats.length === 2, 'duplicates in your lists are merged (BME680 lives in two categories)');

  console.log('Recipe maths (interpreted)');
  const E = 'esp32';
  let r = interp(expandBlock(mkPart('p_lm35', E), E), { analog: { 34: 31 } }); ok(near(r.V.temp, 102.3), 'LM35: 31 % of 3.3 V -> 102.3 C');
  r = interp(expandBlock(mkPart('p_tmp36', E), E), { analog: { 34: 22 } }); ok(near(r.V.temp, 22 * 3.3 - 50), 'TMP36: (V - 0.5) x 100');
  r = interp(expandBlock(mkPart('p_voltage_sensor_module', E), E), { analog: { 34: 50 } }); ok(near(r.V.voltage, 8.25), 'Voltage sensor module (5:1): 50 % -> 8.25 V');
  r = interp(expandBlock(mkPart('p_voltage_sensor_module', E, { ratio: 11 }), E), { analog: { 34: 50 } }); ok(near(r.V.battery_v ?? r.V.voltage, 18.15), 'divider ratio field changes the result (11:1 -> 18.15 V)');
  r = interp(expandBlock(mkPart('p_ldr', E), E), { analog: { 34: 77 } }); ok(r.V.light === 77, 'LDR: plain percent passes through');
  let blk = mkPart('p_ir_obstacle_sensor', E); r = interp(expandBlock(blk, E), { digital: { [blk.pin]: 0 } }); ok(r.V.obstacle === 1, 'active-LOW sensor: pin LOW -> 1');
  r = interp(expandBlock(blk, E), { digital: { [blk.pin]: 1 } }); ok(r.V.obstacle === 0, 'active-LOW sensor: pin HIGH -> 0');
  blk = mkPart('p_hc_sr501_pir', E); r = interp(expandBlock(blk, E), { digital: { [blk.pin]: 1 } }); ok(r.V.motion === 1, 'PIR (active HIGH): pin HIGH -> 1');
  blk = mkPart('p_1_channel_relay', E); r = interp(expandBlock(blk, E), {}); ok(r.W[0][2] === 0, 'relay board is "trigger low": ON writes LOW');
  r = interp(expandBlock({ ...blk, state: '0' }, E), {}); ok(r.W[0][2] === 1, 'relay board: OFF writes HIGH');
  r = interp(expandBlock({ ...blk, trigger: 'high', state: '1' }, E), {}); ok(r.W[0][2] === 1, 'relay "trigger high" option works');
  blk = mkPart('p_mosfet_module', E, { level: '50' }); r = interp(expandBlock(blk, E), {}); ok(near(r.W[0][2], 127.5), 'MOSFET dimmer: 50 % -> 127.5 / 255');
  blk = mkPart('p_l298n', E, { direction: 'forward', speed: '100' }); r = interp(expandBlock(blk, E), {}); ok(r.W[0][2] === 1 && r.W[1][2] === 0 && near(r.W[2][2], 255), 'L298N forward 100 %: IN1 1, IN2 0, speed 255');
  r = interp(expandBlock({ ...blk, direction: 'backward', speed: '40' }, E), {}); ok(r.W[0][2] === 0 && r.W[1][2] === 1 && near(r.W[2][2], 102), 'L298N backward 40 %: IN1 0, IN2 1, speed 102');
  r = interp(expandBlock({ ...blk, direction: 'stop' }, E), {}); ok(r.W.every((w) => w[2] === 0), 'L298N stop: everything off');
  blk = mkPart('p_l9110s', E, { direction: 'backward', speed: '40' }); r = interp(expandBlock(blk, E), {}); ok(r.W[0][1] === blk.pinb && near(r.W[0][2], 102) && r.W[1][1] === blk.pina && r.W[1][2] === 0, 'L9110S backward: PWM on pin B only');
  blk = mkPart('p_rgb_leds', E, { r: '255', g: '0', b: '10' }); r = interp(expandBlock(blk, E), {}); ok(r.W.map((w) => w[2]).join() === '255,0,10', 'RGB LED common cathode: values pass through');
  r = interp(expandBlock({ ...blk, common: 'anode' }, E), {}); ok(r.W.map((w) => w[2]).join() === '0,255,245', 'RGB LED common anode: values inverted');
  blk = mkPart('p_joystick_module', E); r = interp(expandBlock(blk, E), { analog: { [blk.xpin]: 40, [blk.ypin]: 60 }, digital: { [blk.bpin]: 0 } }); ok(r.V.joy_x === 40 && r.V.joy_y === 60 && r.V.joy_btn === 1, 'joystick: X, Y and pressed-button (LOW -> 1)');
  blk = mkPart('p_hc_sr04', E); r = interp(expandBlock(blk, E), { ultra: 42 }); ok(r.V.distance === 42, 'HC-SR04 maps to the distance block');
  blk = mkPart('p_am2301', E); const ex = expandBlock(blk, E); ok(ex[0].type === 'read_dht' && ex[0].model === '21', 'AM2301 uses the DHT21 protocol');

  console.log('Duplicate-pin protection');
  blk = mkPart('p_l298n', E); { const P = builder.normalize(prog([{ ...blk, in2: blk.in1 }])); const x = lib.expandProgram(P, { profile: E, vref: 3.3 }); ok(x.errors.length === 1 && /own pin/.test(x.errors[0].msg), 'two connections on one pin are rejected with a plain message'); }
  { const j = mkPart('p_joystick_module', 'esp8266'); ok(!j._ok || j.xpin !== j.ypin, 'ESP8266 has one analog pin: joystick cannot get two (pin picker reports it)'); }

  console.log('Every ready part x every compatible target');
  let bad = 0, count = 0;
  for (const [tid, T] of Object.entries(cat.targets)) {
    for (const p of meta.parts.filter((x) => x.tier === 'ready' || x.tier === 'beta')) {
      const b = mkPart('p_' + p.id, T.board); const needsAdc = cat.blocks['p_' + p.id].fields.some((f) => f.cap === 'adc');
      if (!b._ok) { if (!(needsAdc && (T.board === 'rpi' || T.board === 'esp8266'))) { bad++; console.log('   no pins for', p.id, 'on', tid); } continue; }
      const res = builder.generate({ target: tid, program: prog([b, { type: 'log', text: 'x', value: '' }]), settings: { serverUrl: 'http://192.168.1.5:3000' }, token: 'tr_x', name: p.name }); count++;
      if (!res.ok) { bad++; console.log('   ', tid, p.id, res.errors.map((e) => e.msg).join('|').slice(0, 120)); }
    }
  }
  ok(bad === 0, `${count} part/target combinations generate valid code (parts needing analog on Raspberry Pi are correctly refused)`);
  { const b = mkPart('p_ldr', 'rpi'); const res = builder.generate({ target: 'rpi-python', program: prog([{ ...b, pin: '4' }]), settings: { serverUrl: 'http://x.com' }, name: 'x' }); ok(!res.ok && /no analog/i.test(res.errors[0].msg) && res.errors[0].id, 'analog part on a Raspberry Pi: friendly error shown on the part block'); }

  // ---------------- server-backed tests ----------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tronic-l-'));
  const srv = spawn(process.execPath, [path.join(__dirname, 'index.js')], { env: { ...process.env, PORT, MQTT_PORT: MQ, DATA_DIR: dir }, stdio: 'pipe' }); await sleep(2500);
  const call = async (method, p, body, token) => { const r = await fetch(B + '/api' + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j; try { j = await r.json(); } catch {} return { s: r.status, j }; };
  try {
    const T = (await call('POST', '/auth/register', { name: 'Kit Test', email: 'k@x.com', password: 'abc12345' })).j.token; const T2 = (await call('POST', '/auth/register', { name: 'Other', email: 'o@x.com', password: 'abc12345' })).j.token;
    console.log('My Kit + custom parts API');
    let x = await call('GET', '/kit', null, T); ok(x.j.configured === false && x.j.parts.length === 0, 'new user has an empty, unconfigured kit');
    x = await call('PUT', '/kit', { boardId: 'arduino-uno-r3', parts: [] }, T); ok(x.s === 400 && /cannot generate code yet/.test(x.j.error), 'a not-yet-supported board is refused with a clear reason');
    x = await call('PUT', '/kit', { boardId: 'esp32-devkit-v1', parts: ['dht22', 'bme280', 'does_not_exist', 'dht22'] }, T); ok(x.s === 200 && x.j.parts.join() === 'dht22,bme280', 'kit saves known parts (even coming-soon ones), drops unknown, de-duplicates');
    x = await call('GET', '/kit', null, T2); ok(x.j.parts.length === 0, "kits are per user");
    x = await call('POST', '/custom-parts', { name: 'My thermistor board', kind: 'analog', var: 'temp2', params: { mult: 2, add: 1, note: 'Use pin Aé' } }, T); ok(x.s === 201 && x.j.params.mult === 2 && !/é/.test(x.j.params.note), 'custom analog part created (note sanitised)'); const cp = x.j;
    x = await call('POST', '/custom-parts', { name: 'x', kind: 'analog' }, T); ok(x.s === 400, 'bad custom part rejected');
    x = await call('POST', '/custom-parts', { name: 'Evil', kind: 'rm -rf' }, T); ok(x.s === 400, 'unknown kind rejected');
    x = await call('GET', '/builder/catalog', null, T); ok(!!x.j.blocks['cp_' + cp.id] && x.j.blocks['cp_' + cp.id].custom, 'custom part appears as a block for its owner');
    x = await call('GET', '/builder/catalog', null, T2); ok(!x.j.blocks['cp_' + cp.id], 'and is invisible to other users');
    x = await call('PUT', '/kit', { boardId: 'esp32-devkit-v1', parts: ['cp_' + cp.id] }, T2); ok(x.j.parts.length === 0, "other users can't put my custom part in their kit");
    const cb = { type: 'cp_' + cp.id, var: 'temp2', pin: '34' };
    r = interp(expandBlock(cb, 'esp32', [{ ...cp, params: JSON.stringify(cp.params) }]), { analog: { 34: 10 } }); ok(near(r.V.temp2, 21), 'custom analog part: value = percent x 2 + 1');
    x = await call('POST', '/builder/generate', { target: 'esp32-arduino', name: 'c', program: prog([cb, { type: 'send_cloud', fields: [{ k: 't', v: 'temp2' }] }]), settings: { serverUrl: 'http://192.168.1.5:3000' } }, T); ok(x.j.ok && /v_temp2/.test(x.j.files[0].content), 'custom part generates code');
    x = await call('POST', '/builder/generate', { target: 'esp32-arduino', name: 'c', program: prog([cb, { type: 'send_cloud', fields: [{ k: 't', v: 'temp2' }] }]), settings: { serverUrl: 'http://192.168.1.5:3000' } }, T2); ok(x.j.ok === false && /not available/.test(x.j.errors[0].msg), "another user's program using my custom part is refused");
    x = await call('DELETE', `/custom-parts/${cp.id}`, null, T2); ok(x.s === 404, "can't delete someone else's custom part");
    x = await call('DELETE', `/custom-parts/${cp.id}`, null, T); ok(x.j.ok, 'owner can delete it');

    console.log('Board rules');
    const send = (extra) => ({ target: 'esp32-arduino', name: 'b', settings: { serverUrl: 'http://192.168.1.5:3000' }, ...extra });
    x = await call('POST', '/builder/generate', send({ boardId: 'arduino-uno-r3', program: prog([{ type: 'log', text: 'a', value: '' }]) }), T); ok(x.j.ok === false && /cannot generate code yet/.test(x.j.errors[0].msg), 'unsupported board explains itself');
    x = await call('POST', '/builder/generate', send({ boardId: 'esp8266-nodemcu', program: prog([{ type: 'log', text: 'a', value: '' }]) }), T); ok(x.j.ok === false && /cannot run that language/.test(x.j.errors[0].msg), 'board / language mismatch is explained');
    const w = mkPart('p_hc_sr04', 'esp32'); const w16 = { ...w, trig: '16' };
    x = await call('POST', '/builder/generate', send({ boardId: 'esp32-wrover', program: prog([w16]) }), T); ok(x.j.ok === false && /used inside your board/.test(x.j.errors.map((e) => e.msg).join()), 'ESP32-WROVER: GPIO16/17 (memory chip) are blocked');
    x = await call('POST', '/builder/generate', send({ boardId: 'esp32-devkit-v1', program: prog([w16]) }), T); ok(x.j.ok === true, 'the same program is fine on the DevKit V1');

    console.log('Generated code for parts runs for real');
    const mk = (board) => { const u = new Set(); return prog([mkPart('p_dht22', board, {}, u), mkPart('p_hc_sr04', board, {}, u), { ...mkPart('p_1_channel_relay', board, {}, u), state: '1' }, { ...mkPart('p_l298n', board, {}, u), direction: 'forward', speed: '100' }, { type: 'send_cloud', fields: [{ k: 'temp', v: 'temp' }, { k: 'hum', v: 'hum' }, { k: 'distance', v: 'distance' }] }]); };
    const RUN = {
      'esp32-micropython': { shim: true, board: 'esp32' }, 'esp8266-micropython': { shim: true, board: 'esp8266' }, 'picow-micropython': { shim: true, board: 'picow' },
      'pc-python': { board: 'pc' }, 'rpi-python': { board: 'rpi' }, 'pc-nodejs': { board: 'pc', node: true },
    };
    const procs = [];
    for (const [tid, spec] of Object.entries(RUN)) {
      if (!spec.node && !hasPy) continue; const d = (await call('POST', '/devices', { name: tid, board: 'other' }, T)).j; const program = mk(spec.board);
      const res = builder.generate({ target: tid, program, settings: { serverUrl: B }, token: d.token, name: 'parts' }); if (!res.ok) { ok(false, tid + ': ' + res.errors.map((e) => e.msg).join('|')); continue; }
      const f = path.join(dir, tid + (spec.node ? '.js' : '.py')); fs.writeFileSync(f, res.files[0].content);
      const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }; if (spec.shim) env.PYTHONPATH = path.join(__dirname, 'test-shims');
      const p = spawn(spec.node ? process.execPath : PY, [f], { env, stdio: 'pipe' }); let log = ''; p.stdout.on('data', (b) => (log += b)); p.stderr.on('data', (b) => (log += b));
      const relay = program.loop[2].pin, in1 = program.loop[3].in1, in2 = program.loop[3].in2, en = program.loop[3].en;
      procs.push({ tid, spec, d, p, relay, in1, in2, en, get log() { return log; } });
    }
    await sleep(4500); procs.forEach((q) => q.p.kill()); await sleep(400);
    for (const q of procs) {
      const rd = (await call('GET', `/devices/${q.d.id}/readings?limit=5`, null, T)).j; const s = rd[0]?.data || {};
      const sensorsOk = q.spec.shim ? (s.temp === 23.5 && s.hum === 55 && Math.abs(s.distance - 9.947) < 0.01) : (s.temp >= 20 && s.temp <= 30 && s.hum >= 40 && s.hum <= 70 && s.distance >= 5 && s.distance <= 200);
      const L = q.log; const lo = q.spec.shim ? new RegExp(`OUT pin=${q.relay} val=0`).test(L) && new RegExp(`OUT pin=${q.in1} val=1`).test(L) && new RegExp(`OUT pin=${q.in2} val=0`).test(L) && /PWM pin=\d+ level=255/.test(L) : new RegExp(`pin ${q.relay} -> LOW`).test(L) && new RegExp(`pin ${q.in1} -> HIGH`).test(L) && new RegExp(`pin ${q.in2} -> LOW`).test(L) && /PWM 255\/255/.test(L);
      ok(rd.length >= 1 && sensorsOk, `${q.tid}: DHT22 + HC-SR04 part blocks sent correct readings to the cloud`); ok(lo, `${q.tid}: relay (trigger-low -> pin LOW) and L298N forward 100 % drove the right pins`);
      if (!(sensorsOk && lo)) console.log('    got', JSON.stringify(s), '\n' + L.slice(0, 500));
    }
  } finally { srv.kill(); await sleep(700); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  console.log(fails ? `\n${fails} FAILED` : '\nALL LIBRARY TESTS PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
