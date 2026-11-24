'use strict';
/* Shared catalog for the visual builder: blocks, boards (pin profiles), targets, templates. */

const { I2C } = require('./i2c-sensors');
const CATEGORIES = { 'My Parts': '#0891b2', Sensors: '#22d3ee', Actions: '#34d399', Logic: '#fbbf24', Cloud: '#818cf8', Utility: '#f472b6' };
const CHILD_KEYS = { if: ['then', 'else'], repeat: ['body'] };

// field kinds: var (output variable) | operand (number or variable) | number | select | pin | text | pairs
const BLOCKS = {
  read_analog: { cat: 'Sensors', label: 'Read analog sensor', help: 'Soil moisture, light (LDR), potentiometer... Percent mode gives 0-100 on every board.',
    fields: [{ k: 'var', kind: 'var', label: 'save into', default: 'light' }, { k: 'pin', kind: 'pin', cap: 'adc', label: 'pin', default: '@adc' }, { k: 'mode', kind: 'select', label: 'as', options: [['percent', '0-100 %'], ['raw', 'raw value']], default: 'percent' }] },
  read_digital: { cat: 'Sensors', label: 'Read digital input', help: 'Button, switch, motion (PIR), door sensor. Gives 0 or 1.',
    fields: [{ k: 'var', kind: 'var', label: 'save into', default: 'button' }, { k: 'pin', kind: 'pin', cap: 'din', label: 'pin', default: '@din' }, { k: 'pull', kind: 'select', label: 'resistor', options: [['none', 'none / pull-down'], ['up', 'pull-up']], default: 'none' }] },
  read_dht: { cat: 'Sensors', label: 'Read DHT temperature + humidity', help: 'DHT11 / DHT22 (AM2302) sensor.',
    fields: [{ k: 'tvar', kind: 'var', label: 'temperature into', default: 'temp' }, { k: 'hvar', kind: 'var', label: 'humidity into', default: 'hum' }, { k: 'pin', kind: 'pin', cap: 'dht', label: 'data pin', default: '@dht' }, { k: 'model', kind: 'select', label: 'model', options: [['22', 'DHT22'], ['11', 'DHT11'], ['21', 'DHT21 / AM2301']], default: '22' }] },
  read_ultrasonic: { cat: 'Sensors', label: 'Read distance (HC-SR04)', help: 'Ultrasonic distance in cm. HC-SR04 echo is 5 V - use a divider on 3.3 V boards.',
    fields: [{ k: 'var', kind: 'var', label: 'save into', default: 'distance' }, { k: 'trig', kind: 'pin', cap: 'dout', label: 'trig pin', default: '@trig' }, { k: 'echo', kind: 'pin', cap: 'din', label: 'echo pin', default: '@echo' }] },
  read_random: { cat: 'Sensors', label: 'Random test value', help: 'Fake sensor for testing without hardware.',
    fields: [{ k: 'var', kind: 'var', label: 'save into', default: 'temp' }, { k: 'min', kind: 'number', label: 'from', default: 20 }, { k: 'max', kind: 'number', label: 'to', default: 30 }] },

  write_digital: { cat: 'Actions', label: 'Switch output ON/OFF', help: 'LED, relay, buzzer, fan. 1 = on, 0 = off (any value >= 0.5 is on).',
    fields: [{ k: 'pin', kind: 'pin', cap: 'dout', label: 'pin', default: '@dout' }, { k: 'value', kind: 'operand', label: 'value (1/0 or variable)', default: '1' }] },
  write_pwm: { cat: 'Actions', label: 'Set PWM level (0-255)', help: 'Dim an LED or set motor speed. 0 = off, 255 = full.',
    fields: [{ k: 'pin', kind: 'pin', cap: 'pwm', label: 'pin', default: '@pwm' }, { k: 'value', kind: 'operand', label: 'level 0-255 (or variable)', default: '128' }] },

  set_var: { cat: 'Logic', label: 'Set variable', fields: [{ k: 'var', kind: 'var', label: 'variable', default: 'x' }, { k: 'value', kind: 'operand', label: 'to', default: '0' }] },
  change_var: { cat: 'Logic', label: 'Change variable by', fields: [{ k: 'var', kind: 'var', label: 'variable', default: 'x' }, { k: 'by', kind: 'operand', label: 'by', default: '1' }] },
  if: { cat: 'Logic', label: 'If ... then ... else', children: ['then', 'else'], help: 'Optionally combine a second condition with AND / OR.',
    fields: [{ k: 'left', kind: 'operand', label: 'if', default: 'temp' }, { k: 'op', kind: 'select', label: '', options: [['>', '>'], ['<', '<'], ['>=', '>='], ['<=', '<='], ['==', '='], ['!=', '!=']], default: '>' }, { k: 'right', kind: 'operand', label: '', default: '30' },
      { k: 'join', kind: 'select', label: '', rerender: true, options: [['none', '(one condition)'], ['and', 'AND'], ['or', 'OR']], default: 'none' },
      { k: 'left2', kind: 'operand', label: '', default: 'hum', showIf: { join: ['and', 'or'] } }, { k: 'op2', kind: 'select', label: '', options: [['>', '>'], ['<', '<'], ['>=', '>='], ['<=', '<='], ['==', '='], ['!=', '!=']], default: '>', showIf: { join: ['and', 'or'] } }, { k: 'right2', kind: 'operand', label: '', default: '60', showIf: { join: ['and', 'or'] } }] },
  calc: { cat: 'Logic', label: 'Calculate', help: 'Add, subtract, multiply, divide or remainder. Dividing by zero gives "no value", which is simply not sent.',
    fields: [{ k: 'var', kind: 'var', label: 'save into', default: 'result' }, { k: 'left', kind: 'operand', label: '', default: '1' }, { k: 'op', kind: 'select', label: '', options: [['+', '+'], ['-', '-'], ['*', 'x'], ['/', '/'], ['%', 'remainder']], default: '+' }, { k: 'right', kind: 'operand', label: '', default: '1' }] },
  map_range: { cat: 'Logic', label: 'Scale / map a value', help: 'Convert one range into another, e.g. raw 0-4095 to 0-100 %.',
    fields: [{ k: 'var', kind: 'var', label: 'save into', default: 'percent' }, { k: 'value', kind: 'operand', label: 'value', default: '0' }, { k: 'inMin', kind: 'operand', label: 'from', default: '0' }, { k: 'inMax', kind: 'operand', label: 'to', default: '4095' }, { k: 'outMin', kind: 'operand', label: 'into', default: '0' }, { k: 'outMax', kind: 'operand', label: 'to', default: '100' }, { k: 'clamp', kind: 'select', label: 'limit', options: [['yes', 'stay inside range'], ['no', 'allow outside']], default: 'yes' }] },
  repeat: { cat: 'Logic', label: 'Repeat N times', children: ['body'], fields: [{ k: 'times', kind: 'number', label: 'times', default: 3, min: 1, max: 1000 }] },
  read_uptime: { cat: 'Sensors', label: 'Uptime (seconds)', help: 'Seconds since the program started.', fields: [{ k: 'var', kind: 'var', label: 'save into', default: 'uptime' }] },
  comment: { cat: 'Utility', label: 'Comment', help: 'A note that appears in the generated code. Does nothing.', fields: [{ k: 'text', kind: 'text', label: '', default: 'note to self' }] },

  wait: { cat: 'Logic', label: 'Wait (seconds)', fields: [{ k: 'seconds', kind: 'number', label: 'seconds', default: 1, min: 0.01, max: 60 }] },

  send_cloud: { cat: 'Cloud', label: 'Send to TronicIOT dashboard', help: 'Each row becomes a data field you can chart, alert on and train ML with.',
    fields: [{ k: 'fields', kind: 'pairs', label: 'fields', keyLabel: 'field name', valLabel: 'value', default: [{ k: 'temp', v: 'temp' }] }] },
  ml_predict: { cat: 'Cloud', label: 'Run ML model in the cloud', help: 'Calls a trained model from ML Studio. No heavy hardware needed on the board.',
    fields: [{ k: 'model', kind: 'number', label: 'model ID', default: 1, min: 1, max: 1000000 }, { k: 'inputs', kind: 'pairs', label: 'inputs', keyLabel: 'feature name', valLabel: 'value', default: [{ k: 'temp', v: 'temp' }] },
      { k: 'var', kind: 'var', label: 'save result into', default: 'prediction' }, { k: 'key', kind: 'select', label: 'result', options: [['value', 'value (regression)'], ['score', 'score (anomaly)'], ['anomaly', 'anomaly 1/0'], ['cluster', 'cluster number'], ['next', 'next forecast'], ['confidence', 'confidence']], default: 'value' }] },
  log: { cat: 'Utility', label: 'Print message', help: 'Shows in Serial Monitor / terminal.', fields: [{ k: 'text', kind: 'text', label: 'text', default: 'value =' }, { k: 'value', kind: 'operand', label: 'value (optional)', default: '', optional: true }] },
};

