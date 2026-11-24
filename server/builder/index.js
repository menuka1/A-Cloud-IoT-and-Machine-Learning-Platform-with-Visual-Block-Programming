'use strict';
const { TARGETS, BOARDS, BLOCKS, CATEGORIES, TEMPLATES, UNSUPPORTED } = require('./catalog');
const { normalize, validate, walk, analyze, slug, pinInfo } = require('./common');
const { generateArduino } = require('./gen-arduino');
const { generateMicroPython } = require('./gen-micropython');
const { generatePython } = require('./gen-python');
const lib = require('./library');
const { I2C } = require('./i2c-sensors');
const { generateNode } = require('./gen-node');

const GEN = { arduino: generateArduino, micropython: generateMicroPython, python: generatePython, nodejs: generateNode };

function wiring(P, T) {
  const lines = []; const seen = new Set(); const label = (p) => pinInfo(T.board, p)?.label || p;
  const add = (s) => { if (!seen.has(s)) { seen.add(s); lines.push(s); } };
  walk(P, (b) => {
    if (b.wiring) add(b.wiring);
    if (b.origin) return;
    if (b.type === 'read_dht') add(`DHT${b.model}: VCC -> 3V3, GND -> GND, DATA -> ${label(b.pin)}${b.model === '22' || true ? ' (add a 10k resistor between DATA and VCC if your sensor is a bare 4-pin one)' : ''}`);
    if (b.type === 'read_analog') add(`Analog sensor: signal -> ${label(b.pin)}, power -> 3V3, GND -> GND. Never feed more than 3.3 V into the pin${T.board === 'esp8266' ? ' (bare ESP8266 chips only tolerate 1 V; NodeMCU / Wemos boards have a divider for 3.3 V)' : ''}.`);
    if (b.type === 'read_digital') add(`Digital input: signal -> ${label(b.pin)}, other side -> ${b.pull === 'up' ? 'GND (internal pull-up is on)' : '3V3 (use a 10k pull-down to GND)'}.`);
    if (b.type === 'read_ultrasonic') add(`HC-SR04: VCC -> 5V, GND -> GND, TRIG -> ${label(b.trig)}, ECHO -> ${label(b.echo)} through a voltage divider (e.g. 1k + 2k) because ECHO outputs 5 V and your board's pins are 3.3 V.`);
    if (b.type === 'write_digital') add(`Output on ${label(b.pin)}: LED -> through a 220-330 ohm resistor to GND. Relay module: IN -> ${label(b.pin)}, VCC/GND per module (many relay boards are active-LOW).`);
    if (b.type === 'write_pwm') add(`PWM output on ${label(b.pin)}: LED via 220-330 ohm resistor to GND. Motors/fans need a transistor or MOSFET driver - never connect a motor directly to the pin.`);
  });
  return lines;
}

