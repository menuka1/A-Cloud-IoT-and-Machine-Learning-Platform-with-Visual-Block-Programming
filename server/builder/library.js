'use strict';
/* Parts library + recipes. A "part block" (type p_<id> or cp_<id>) expands into the primitive blocks
 * (read_analog, read_digital, calc, write_digital, ...) that the four code generators already handle and the test-suite already runs. */
const { BOARDS } = require('./catalog');
const { CATEGORIES, PART_LISTS, INFO_NAMES, BOARDS_LIB } = require('./library-data');
const { I2C } = require('./i2c-sensors');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const round = (x) => +Number(x).toFixed(6);

// ---------- spec shortcuts ----------
const an = (v, hint = '', p = {}) => ({ kind: 'analog', var: v, hint, ...p });
const di = (v, active, pull, hint = '') => ({ kind: 'digital_in', var: v, active, pull, hint });
const dout = (trigger, hint = '', pin = '@dout2') => ({ kind: 'digital_out', trigger, hint, pin });
const MQ = 'Needs 5 V for its heater and a few minutes (ideally 24 h the first time) to warm up. Its analog pin can reach 5 V: use a 2-resistor divider (e.g. 10k + 20k) before a 3.3 V board pin. The value is relative, not exact ppm.';
const SOIL = 'Dry soil gives one end of the scale, wet soil the other (capacitive sensors read LOWER when wet). Test dry/wet and use "Scale / map a value" to get a clean 0-100 %.';
const RAW = 'Gives a relative 0-100 % signal. For real units, calibrate it with a known sample and use "Scale / map a value".';
const MOTOR = 'Motor power comes from its own battery/supply, never from the board pin. Join all grounds together.';