// hidden primitive blocks used by I2C parts (not shown in the palette)
for (const [id, S] of Object.entries(I2C)) {
  BLOCKS['i2c_' + id] = { hidden: true, label: S.label + ' (I2C)', fields: [...S.outs.map(([k, label, def]) => ({ k, kind: 'var', label, default: def })), { k: 'addr', kind: 'select', label: 'address', options: S.addrs, default: S.addrs[0][0] }] };
}

// ---------- boards ----------
const mk = (id, caps, label, extra = {}) => ({ id: String(id), caps, label, ...extra });
const gp = (ids, caps, labelFn = (n) => `GPIO${n}`, extra) => ids.map((n) => mk(n, caps, labelFn(n), extra));

const BOARDS = {
  esp32: {
    label: 'ESP32 (DevKit)', wifi: true, adcMax: 4095, ledInverted: false,
    pins: [mk('LED', ['dout', 'pwm', 'din'], 'Onboard LED (GPIO2)'),
      ...gp([4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27], ['dout', 'pwm', 'din', 'dht']),
      ...gp([32, 33], ['dout', 'pwm', 'din', 'dht', 'adc'], (n) => `GPIO${n} (ADC1)`),
      ...gp([34, 35, 36, 39], ['din', 'adc'], (n) => `GPIO${n} (input only, ADC1)`, { noPullup: true })],
    defaults: { led: 'LED', dout: 'LED', dout2: '26', pwm: '27', adc: '34', din: '14', dht: '4', trig: '5', echo: '18' }, i2c: { sda: '21', scl: '22' },
  },
  esp8266: {
    label: 'ESP8266 (NodeMCU / Wemos D1)', wifi: true, adcMax: 1023, ledInverted: true,
    pins: [mk('LED', ['dout', 'pwm', 'din'], 'Onboard LED (GPIO2, active-low handled)'),
      mk('5', ['dout', 'pwm', 'din', 'dht'], 'D1 (GPIO5)'), mk('4', ['dout', 'pwm', 'din', 'dht'], 'D2 (GPIO4)'), mk('0', ['dout', 'pwm', 'din'], 'D3 (GPIO0)'),
      mk('14', ['dout', 'pwm', 'din', 'dht'], 'D5 (GPIO14)'), mk('12', ['dout', 'pwm', 'din', 'dht'], 'D6 (GPIO12)'), mk('13', ['dout', 'pwm', 'din', 'dht'], 'D7 (GPIO13)'),
      mk('15', ['dout', 'pwm', 'din'], 'D8 (GPIO15)'), mk('16', ['dout', 'din'], 'D0 (GPIO16, no PWM)', { noPullup: true }),
      mk('A0', ['adc'], 'A0 (analog, 0-1 V on bare chip / 0-3.3 V on NodeMCU)')],
    defaults: { led: 'LED', dout: 'LED', dout2: '12', pwm: '13', adc: 'A0', din: '14', dht: '14', trig: '14', echo: '16' }, i2c: { sda: '4', scl: '5' },
  },
  picow: {
    label: 'Raspberry Pi Pico W', wifi: true, adcMax: 4095, ledInverted: false,
    pins: [mk('LED', ['dout'], 'Onboard LED (wireless chip, on/off only)'),
      ...gp([...Array(23).keys()], ['dout', 'pwm', 'din', 'dht']),
      ...gp([26, 27, 28], ['dout', 'pwm', 'din', 'dht', 'adc'], (n) => `GP${n} (ADC${n - 26})`)]
      .map((p) => (p.id !== 'LED' ? { ...p, label: p.label.replace('GPIO', 'GP') } : p)),
    defaults: { led: 'LED', dout: 'LED', dout2: '13', pwm: '15', adc: '26', din: '14', dht: '16', trig: '17', echo: '18' }, i2c: { sda: '4', scl: '5' },
  },
  rpi: {
    label: 'Raspberry Pi (Linux, GPIO)', wifi: false, adcMax: 0, ledInverted: false,
    pins: gp([...Array(26).keys()].map((n) => n + 2), ['dout', 'pwm', 'din', 'dht'], (n) => `GPIO${n} (BCM)`),
    defaults: { led: '17', dout: '17', dout2: '27', pwm: '18', adc: null, din: '22', dht: '4', trig: '23', echo: '24' }, i2c: { sda: '2', scl: '3' },
  },
  pc: {
    label: 'Any computer (simulated hardware)', wifi: false, adcMax: 4095, ledInverted: false,
    pins: gp([...Array(40).keys()].map((n) => n + 1), ['dout', 'pwm', 'din', 'dht', 'adc'], (n) => `Virtual pin ${n}`),
    defaults: { led: '1', dout: '1', dout2: '2', pwm: '3', adc: '4', din: '5', dht: '6', trig: '7', echo: '8' },
  },
};