function notes(T, A, program, ctx) {
  const req = [], steps = [], l = T.lang, b = T.board;
  if (l === 'arduino') {
    req.push('Arduino IDE 2.x (or PlatformIO)');
    req.push(b === 'esp32' ? 'Boards Manager: "esp32" by Espressif Systems, version 3.0.0 or newer (needed for analogWrite)' : b === 'esp8266' ? 'Boards Manager: "esp8266" by ESP8266 Community, version 3.1 or newer' : 'Boards Manager: "Raspberry Pi Pico/RP2040" by Earle F. Philhower, III (select board "Raspberry Pi Pico W")');
    req.push('Library Manager: "ArduinoJson" by Benoit Blanchon, version 7 or newer');
    if (A.dht.size) req.push('Library Manager: "DHT sensor library" by Adafruit (+ "Adafruit Unified Sensor" when asked)');
    for (const lb of new Set([...A.i2c.values()].map((s) => I2C[s.sensor].arduino.lib))) req.push('Library Manager: "' + lb + '" (accept "install all" for the dependencies such as Adafruit BusIO / Unified Sensor)');
    steps.push(b === 'esp32' ? 'Tools > Board > esp32 > "ESP32 Dev Module" (or your exact board)' : b === 'esp8266' ? 'Tools > Board > esp8266 > "NodeMCU 1.0 (ESP-12E Module)" (or your exact board)' : 'Tools > Board > Raspberry Pi Pico/RP2040 > "Raspberry Pi Pico W"');
    steps.push(`Create a new sketch, paste the code (the sketch folder will be named after the file: ${slug(ctx.name)}).`, 'Connect the board by USB, choose its port in Tools > Port, click Upload.', 'Open Tools > Serial Monitor at 115200 baud: you should see the Wi-Fi connection and "send -> HTTP 200".');
    if (ctx.serverUrl.startsWith('https://')) steps.push('HTTPS note: the sketch skips certificate verification (setInsecure) so it works without installing certificates. For high-security use, pin your server certificate instead.');
  } else if (l === 'micropython') {
    req.push(`MicroPython firmware for ${b === 'esp32' ? 'ESP32 (v1.20 or newer)' : b === 'esp8266' ? 'ESP8266 (v1.20 or newer)' : 'Raspberry Pi Pico W (v1.20 or newer, the "W" build)'} - get it from micropython.org/download`, 'Thonny IDE (easiest) or mpremote');
    steps.push('Thonny: Run > Configure interpreter > pick your MicroPython board and port.', 'Paste the code, then File > Save as > "MicroPython device" and name it main.py.', 'Press the board\'s reset button (or unplug/replug). It starts automatically on every power-up.', 'Watch the Shell window: "Connected" then "send -> ..." lines.');
    if (b === 'esp8266') steps.push('ESP8266 has little RAM - if you get MemoryError, reduce the number of blocks or send fewer fields.');
  } else if (l === 'python') {
    req.push('Python 3.8 or newer');
    if (b === 'rpi') { req.push('Raspberry Pi OS (gpiozero is pre-installed; otherwise: sudo apt install python3-gpiozero)'); if (A.dht.size) req.push('For DHT sensors: pip install adafruit-circuitpython-dht  (and: sudo apt install libgpiod2)'); steps.push('Copy the file to your Pi and run: python3 ' + slug(ctx.name) + '.py', 'To start on boot, add it as a systemd service or to crontab with @reboot.'); }
    else steps.push('Run: python ' + slug(ctx.name) + '.py  (Windows) or python3 ' + slug(ctx.name) + '.py', 'No hardware needed: pin actions are printed as [sim] lines and sensors produce realistic random values.');
  } else {
    req.push('Node.js 18 or newer (uses built-in fetch)'); steps.push('Run: node ' + slug(ctx.name) + '.js', 'No packages to install. Pin actions are printed as [sim] lines.');
  }
  if (b !== 'pc') { /* nothing */ }
  if (A.i2c.size) { if (b === 'rpi') req.push('Enable the I2C bus once: sudo raspi-config > Interface Options > I2C (check with: sudo i2cdetect -y 1)'); steps.push('I2C sensors: if a reading never shows up (empty / nan), check the wiring and the I2C address - an I2C scanner (Arduino example, MicroPython i2c.scan(), or i2cdetect on a Pi) lists what the board can see.'); }
  steps.push('Open your TronicIOT dashboard > Devices > your device: live data appears within a few seconds.');
  if (A.handlers) steps.push('Create dashboard widgets (Switch / Slider) with the same command names as your handlers: ' + program.handlers.map((h) => `"${h.name}"`).join(', ') + '.');
  return { requirements: req, steps };
}