const READY = {
  DHT11: { kind: 'dht', model: '11' }, DHT22: { kind: 'dht', model: '22' }, AM2301: { kind: 'dht', model: '21' },
  LM35: an('temp', 'Gives degrees Celsius (10 mV per degree). Supply 3.3-5 V.', { mult: (c) => c.vref }),
  TMP36: an('temp', 'Gives degrees Celsius. Supply 3.3 V.', { mult: (c) => c.vref, add: -50 }),
  'HC-SR04': { kind: 'ultrasonic' }, 'HC-SR05': { kind: 'ultrasonic' }, 'JSN-SR04T': { kind: 'ultrasonic', hint: 'Waterproof probe: needs 5 V, use "Trig/Echo" mode (R27 = 47k, default).' }, 'US-100': { kind: 'ultrasonic', hint: 'Remove the jumper so it uses Trig/Echo mode.' }, 'US-015': { kind: 'ultrasonic' },
  'E18-D80NK': di('obstacle', 'low', 'none', 'Needs 5 V; its output is open-collector: add a 10k pull-up to 3.3 V (or use the up setting on a pin that has one). 1 = obstacle detected.'),
  TCRT5000: di('line', 'low', 'none', 'Module output goes LOW when it sees a reflective surface. Flip the "detected when" setting if yours is opposite.'),
  'IR Obstacle Sensor': di('obstacle', 'low', 'none', 'Module output is LOW when something is in front. Flip "detected when" if yours is opposite. Adjust the blue potentiometer for range.'),
  'IR Proximity Sensor': di('near', 'low', 'none', 'Module output is usually LOW when something is near. Flip "detected when" if opposite.'),
  'Magnetic Proximity Sensor': di('magnet', 'low', 'up', 'A reed-style sensor: closes when a magnet is near.'),
  'MQ-2': an('gas', MQ), 'MQ-3': an('alcohol', MQ), 'MQ-4': an('methane', MQ), 'MQ-5': an('lpg', MQ), 'MQ-6': an('lpg', MQ), 'MQ-7': an('co', MQ), 'MQ-8': an('hydrogen', MQ), 'MQ-9': an('co', MQ), 'MQ-131': an('ozone', MQ), 'MQ-135': an('air_quality', MQ), 'MQ-136': an('h2s', MQ), 'MQ-137': an('ammonia', MQ), 'MQ-138': an('voc', MQ), 'MQ-303A': an('alcohol', MQ), 'MQ-309A': an('co', MQ), 'MiCS-5524': an('gas', MQ),
  LDR: an('light', 'Wire it as a divider: 3V3 - LDR - signal pin - 10k resistor - GND. Brighter light gives a higher number.'), TEMT6000: an('light', 'Ambient-light module: S pin to the analog pin. Brighter = higher.'), 'GUVA-S12SD': an('uv', 'UV level (relative). Supply 3.3 V.'),
  'Soil Moisture Sensor': an('soil', SOIL), 'Capacitive Soil Moisture Sensor': an('soil', SOIL), 'Resistive Soil Moisture Sensor': an('soil', SOIL + ' Resistive probes corrode: power them only while reading if you can.'),
  'Rain Sensor': an('rain', 'Wet board gives a lower/higher number depending on the module: test with a few drops.'), 'Raindrop Detection Sensor': an('rain', 'Wet board gives a lower/higher number depending on the module: test with a few drops.'),
  'Water Level Sensor': an('level', 'Only the exposed traces get wet - never submerge the electronics. Probes corrode: power on only when reading if you can.'), 'Turbidity Sensor': an('turbidity', RAW),
  'pH Sensor': an('ph_raw', RAW + ' pH needs a 2-point calibration (pH 4 and 7 buffer).'), 'TDS Sensor': an('tds_raw', RAW), 'EC Sensor': an('ec_raw', RAW), 'ORP Sensor': an('orp_raw', RAW), 'Dissolved Oxygen Sensor': an('do_raw', RAW), 'Salinity Sensor': an('salinity_raw', RAW), 'Leaf Wetness Sensor': an('wetness', RAW),
  'Float Switch': di('float_up', 'low', 'up', 'A switch that closes when the float rises. 1 = switch closed.'),
  'KY-037': an('sound', 'Reads the sound level at this instant (one sample). Turn the blue screw to set sensitivity.'), 'KY-038': an('sound', 'Reads the sound level at this instant (one sample).'), MAX9814: an('sound', 'Microphone amplifier: reads the level at this instant (one sample).'), MAX4466: an('sound', 'Microphone amplifier: reads the level at this instant (one sample).'), 'Microphone Module': an('sound', 'Reads the sound level at this instant (one sample).'), 'Analog Sound Sensor': an('sound', 'Reads the sound level at this instant (one sample).'),
  'Sound Detection Module': di('sound', 'high', 'none', 'The DO pin switches when sound passes the blue-screw threshold. Flip "detected when" if yours is opposite.'), 'Digital Sound Sensor': di('sound', 'high', 'none', 'The DO pin switches when sound passes the threshold. Flip "detected when" if opposite.'),
  'HC-SR501 PIR': di('motion', 'high', 'none', 'Needs 5 V (signal is 3.3 V). Warms up for ~1 minute after power-on.'), 'HC-SR505 PIR': di('motion', 'high', 'none', 'Mini PIR, 5-12 V supply, 3.3 V signal.'), 'AM312 PIR': di('motion', 'high', 'none', 'Works from 3.3 V.'), 'RCWL-0516 Microwave Radar': di('motion', 'high', 'none', 'Detects movement through thin walls/plastic. 1 = movement.'),
  LD2410: di('presence', 'high', 'none', 'Uses only its OUT pin (1 = someone present). Needs 5 V; OUT is 3.3 V.'),
  'A3144 Hall Sensor': di('magnet', 'low', 'up', 'Open-collector output: output goes LOW when a magnet (south pole) is near.'), 'KY-003 Hall Sensor': di('magnet', 'low', 'none', 'Module has its own pull-up: output goes LOW near a magnet.'),
  SS49E: an('field', 'Linear hall sensor: rests near 50 % and moves up/down with the magnet.'), OH49E: an('field', 'Linear hall sensor: rests near 50 % and moves up/down with the magnet.'),
  'Reed Switch': di('closed', 'low', 'up', 'One wire to the pin, the other to GND. 1 = switch closed (magnet near).'), 'Magnetic Door Sensor': di('door_closed', 'low', 'up', 'One wire to the pin, the other to GND. 1 = door closed (magnet near).'),
  L298N: { kind: 'motor_dir_pwm', hint: MOTOR + ' Remove the ENA jumper and wire ENA to the PWM pin.' }, L293D: { kind: 'motor_dir_pwm', hint: MOTOR }, TB6612FNG: { kind: 'motor_dir_pwm', hint: MOTOR + ' Connect STBY to 3.3 V.' },
  L9110S: { kind: 'motor_dual_pwm', hint: MOTOR }, L9110: { kind: 'motor_dual_pwm', hint: MOTOR }, DRV8833: { kind: 'motor_dual_pwm', hint: MOTOR + ' Connect SLEEP to 3.3 V.' }, BTS7960: { kind: 'motor_dual_pwm', hint: MOTOR + ' Connect both enable pins (R_EN, L_EN) to 3.3 V.' },
  '1 Channel Relay': dout('low', 'Most relay boards switch ON when the pin is LOW ("trigger low"). Change "turns on when pin is" if yours is the opposite. Mains voltage is dangerous: ask an experienced adult.'),
  '2 Channel Relay': dout('low', 'One block per channel (IN1, IN2...). Most boards are "trigger low". Mains voltage is dangerous.'), '4 Channel Relay': dout('low', 'One block per channel. Most boards are "trigger low". Mains voltage is dangerous.'), '8 Channel Relay': dout('low', 'One block per channel. Most boards are "trigger low". Mains voltage is dangerous.'), '16 Channel Relay': dout('low', 'One block per channel. Most boards are "trigger low". Mains voltage is dangerous.'),
  '5V Relay': dout('low', 'Use a relay MODULE (with driver transistor). Most are "trigger low".'), '12V Relay': dout('low', 'Use a relay MODULE (with driver transistor). Most are "trigger low".'), '24V Relay': dout('low', 'Use a relay MODULE (with driver transistor). Most are "trigger low".'),
  'Solid State Relay': dout('high', 'Input is usually 3-32 V DC: ON when the pin is HIGH.'), 'SSR Module': dout('high', 'ON when the pin is HIGH. Mains voltage is dangerous.'),
  'MOSFET Module': { kind: 'pwm_out', hint: 'Dimmer/switch for DC loads (LED strips, fans, motors). Load power comes from its own supply; join the grounds.' }, 'IRF520 MOSFET': { kind: 'pwm_out', hint: 'The IRF520 needs ~10 V to switch fully: it is weak from a 3.3 V pin. Prefer a logic-level MOSFET.' }, 'IRLZ44N MOSFET': { kind: 'pwm_out', hint: 'Logic-level MOSFET: good from 3.3 V. Gate -> pin (add 220 ohm), Source -> GND, Drain -> load.' }, 'AO3400 MOSFET': { kind: 'pwm_out', hint: 'Small logic-level MOSFET for low-current DC loads.' },
  'Voltage Sensor Module': an('voltage', 'The 0-25 V module has a 5:1 divider (change the ratio below if yours differs). Never exceed 25 V.', { ratio: 5 }), 'Battery Voltage Monitor': an('battery_v', 'Use a divider so the pin never sees more than 3.3 V. Set the ratio to (R1+R2)/R2.', { ratio: 5 }),
  'TTP223 Touch Sensor': di('touch', 'high', 'none', 'Output is HIGH while touched (default mode).'), 'Capacitive Touch Sensor': di('touch', 'high', 'none', 'Output is HIGH while touched.'), 'Touch Button Module': di('touch', 'high', 'none', 'Output is HIGH while touched.'),
  'Push Button Module': di('pressed', 'low', 'up', 'One leg to the pin, the other to GND. 1 = pressed.'), 'Toggle Switch': di('switch_on', 'low', 'up', 'One leg to the pin, the other to GND. 1 = switched on.'), 'Limit Switch': di('hit', 'low', 'up', 'COM to GND, NO to the pin. 1 = pressed.'), 'Endstop Switch': di('hit', 'low', 'up', 'COM to GND, NO to the pin. 1 = pressed.'), 'Foot Switch': di('pressed', 'low', 'up', 'One leg to the pin, the other to GND. 1 = pressed.'),
  'Joystick Module': { kind: 'joystick' }, 'Analog Joystick': { kind: 'joystick' }, 'PS2 Joystick': { kind: 'joystick' },
  'Active Buzzer': dout('high', 'Beeps while ON. (Active buzzers beep by themselves; they cannot play tunes.)'),
  'IR Flame Sensor': di('flame', 'low', 'none', 'Output goes LOW when it sees a flame. Flip "detected when" if opposite. Not a safety device!'), 'Flame Detection Module': di('flame', 'low', 'none', 'Output goes LOW when it sees a flame. Not a safety device!'),
  'Smoke Sensor': an('smoke', MQ), 'Gas Leakage Sensor': an('gas', MQ), 'Fire Detection Sensor': di('flame', 'low', 'none', 'Output goes LOW when fire is seen. Not a safety device!'), 'Flame Sensor': di('flame', 'low', 'none', 'Output goes LOW when a flame is seen. Not a safety device!'),
  'Vibration Sensor SW-420': di('vibration', 'high', 'none', 'Output goes HIGH on vibration. Flip "detected when" if opposite.'), 'Tilt Sensor': di('tilt', 'low', 'up', 'A tilt switch: one leg to the pin, the other to GND.'), 'Shock Sensor': di('shock', 'low', 'up', 'A shock/knock switch: one leg to the pin, the other to GND.'),
  'Door Magnetic Sensor': di('door_closed', 'low', 'up', '1 = door closed (magnet near).'), 'Window Magnetic Sensor': di('window_closed', 'low', 'up', '1 = window closed (magnet near).'),
  'Water Leakage Sensor': an('leak', 'Wet = higher/lower number depending on the module: test with a damp finger.'), 'Tamper Switch': di('tamper', 'low', 'up', 'One leg to the pin, the other to GND. 1 = switch pressed.'),
  'Heart Rate Sensor': an('pulse_raw', 'The raw pulse waveform. Read it often (every 20 ms) to find beats: this block reads one sample.'), 'ECG AD8232': an('ecg_raw', 'Raw ECG signal. This is a hobby sensor, not a medical device.'), 'EMG Sensor': an('emg_raw', 'Raw muscle signal. Hobby sensor, not a medical device.'), 'GSR Sensor': an('gsr_raw', RAW), 'Galvanic Skin Response Sensor': an('gsr_raw', RAW), 'UV Sensor': an('uv', 'UV level (relative).'),
  'Flex Sensor': an('bend', 'Wire it as a divider with a 10k resistor to GND. More bend = higher number.'), 'Bend Sensor': an('bend', 'Wire it as a divider with a 10k resistor to GND.'), 'PIR Sensor': di('motion', 'high', 'none', 'Needs 5 V (signal is 3.3 V) for most modules.'),
  LEDs: { kind: 'digital_out', trigger: 'high', pin: '@led', hint: 'Always use a 220-330 ohm resistor in series with an LED.' }, 'RGB LEDs': { kind: 'rgb', hint: 'Use a 220-330 ohm resistor on each color leg.' }, Potentiometers: an('knob', 'Outer legs to 3V3 and GND, middle leg to the analog pin. Turning it gives 0-100 %.'),
};