// ---------- targets (board + language) ----------
const TARGETS = {
  'esp32-arduino': { label: 'ESP32 - Arduino C++', board: 'esp32', lang: 'arduino' },
  'esp8266-arduino': { label: 'ESP8266 - Arduino C++', board: 'esp8266', lang: 'arduino' },
  'picow-arduino': { label: 'Pico W - Arduino C++', board: 'picow', lang: 'arduino' },
  'esp32-micropython': { label: 'ESP32 - MicroPython', board: 'esp32', lang: 'micropython' },
  'esp8266-micropython': { label: 'ESP8266 - MicroPython', board: 'esp8266', lang: 'micropython' },
  'picow-micropython': { label: 'Pico W - MicroPython', board: 'picow', lang: 'micropython' },
  'rpi-python': { label: 'Raspberry Pi - Python', board: 'rpi', lang: 'python' },
  'pc-python': { label: 'Computer - Python (simulated)', board: 'pc', lang: 'python' },
  'pc-nodejs': { label: 'Computer - Node.js (simulated)', board: 'pc', lang: 'nodejs' },
};
// blocks a target cannot run
const UNSUPPORTED = { 'rpi-python': { read_analog: 'The Raspberry Pi has no analog inputs. Use an ADC chip (MCP3008) or a digital sensor.' } };

