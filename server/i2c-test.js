'use strict';
// I2C sensors: datasheet test vectors, simulated chips, generated code run for real.
const { spawn, spawnSync } = require('child_process'); const path = require('path'); const os = require('os'); const fs = require('fs');
const builder = require('./builder'); const { pythonDrivers, I2C } = require('./builder/i2c-sensors');
const PORT = 3114, MQ = 19886, B = `http://localhost:${PORT}`;
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const near = (a, b, tol = 2e-3) => typeof a === 'number' && Math.abs(a - b) <= tol;
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'); const hasPy = !spawnSync(PY, ['--version']).error;
const cat = builder.catalog(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tronic-i-'));
const SHIM = path.join(__dirname, 'test-shims');

function staticCheckCpp(code) {
  const stripped = code.replace(/"(\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/gm, ''); const bal = { '(': 0, '{': 0, '[': 0 }; const pair = { ')': '(', '}': '{', ']': '[' };
  for (const ch of stripped) { if (bal[ch] !== undefined) bal[ch]++; if (pair[ch]) bal[pair[ch]]--; }
  const used = new Set(stripped.match(/\bv_[a-z0-9_]+/g) || []); const declared = new Set([...stripped.matchAll(/float (v_[a-z0-9_]+)/g)].map((m) => m[1]));
  return Object.values(bal).every((n) => n === 0) && [...used].every((u) => declared.has(u)) && /void setup\(\)/.test(code) && /void loop\(\)/.test(code);
}
const runPy = (src, env = {}) => spawnSync(PY, ['-c', src], { env: { ...process.env, PYTHONPATH: SHIM, ...env }, encoding: 'utf8' });

(async () => {
  if (!hasPy) { console.log('Python not found - skipping I2C driver tests'); process.exit(0); }
  console.log('Driver maths against published test vectors');
  const header = 'import time, random, math\nNAN = float("nan")\ndef i2c_w(*a): pass\ndef i2c_r(*a): pass\ndef i2c_wm(*a): pass\ndef i2c_rm(*a): pass\n';
  let r = runPy(header + pythonDrivers(['sht3x']) + '\nprint(_crc8([0xBE, 0xEF]))'); ok(r.stdout.trim() === '146', 'CRC-8 of 0xBEEF is 0x92 (value printed in the Sensirion SHT3x datasheet)');
  r = runPy(header + pythonDrivers(['bmp280']) + `\nc = dict(T1=27504, T2=26435, T3=-1000, P1=36477, P2=-10685, P3=3024, P4=2855, P5=140, P6=-7, P7=15500, P8=-14600, P9=6000)\nt, h, p = _bme_comp(c, 519888, 415148, None)\nprint(t, p)`);
  { const [t, p] = r.stdout.trim().split(' ').map(Number); ok(near(t, 25.08, 0.005) && near(p, 1006.5327, 0.0005), `BMP280 datasheet example: ${t} C, ${p} hPa (datasheet says 25.08 C and 100653.27 Pa)`); }
  r = runPy(header + pythonDrivers(['bmp280']) + '\nprint(_idiv(-7, 2), _idiv(7, -2), _idiv(7, 2), _idiv(-7, -2))'); ok(r.stdout.trim() === '-3 -3 3 3', 'integer division rounds toward zero like C');

  console.log('Generation: every I2C part on every target');
  const i2cParts = cat.library.parts.filter((p) => p.kind === 'i2c'); ok(i2cParts.length === 13 && i2cParts.every((p) => p.tier === 'beta'), `${i2cParts.length} I2C parts, all honestly labelled "beta"`);
  let bad = 0, count = 0;
  for (const [tid, T] of Object.entries(cat.targets)) for (const p of i2cParts) {
    const def = cat.blocks['p_' + p.id]; const blk = { type: 'p_' + p.id }; def.fields.forEach((f) => { blk[f.k] = f.default; });
    const res = builder.generate({ target: tid, program: { interval: 1, setup: [], handlers: [], loop: [blk, { type: 'log', text: 'x', value: '' }] }, settings: { serverUrl: 'http://192.168.1.5:3000' }, token: 'tr_x', name: p.name }); count++;
    if (!res.ok) { bad++; console.log('   ', tid, p.id, res.errors.map((e) => e.msg).join('|')); continue; }
    const code = res.files[0].content;
    if (T.lang === 'arduino' && !(staticCheckCpp(code) && code.includes('#include <Wire.h>') && /Wire\.begin\(\)/.test(code))) { bad++; console.log('    C++ structure', tid, p.id); }
    if (T.lang === 'arduino' && !res.requirements.some((x) => /Library Manager: "(Adafruit|BH1750)/.test(x))) { bad++; console.log('    missing library note', p.id); }
    if (T.lang === 'micropython' || T.lang === 'python') { const f = path.join(dir, 'g.py'); fs.writeFileSync(f, code); if (spawnSync(PY, ['-m', 'py_compile', f]).status) { bad++; console.log('    python syntax', tid, p.id); } }
    if (T.lang === 'nodejs') { const f = path.join(dir, 'g.js'); fs.writeFileSync(f, code); if (spawnSync(process.execPath, ['--check', f]).status) { bad++; console.log('    node syntax', tid, p.id); } }
  }
  ok(bad === 0, `${count} I2C part/target combinations generate valid code`);

  console.log('Validation');
  const gen = (target, loop, extra = {}) => builder.generate({ target, program: { interval: 1, setup: [], handlers: [], loop }, settings: { serverUrl: 'http://192.168.1.5:3000' }, token: 'tr_x', name: 'v', ...extra });
  const bme = { type: 'p_bme280', tvar: 't', hvar: 'h', pvar: 'p', addr: '0x76' };
  let g = gen('esp32-arduino', [bme, { type: 'write_digital', pin: '21', value: '1' }]); ok(!g.ok && g.errors.some((e) => /I2C/.test(e.msg)), 'a pin used for I2C (GPIO21 on ESP32) cannot also drive an output');
  g = gen('esp8266-micropython', [{ ...bme }, { type: 'read_dht', tvar: 'a', hvar: 'b', pin: '5', model: '22' }]); ok(!g.ok && g.errors.some((e) => /I2C/.test(e.msg)), 'ESP8266 I2C pins (D1/D2 = GPIO5/4) are protected too');
  g = gen('esp32-arduino', [{ ...bme, addr: '0x99' }]); ok(!g.ok && /address/.test(g.errors[0].msg), 'unknown I2C address is rejected');
  g = gen('esp32-arduino', [{ ...bme, hvar: 't' }]); ok(!g.ok && /own variable/.test(g.errors.map((e) => e.msg).join()), 'two readings cannot share one variable');
  g = gen('esp32-arduino', [bme, { type: 'read_analog', var: 'a', pin: '34', mode: 'percent' }, { type: 'read_dht', tvar: 'x', hvar: 'y', pin: '4', model: '21' }]); ok(g.ok, 'I2C coexists with other sensors on other pins; DHT21 accepted');
  g = gen('esp32-arduino', [bme, { ...bme, tvar: 't2', hvar: 'h2', pvar: 'p2' }]); ok(g.ok && (g.files[0].content.match(/Adafruit_BME280 bme280_76;/g) || []).length === 1, 'two blocks for the same sensor share one driver object');
  g = gen('esp32-micropython', [bme]); ok(g.ok && /SDA -> GPIO21, SCL -> GPIO22/.test(g.wiring.join()), 'wiring tab names the real SDA / SCL pins');
  g = gen('rpi-python', [bme]); ok(g.ok && g.requirements.some((x) => /raspi-config/.test(x)), 'Raspberry Pi: tells the user to enable the I2C bus');

  // ---------------- run generated code against simulated chips ----------------
  const srv = spawn(process.execPath, [path.join(__dirname, 'index.js')], { env: { ...process.env, PORT, MQTT_PORT: MQ, DATA_DIR: dir }, stdio: 'pipe' }); let srvLog = ''; srv.stdout.on('data', (b) => (srvLog += b)); srv.stderr.on('data', (b) => (srvLog += b));
  for (let i = 0; i < 40; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(250); }
  const call = async (method, p, body, token) => { const x = await fetch(B + '/api' + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j; try { j = await x.json(); } catch {} return { s: x.status, j }; };
  try {
    const T = (await call('POST', '/auth/register', { name: 'I2C Test', email: 'i@x.com', password: 'abc12345' })).j.token;
    console.log('Generated MicroPython drives simulated I2C chips');
    // independent double-precision humidity formula from the BME280 datasheet
    const tFine = (() => { const T1 = 27504, T2 = 26435, T3 = -1000, a = 519888; const v1 = (((a >> 3) - (T1 << 1)) * T2) >> 11; const v2 = (((((a >> 4) - T1) * ((a >> 4) - T1)) >> 12) * T3) >> 14; return v1 + v2; })();
    const H = { H1: 75, H2: 366, H3: 0, H4: 316, H5: 50, H6: 30 }; let vh = tFine - 76800; vh = (28000 - (H.H4 * 64 + (H.H5 / 16384) * vh)) * ((H.H2 / 65536) * (1 + (H.H6 / 67108864) * vh * (1 + (H.H3 / 67108864) * vh))); vh *= 1 - (H.H1 * vh) / 524288; const hExp = Math.max(0, Math.min(100, vh));
    const E = { t_bme: 25.08, p_bme: 1006.5327, h_bme: hExp, t_bmp: 25.08, p_bmp: 1006.5327, lux: 0x1234 / 1.2, t_aht: 419430 * 200 / 1048576 - 50, h_aht: 50, t_sht: -45 + 175 * 0x6666 / 65535, h_sht: 100 * 0x8000 / 65535, t_htu: -46.85 + 175.72 * (0x6660 / 65536), h_htu: -6 + 125 * (0x7C80 / 65536), t_mcp: 25, t_mcp2: -1, accel_x: 1, accel_y: -1, accel_z: 0.5, gyro_x: 1, gyro_y: -1, gyro_z: 2, chip_temp: 36.53 };
    const part = (id, o) => ({ type: 'p_' + id, ...o });
    const loop = [part('bme280', { tvar: 't_bme', hvar: 'h_bme', pvar: 'p_bme', addr: '0x76' }), part('bmp280', { tvar: 't_bmp', pvar: 'p_bmp', addr: '0x77' }), part('bh1750', { var: 'lux', addr: '0x23' }), part('aht20', { tvar: 't_aht', hvar: 'h_aht', addr: '0x38' }),
      part('sht31', { tvar: 't_sht', hvar: 'h_sht', addr: '0x44' }), part('htu21d', { tvar: 't_htu', hvar: 'h_htu', addr: '0x40' }), part('mcp9808', { tvar: 't_mcp', addr: '0x18' }), part('mcp9808', { tvar: 't_mcp2', addr: '0x19' }),
      part('mpu6050', { axvar: 'accel_x', ayvar: 'accel_y', azvar: 'accel_z', gxvar: 'gyro_x', gyvar: 'gyro_y', gzvar: 'gyro_z', tvar: 'chip_temp', addr: '0x68' }),
      part('bh1750', { var: 'lux_missing', addr: '0x5C' }),   // no chip there: must not crash, value must be left out
      { type: 'send_cloud', fields: [...Object.keys(E), 'lux_missing'].map((k) => ({ k, v: k })) }];
    const procs = [];
    const launch = async (tid, env = {}) => { const d = (await call('POST', '/devices', { name: tid + JSON.stringify(env).slice(0, 12), board: 'other' }, T)).j; const res = builder.generate({ target: tid, program: { interval: 1, setup: [], handlers: [], loop }, settings: { serverUrl: B }, token: d.token, name: 'i2c' });
      if (!res.ok) { ok(false, tid + ': ' + res.errors.map((e) => e.msg).join('|')); return; } const f = path.join(dir, `${tid}${Object.keys(env).length ? '-bad' : ''}.py`); fs.writeFileSync(f, res.files[0].content);
      const p = spawn(PY, [f], { env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONPATH: SHIM, ...env }, stdio: 'pipe' }); let log = ''; p.stdout.on('data', (b) => (log += b)); p.stderr.on('data', (b) => (log += b)); procs.push({ tid, env, d, p, get log() { return log; } }); };
    for (const tid of ['esp32-micropython', 'esp8266-micropython', 'picow-micropython']) await launch(tid);
    await launch('esp32-micropython', { TRONIC_I2C_VARIANT: 'badcrc' });
    await sleep(7000); procs.forEach((x) => x.p.kill()); await sleep(400);
    for (const x of procs) {
      const rd = (await call('GET', `/devices/${x.d.id}/readings?limit=3`, null, T)).j; const s = rd[rd.length - 1]?.data || {}; const badcrc = !!x.env.TRONIC_I2C_VARIANT;
      const wrong = Object.entries(E).filter(([k, v]) => !(badcrc && /_sht$/.test(k)) && !near(s[k], v, k === 'h_bme' ? 0.02 : 2e-3)).map(([k, v]) => `${k}: got ${s[k]} want ${+v.toFixed(4)}`);
      ok(rd.length >= 1 && wrong.length === 0 && !('lux_missing' in s), badcrc ? `${x.tid} with a corrupted SHT31 CRC: bad reading is rejected, all other sensors still correct` : `${x.tid}: BME280, BMP280, BH1750, AHT20, SHT31, HTU21D, MCP9808 (+/-), MPU6050 all decode correctly; missing chip is skipped`);
      if (badcrc) ok(!('t_sht' in s) && !('h_sht' in s), 'corrupted data never reaches the dashboard'); else ok(/BH1750 error/.test(x.log), `${x.tid}: missing sensor is reported in the log instead of crashing`);
      if (wrong.length) console.log('    ', wrong.join('; '), '\n', x.log.slice(0, 400));
    }

    console.log('Computer targets simulate I2C sensors');
    const simLoop = [part('bme280', { tvar: 't_bme', hvar: 'h_bme', pvar: 'p_bme', addr: '0x76' }), part('mpu6050', { axvar: 'ax', ayvar: 'ay', azvar: 'az', gxvar: 'gx', gyvar: 'gy', gzvar: 'gz', tvar: 'tc', addr: '0x68' }), part('aht20', { tvar: 't_aht', hvar: 'h_aht', addr: '0x38' }), { type: 'send_cloud', fields: ['t_bme', 'h_bme', 'p_bme', 'az', 't_aht', 'h_aht'].map((k) => ({ k, v: k })) }];
    const sims = [];
    for (const tid of ['pc-python', 'rpi-python', 'pc-nodejs']) { const d = (await call('POST', '/devices', { name: 'sim-' + tid, board: 'other' }, T)).j; const board = cat.targets[tid].board; const res = builder.generate({ target: tid, program: { interval: 1, setup: [], handlers: [], loop: simLoop }, settings: { serverUrl: B }, token: d.token, name: 'sim' });
      if (!res.ok) { ok(false, tid + ': ' + res.errors.map((e) => e.msg).join('|')); continue; } const node = tid === 'pc-nodejs'; const f = path.join(dir, 'sim-' + tid + (node ? '.js' : '.py')); fs.writeFileSync(f, res.files[0].content);
      const p = spawn(node ? process.execPath : PY, [f], { env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }, stdio: 'pipe' }); let log = ''; p.stdout.on('data', (b) => (log += b)); p.stderr.on('data', (b) => (log += b)); sims.push({ tid, d, p, board, get log() { return log; } }); }
    await sleep(4500); sims.forEach((x) => x.p.kill()); await sleep(400);
    for (const x of sims) { const rd = (await call('GET', `/devices/${x.d.id}/readings?limit=3`, null, T)).j; const s = rd[0]?.data || {}; ok(rd.length >= 1 && s.t_bme >= 18 && s.t_bme <= 28 && s.p_bme >= 1000 && s.p_bme <= 1025 && s.az >= 0.9 && s.az <= 1.1 && s.h_aht >= 35 && s.h_aht <= 65, `${x.tid}: simulated I2C sensors give plausible readings`); if (x.tid === 'rpi-python') ok(/I2C bus not available/.test(x.log) || rd.length >= 1, 'rpi-python falls back to simulation when /dev/i2c-1 is missing'); }
  } finally { srv.kill(); await sleep(700); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  console.log(fails ? `\n${fails} FAILED` : '\nALL I2C TESTS PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