// ---------- I2C parts (BETA: verified with simulated chips + datasheet test vectors, not yet on real hardware) ----------
const I2CH = "Connect SDA and SCL to the board's fixed I2C pins (see the Wiring tab). Most breakout boards already include the pull-up resistors I2C needs. Power it from 3.3 V.";
const i2c = (sensor, hint = '', extra = {}) => ({ kind: 'i2c', sensor, hint: hint + ' ' + I2CH, beta: true, ...extra });
const BETA = {
  BME280: i2c('bme280', 'Temperature, humidity and pressure (hPa).'), BMP280: i2c('bmp280', 'Temperature and pressure (hPa). It has NO humidity sensor - cheap "BME280" boards are sometimes really BMP280.'),
  BH1750: i2c('bh1750', 'Light level in lux.'), AHT10: i2c('aht', 'Temperature and humidity.', { model: '10' }), AHT20: i2c('aht', 'Temperature and humidity.', { model: '20' }), AHT21: i2c('aht', 'Temperature and humidity (same protocol as AHT20).', { model: '20' }),
  SHT30: i2c('sht3x', 'Temperature and humidity.'), SHT31: i2c('sht3x', 'Temperature and humidity.'), SHT35: i2c('sht3x', 'Temperature and humidity.'),
  HTU21D: i2c('htu21', 'Temperature and humidity.', { model: 'htu21d' }), Si7021: i2c('htu21', 'Temperature and humidity.', { model: 'si7021' }),
  MCP9808: i2c('mcp9808', 'Precise temperature (0.0625 C steps).'), MPU6050: i2c('mpu6050', 'Accelerometer (g) and gyroscope (deg/s). Lying flat and still, Z reads about 1 g.'),
};