// ---------- templates ("@name" pins resolve to board defaults) ----------
const B = (type, f = {}) => ({ type, ...f });
const TEMPLATES = [
  { id: 'sim-demo', name: 'Try it without hardware', desc: 'Random temperature + humidity sent to your dashboard. Runs on every target.',
    program: { interval: 3, setup: [], loop: [B('read_random', { var: 'temp', min: 20, max: 30 }), B('read_random', { var: 'hum', min: 40, max: 70 }), B('send_cloud', { fields: [{ k: 'temp', v: 'temp' }, { k: 'hum', v: 'hum' }] })], handlers: [] } },
  { id: 'blink', name: 'Blink an LED', desc: 'The classic first project.',
    program: { interval: 1, setup: [], loop: [B('write_digital', { pin: '@led', value: '1' }), B('wait', { seconds: 0.5 }), B('write_digital', { pin: '@led', value: '0' }), B('wait', { seconds: 0.5 })], handlers: [] } },
  { id: 'dht-monitor', name: 'Temperature & humidity monitor', desc: 'DHT sensor -> live dashboard charts.',
    program: { interval: 5, setup: [], loop: [B('read_dht', { tvar: 'temp', hvar: 'hum', pin: '@dht', model: '22' }), B('send_cloud', { fields: [{ k: 'temp', v: 'temp' }, { k: 'hum', v: 'hum' }] })], handlers: [] } },
  { id: 'remote-control', name: 'Remote control (switch + dimmer)', desc: 'Dashboard switch "fan" and slider "level" control your pins.',
    program: { interval: 2, setup: [], loop: [B('send_cloud', { fields: [{ k: 'alive', v: '1' }] })],
      handlers: [{ name: 'fan', body: [B('if', { left: 'cmd_value', op: '>=', right: '0.5', then: [B('write_digital', { pin: '@dout2', value: '1' })], else: [B('write_digital', { pin: '@dout2', value: '0' })] })] },
        { name: 'level', body: [B('write_pwm', { pin: '@pwm', value: 'cmd_value' })] }] } },
  { id: 'plant-watering', name: 'Smart plant watering', desc: 'Soil moisture -> pump when dry. Needs an analog input.',
    program: { interval: 10, setup: [], loop: [B('read_analog', { var: 'soil', pin: '@adc', mode: 'percent' }), B('if', { left: 'soil', op: '<', right: '30', then: [B('write_digital', { pin: '@dout2', value: '1' }), B('wait', { seconds: 3 }), B('write_digital', { pin: '@dout2', value: '0' })], else: [] }), B('send_cloud', { fields: [{ k: 'soil', v: 'soil' }] })], handlers: [] } },
  { id: 'climate-control', name: 'Climate control (AND condition)', desc: 'Fan turns on only when it is hot AND humid. Dashboard shows both values.',
    program: { interval: 5, setup: [], loop: [B('read_dht', { tvar: 'temp', hvar: 'hum', pin: '@dht', model: '22' }), B('if', { left: 'temp', op: '>', right: '28', join: 'and', left2: 'hum', op2: '>', right2: '60', then: [B('write_digital', { pin: '@dout2', value: '1' })], else: [B('write_digital', { pin: '@dout2', value: '0' })] }), B('send_cloud', { fields: [{ k: 'temp', v: 'temp' }, { k: 'hum', v: 'hum' }] })], handlers: [] } },
  { id: 'blink-pattern', name: 'Blink pattern (repeat)', desc: 'Blinks 3 short flashes, pauses, and reports the uptime.',
    program: { interval: 2, setup: [], loop: [B('repeat', { times: 3, body: [B('write_digital', { pin: '@led', value: '1' }), B('wait', { seconds: 0.2 }), B('write_digital', { pin: '@led', value: '0' }), B('wait', { seconds: 0.2 })] }), B('read_uptime', { var: 'uptime' }), B('calc', { var: 'minutes', left: 'uptime', op: '/', right: '60' }), B('send_cloud', { fields: [{ k: 'uptime_min', v: 'minutes' }] })], handlers: [] } },
  { id: 'ml-anomaly', name: 'ML anomaly watcher', desc: 'Sends readings, asks your cloud anomaly model for a score, lights the LED on trouble. Needs a trained model (set its ID).',
    program: { interval: 5, setup: [], loop: [B('read_dht', { tvar: 'temp', hvar: 'hum', pin: '@dht', model: '22' }), B('ml_predict', { model: 1, inputs: [{ k: 'temp', v: 'temp' }, { k: 'hum', v: 'hum' }], var: 'score', key: 'score' }), B('if', { left: 'score', op: '>', right: '3', then: [B('write_digital', { pin: '@led', value: '1' })], else: [B('write_digital', { pin: '@led', value: '0' })] }), B('send_cloud', { fields: [{ k: 'temp', v: 'temp' }, { k: 'hum', v: 'hum' }, { k: 'anomaly_score', v: 'score' }] })], handlers: [] } },
];

module.exports = { CATEGORIES, CHILD_KEYS, BLOCKS, BOARDS, TARGETS, UNSUPPORTED, TEMPLATES };