/** generate({ target, program, settings, token, name }) */
function generate({ target, program, settings = {}, token, name, boardId, custom = [] }) {
  const T = TARGETS[target]; if (!T) return { ok: false, errors: [{ id: null, msg: 'Unknown target' }], warnings: [] };
  const lb = boardId ? lib.boardById(boardId) : null;
  if (lb && !lb.ready) return { ok: false, errors: [{ id: null, msg: `${lb.name} is on the list but cannot generate code yet. Choose a ready board (or the simulator) in My Kit.` }], warnings: [] };
  if (lb && lb.targets.length && !lb.targets.includes(target)) return { ok: false, errors: [{ id: null, msg: `${lb.name} cannot run that language. Choose one of: ${lb.targets.map((t) => TARGETS[t].label).join(', ')}.` }], warnings: [] };
  const base = normalize(program); const ex = lib.expandProgram(base, { profile: T.board, vref: lib.vrefOf(T.board), custom });
  const P = ex.program; const v = validate(target, P, settings, { excludePins: lb?.excludePins || [] });
  const seen = new Set(); v.errors = [...ex.errors, ...v.errors].map((e) => ({ ...e, id: e.id ? String(e.id).split('#')[0] : null })).filter((e) => { const k = e.id + '|' + e.msg; if (seen.has(k)) return false; seen.add(k); return true; });
  { const PINF = ['pin', 'trig', 'echo', 'in1', 'in2', 'en', 'pina', 'pinb', 'rpin', 'gpin', 'bpin', 'xpin', 'ypin', 'bpin']; const owners = new Map();
    walk(P, (b) => { if (!b.origin) return; for (const k of PINF) { if (b[k] === undefined || b[k] === '') continue; const key = String(b[k]); if (!owners.has(key)) owners.set(key, new Map()); owners.get(key).set(b.partName, b.origin); } });
    for (const [pin, m] of owners) if (m.size > 1) v.warnings.push({ id: [...m.values()].pop(), msg: `${pinInfo(T.board, pin)?.label || pin} is shared by different parts (${[...m.keys()].join(' and ')}). Use separate pins unless you really wired them together.` }); }
  v.warnings = v.warnings.map((e) => ({ ...e, id: e.id ? String(e.id).split('#')[0] : null }));
  if (v.errors.length) return { ok: false, ...v };
  const warnings = [...v.warnings]; const board = BOARDS[T.board];
  const serverUrl = String(settings.serverUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(serverUrl)) return { ok: false, errors: [{ id: null, msg: 'Server address must look like http://192.168.1.20:3000 or https://iot.example.com' }], warnings };
  if (board.wifi && /\/\/(localhost|127\.0\.0\.1)/.test(serverUrl)) warnings.push({ id: null, msg: 'Server address is "localhost" - a Wi-Fi board cannot reach that. Use this computer\'s LAN IP (run ipconfig) or your public domain.' });
  if (!token) warnings.push({ id: null, msg: 'No device selected - the code contains tr_PASTE_DEVICE_TOKEN; choose a device so the token is filled in.' });
  const ctx = { target, name: String(name || 'project').slice(0, 60).replace(/[^\x20-\x7e]/g, '?'), token: token || 'tr_PASTE_DEVICE_TOKEN', serverUrl, ssid: settings.wifiSsid || 'YOUR_WIFI_NAME', pass: settings.wifiPass || 'YOUR_WIFI_PASSWORD' };
  const code = GEN[T.lang](P, ctx);
  const ext = { arduino: 'ino', micropython: 'py', python: 'py', nodejs: 'js' }[T.lang];
  const fname = T.lang === 'micropython' ? 'main.py' : `${slug(ctx.name)}.${ext}`;
  const A = analyze(P, T.board);
  return { ok: true, errors: [], warnings, files: [{ name: fname, content: code, language: T.lang === 'arduino' ? 'cpp' : T.lang === 'nodejs' ? 'javascript' : 'python' }], ...notes(T, A, P, ctx), wiring: wiring(P, T) };
}

const PART_BLOCKS = lib.partBlocks(); const LIBRARY = lib.libraryMeta();
function catalog(custom = []) { return { categories: CATEGORIES, blocks: { ...BLOCKS, ...PART_BLOCKS, ...lib.customBlocks(custom) }, boards: BOARDS, targets: TARGETS, templates: TEMPLATES, unsupported: UNSUPPORTED, library: LIBRARY, customKinds: lib.CUSTOM_KINDS }; }
module.exports = { generate, catalog, normalize, validate, lib };