// ---------- parts list ----------
const parts = new Map();
for (const cat of CATEGORIES) {
  for (const name of PART_LISTS[cat.id] || []) {
    const id = slug(name); let p = parts.get(id);
    if (!p) { p = { id, name, cats: [], tier: 'soon', kind: null, hint: '' }; parts.set(id, p); }
    if (!p.cats.includes(cat.id)) p.cats.push(cat.id);
  }
}
for (const p of parts.values()) {
  const spec = READY[p.name] || BETA[p.name];
  if (spec) { p.tier = spec.beta ? 'beta' : 'ready'; p.kind = spec.kind; p.spec = spec; p.hint = spec.hint || ''; }
  else if (INFO_NAMES.has(p.name) || p.cats.every((c) => c === 'tools')) p.tier = 'info';
}
for (const n of [...Object.keys(READY), ...Object.keys(BETA)]) if (!parts.has(slug(n))) throw new Error('READY part missing from lists: ' + n);

// ---------- block definitions ----------
const F = {
  v: (def, label = 'save into') => ({ k: 'var', kind: 'var', label, default: def }),
  pin: (k, cap, label, def, extra = {}) => ({ k, kind: 'pin', cap, label, default: def, ...extra }),
  sel: (k, label, options, def) => ({ k, kind: 'select', label, options, default: def }),
};
function fieldsFor(spec) {
  switch (spec.kind) {
    case 'analog': return [F.v(spec.var), F.pin('pin', 'adc', 'pin', '@adc'), ...(spec.ratio ? [{ k: 'ratio', kind: 'number', label: 'divider ratio', default: spec.ratio, min: 1, max: 1000 }] : [])];
    case 'digital_in': return [F.v(spec.var, '1 when'), F.pin('pin', 'din', 'pin', '@din', spec.pull === 'up' ? { pullup: true } : {}), F.sel('active', 'detected when pin is', [['high', 'HIGH'], ['low', 'LOW']], spec.active)];
    case 'digital_out': return [F.pin('pin', 'dout', 'pin', spec.pin || '@dout2'), { k: 'state', kind: 'operand', label: 'turn on? (1 = on, 0 = off)', default: '1' }, F.sel('trigger', 'turns on when pin is', [['high', 'HIGH'], ['low', 'LOW']], spec.trigger)];
    case 'pwm_out': return [F.pin('pin', 'pwm', 'pin', '@pwm'), { k: 'level', kind: 'operand', label: 'power 0-100 %', default: '50' }];
    case 'rgb': return [F.pin('rpin', 'pwm', 'red pin', '@pwm'), F.pin('gpin', 'pwm', 'green pin', '@pwm'), F.pin('bpin', 'pwm', 'blue pin', '@pwm'), { k: 'r', kind: 'operand', label: 'red 0-255', default: '255' }, { k: 'g', kind: 'operand', label: 'green 0-255', default: '0' }, { k: 'b', kind: 'operand', label: 'blue 0-255', default: '0' }, F.sel('common', 'LED type', [['cathode', 'common cathode (-)'], ['anode', 'common anode (+)']], 'cathode')];
    case 'ultrasonic': return [F.v('distance', 'distance (cm) into'), F.pin('trig', 'dout', 'trig pin', '@trig'), F.pin('echo', 'din', 'echo pin', '@echo')];
    case 'dht': return [F.v('temp', 'temperature into'), { ...F.v('hum', 'humidity into'), k: 'hvar' }, F.pin('pin', 'dht', 'data pin', '@dht')].map((f, i) => (i === 0 ? { ...f, k: 'tvar' } : f));
    case 'motor_dir_pwm': return [F.pin('in1', 'dout', 'IN1 pin', '@dout2'), F.pin('in2', 'dout', 'IN2 pin', '@dout2'), F.pin('en', 'pwm', 'speed (EN) pin', '@pwm'), F.sel('direction', 'direction', [['forward', 'forward'], ['backward', 'backward'], ['stop', 'stop']], 'forward'), { k: 'speed', kind: 'operand', label: 'speed 0-100 %', default: '50' }];
    case 'motor_dual_pwm': return [F.pin('pina', 'pwm', 'pin A', '@pwm'), F.pin('pinb', 'pwm', 'pin B', '@pwm'), F.sel('direction', 'direction', [['forward', 'forward'], ['backward', 'backward'], ['stop', 'stop']], 'forward'), { k: 'speed', kind: 'operand', label: 'speed 0-100 %', default: '50' }];
    case 'joystick': return [F.v('joy_x', 'X into'), F.pin('xpin', 'adc', 'X pin', '@adc'), { ...F.v('joy_y', 'Y into'), k: 'yvar' }, F.pin('ypin', 'adc', 'Y pin', '@adc'), { ...F.v('joy_btn', 'button (1 = pressed) into'), k: 'bvar' }, F.pin('bpin', 'din', 'button pin', '@din', { pullup: true })].map((f, i) => (i === 0 ? { ...f, k: 'xvar' } : f));
    case 'i2c': { const S = I2C[spec.sensor]; return [...S.outs.map(([k, label, def]) => ({ k, kind: 'var', label, default: def })), F.sel('addr', 'I2C address', S.addrs, S.addrs[0][0])]; }
    default: return [];
  }
}
const TINT = { analog: '#0891b2', digital_in: '#0891b2', dht: '#0891b2', ultrasonic: '#0891b2', joystick: '#0891b2', digital_out: '#16a34a', pwm_out: '#16a34a', rgb: '#16a34a', motor_dir_pwm: '#ca8a04', motor_dual_pwm: '#ca8a04', i2c: '#0891b2' };
function blockDef(p, spec, custom = false) { return { cat: 'My Parts', label: p.name, part: p.id, custom, tint: TINT[spec.kind] || '#0891b2', help: (spec.beta ? 'BETA: works in tests, not yet checked on real hardware. ' : '') + (spec.hint || ''), beta: !!spec.beta, kind: spec.kind, fields: fieldsFor(spec) }; }

// ---------- custom (user-made) parts ----------
const CUSTOM_KINDS = { analog: 'Analog sensor (reads a number)', digital_in: 'Digital sensor / button (on or off)', digital_out: 'Switch / relay / LED (turn on or off)', pwm_out: 'Dimmer / speed (0-100 %)' };
function customSpec(c) {
  const p = JSON.parse(c.params || '{}');
  if (c.kind === 'analog') return { kind: 'analog', var: c.var || 'value', hint: p.note || '', mult: Number.isFinite(+p.mult) ? +p.mult : 1, add: Number.isFinite(+p.add) ? +p.add : 0 };
  if (c.kind === 'digital_in') return { kind: 'digital_in', var: c.var || 'state', active: p.active === 'low' ? 'low' : 'high', pull: p.pull === 'up' ? 'up' : 'none', hint: p.note || '' };
  if (c.kind === 'digital_out') return { kind: 'digital_out', trigger: p.trigger === 'low' ? 'low' : 'high', pin: '@dout2', hint: p.note || '' };
  if (c.kind === 'pwm_out') return { kind: 'pwm_out', hint: p.note || '' };
  return null;
}
const customBlocks = (list) => Object.fromEntries(list.map((c) => { const s = customSpec(c); return s ? ['cp_' + c.id, blockDef({ id: 'c' + c.id, name: c.name }, s, true)] : null; }).filter(Boolean));

// ---------- expansion ----------
const labelOf = (profile, id) => BOARDS[profile]?.pins.find((p) => p.id === String(id))?.label || id;
function expandOne(b, spec, ctx) {
  let n = 0; const base = 'z' + String(b.id).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10);
  const tmp = () => base + (++n); const out = []; let seq = 0;
  const P = (o) => out.push({ ...o, id: `${b.id}#${++seq}`, origin: b.id, partName: b.part });
  const pct255 = (value) => { const a = tmp(), c = tmp(); P({ type: 'calc', var: a, left: value, op: '*', right: '255' }); P({ type: 'calc', var: c, left: a, op: '/', right: '100' }); return c; };
  const lab = (k) => labelOf(ctx.profile, b[k]);
  switch (spec.kind) {
    case 'analog': {
      let mult = typeof spec.mult === 'function' ? spec.mult(ctx, b) : (spec.mult ?? 1); const add = typeof spec.add === 'function' ? spec.add(ctx, b) : (spec.add ?? 0);
      if (spec.ratio) mult = (ctx.vref / 100) * Number(b.ratio || spec.ratio); mult = round(mult);
      if (mult === 1 && !add) P({ type: 'read_analog', var: b.var, pin: b.pin, mode: 'percent' });
      else { const t = tmp(); P({ type: 'read_analog', var: t, pin: b.pin, mode: 'percent' }); P({ type: 'calc', var: b.var, left: t, op: '*', right: String(mult) }); if (add) P({ type: 'calc', var: b.var, left: b.var, op: '+', right: String(round(add)) }); }
      out[0].wiring = `${b.part}: signal -> ${lab('pin')}; power per the module (3V3, or 5V with a divider on the signal); GND -> GND.${spec.hint ? ' ' + spec.hint : ''}`; break;
    }
    case 'digital_in': {
      const low = b.active === 'low';
      if (low) { const t = tmp(); P({ type: 'read_digital', var: t, pin: b.pin, pull: spec.pull === 'up' ? 'up' : 'none' }); P({ type: 'calc', var: b.var, left: '1', op: '-', right: t }); }
      else P({ type: 'read_digital', var: b.var, pin: b.pin, pull: spec.pull === 'up' ? 'up' : 'none' });
      out[0].wiring = `${b.part}: output -> ${lab('pin')}; power per the module; GND -> GND.${spec.hint ? ' ' + spec.hint : ''}`; break;
    }
    case 'digital_out': {
      if (b.trigger === 'low') { const t = tmp(); P({ type: 'calc', var: t, left: '1', op: '-', right: b.state }); P({ type: 'write_digital', pin: b.pin, value: t }); } else P({ type: 'write_digital', pin: b.pin, value: b.state });
      out[0].wiring = `${b.part}: control pin -> ${lab('pin')}; power per the module; GND -> GND.${spec.hint ? ' ' + spec.hint : ''}`; break;
    }
    case 'pwm_out': { const t = pct255(b.level); P({ type: 'write_pwm', pin: b.pin, value: t }); out[0].wiring = `${b.part}: control pin -> ${lab('pin')}; the load has its own supply; join all GND.${spec.hint ? ' ' + spec.hint : ''}`; break; }
    case 'rgb': {
      [['rpin', 'r'], ['gpin', 'g'], ['bpin', 'b']].forEach(([pk, vk]) => { if (b.common === 'anode') { const t = tmp(); P({ type: 'calc', var: t, left: '255', op: '-', right: b[vk] }); P({ type: 'write_pwm', pin: b[pk], value: t }); } else P({ type: 'write_pwm', pin: b[pk], value: b[vk] }); });
      out[0].wiring = `RGB LED: R -> ${lab('rpin')}, G -> ${lab('gpin')}, B -> ${lab('bpin')} (each through 220-330 ohm); common leg -> ${b.common === 'anode' ? '3V3' : 'GND'}.`; break;
    }
    case 'ultrasonic': P({ type: 'read_ultrasonic', var: b.var, trig: b.trig, echo: b.echo }); out[0].wiring = `${b.part}: VCC -> 5V, GND -> GND, TRIG -> ${lab('trig')}, ECHO -> ${lab('echo')} through a voltage divider (1k + 2k) because ECHO is 5 V.${spec.hint ? ' ' + spec.hint : ''}`; break;
    case 'dht': P({ type: 'read_dht', tvar: b.tvar, hvar: b.hvar, pin: b.pin, model: spec.model }); out[0].wiring = `${b.part}: VCC -> 3V3, GND -> GND, DATA -> ${lab('pin')} (add a 10k resistor between DATA and VCC if it is a bare 4-pin sensor).`; break;
    case 'motor_dir_pwm': {
      const dir = b.direction; const f = dir === 'forward';
      P({ type: 'write_digital', pin: b.in1, value: f ? '1' : '0' }); P({ type: 'write_digital', pin: b.in2, value: dir === 'backward' ? '1' : '0' });
      if (dir === 'stop') P({ type: 'write_pwm', pin: b.en, value: '0' }); else { const t = pct255(b.speed); P({ type: 'write_pwm', pin: b.en, value: t }); }
      out[0].wiring = `${b.part}: IN1 -> ${lab('in1')}, IN2 -> ${lab('in2')}, EN/PWM -> ${lab('en')}; motor supply on its own battery; join all GND.${spec.hint ? ' ' + spec.hint : ''}`; break;
    }
    case 'motor_dual_pwm': {
      const dir = b.direction;
      if (dir === 'stop') { P({ type: 'write_pwm', pin: b.pina, value: '0' }); P({ type: 'write_pwm', pin: b.pinb, value: '0' }); }
      else { const t = pct255(b.speed); P({ type: 'write_pwm', pin: dir === 'forward' ? b.pina : b.pinb, value: t }); P({ type: 'write_pwm', pin: dir === 'forward' ? b.pinb : b.pina, value: '0' }); }
      out[0].wiring = `${b.part}: input A -> ${lab('pina')}, input B -> ${lab('pinb')}; motor supply on its own battery; join all GND.${spec.hint ? ' ' + spec.hint : ''}`; break;
    }
    case 'i2c': {
      const S = I2C[spec.sensor]; const o = { type: 'i2c_' + spec.sensor, addr: b.addr || S.addrs[0][0] }; S.outs.forEach(([k]) => { o[k] = b[k]; }); if (spec.model) o.model = spec.model; P(o);
      const ic = BOARDS[ctx.profile]?.i2c; out[0].wiring = `${b.part}: VCC -> 3V3, GND -> GND, SDA -> ${ic ? labelOf(ctx.profile, ic.sda) : 'SDA'}, SCL -> ${ic ? labelOf(ctx.profile, ic.scl) : 'SCL'} (I2C address ${o.addr}).${spec.hint ? ' ' + spec.hint : ''}`; break;
    }
    case 'joystick': {
      const t = tmp(); P({ type: 'read_analog', var: b.xvar, pin: b.xpin, mode: 'percent' }); P({ type: 'read_analog', var: b.yvar, pin: b.ypin, mode: 'percent' }); P({ type: 'read_digital', var: t, pin: b.bpin, pull: 'up' }); P({ type: 'calc', var: b.bvar, left: '1', op: '-', right: t });
      out[0].wiring = `Joystick: VRx -> ${lab('xpin')}, VRy -> ${lab('ypin')}, SW -> ${lab('bpin')}; +5V -> 3V3, GND -> GND. Centre is about 50 %.`; break;
    }
    default: throw new Error('Unknown recipe ' + spec.kind);
  }
  return out;
}

/** Replace every part block with its primitive blocks (recursively). Returns { program, errors } (errors keyed by block id). */
function expandProgram(program, ctx) {
  const errors = []; const customById = new Map((ctx.custom || []).map((c) => ['cp_' + c.id, c]));
  const rec = (blocks) => blocks.flatMap((b) => {
    if (b.children === undefined && typeof b.type === 'string' && (b.type.startsWith('p_') || b.type.startsWith('cp_'))) {
      let spec, name;
      if (b.type.startsWith('p_')) { const p = parts.get(b.type.slice(2)); spec = p?.spec; name = p?.name; } else { const c = customById.get(b.type); spec = c ? customSpec(c) : null; name = c?.name; }
      if (!spec) { errors.push({ id: b.id, msg: `The part "${b.type}" is not available any more - delete this block or add the part to your kit again.` }); return []; }
      const def = fieldsFor(spec); const bb = { ...b, part: name };
      const used = def.filter((f) => f.kind === 'pin').map((f) => String(bb[f.k] ?? '')).filter(Boolean); const dup = used.find((p, i) => used.indexOf(p) !== i);
      if (dup !== undefined) { errors.push({ id: b.id, msg: `${name}: each connection needs its own pin, but two of them use ${labelOf(ctx.profile, dup)}. Pick different pins.` }); return []; }
      return expandOne(bb, spec, ctx);
    }
    for (const k of ['then', 'else', 'body']) if (Array.isArray(b[k])) b = { ...b, [k]: rec(b[k]) };
    return [b];
  });
  const P = { ...program, setup: rec(program.setup), loop: rec(program.loop), handlers: program.handlers.map((h) => ({ ...h, body: rec(h.body) })) };
  return { program: P, errors };
}

// ---------- public views ----------
const partBlocks = () => Object.fromEntries([...parts.values()].filter((p) => p.tier === 'ready' || p.tier === 'beta').map((p) => ['p_' + p.id, blockDef(p, p.spec)]));
const libraryMeta = () => ({ categories: CATEGORIES, boards: BOARDS_LIB, parts: [...parts.values()].map((p) => ({ id: p.id, name: p.name, cats: p.cats, tier: p.tier, kind: p.kind, hint: p.hint })) });
const vrefOf = (profile) => (profile === 'pc' ? 3.3 : 3.3);
const boardById = (id) => BOARDS_LIB.find((b) => b.id === id);

module.exports = { parts, partBlocks, customBlocks, customSpec, CUSTOM_KINDS, libraryMeta, expandProgram, boardById, vrefOf, fieldsFor, BOARDS_LIB, CATEGORIES };
