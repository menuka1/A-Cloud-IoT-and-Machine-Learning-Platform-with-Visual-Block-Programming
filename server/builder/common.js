'use strict';
const { BLOCKS, BOARDS, TARGETS, CHILD_KEYS, UNSUPPORTED } = require('./catalog');
const { I2C } = require('./i2c-sensors');

const NUM_RE = /^-?\d+(\.\d+)?$/;
const VAR_RE = /^[a-z][a-z0-9_]{0,23}$/;
const KEY_RE = /^[A-Za-z0-9_.\-]{1,40}$/;
const isNum = (s) => NUM_RE.test(String(s).trim());
const isStr = (v) => typeof v === 'string';
const OUT_VARS = { calc: ['var'], map_range: ['var'], read_uptime: ['var'], read_analog: ['var'], read_digital: ['var'], read_dht: ['tvar', 'hvar'], read_ultrasonic: ['var'], read_random: ['var'], set_var: ['var'], change_var: ['var'], ml_predict: ['var'] };

const outVars = (b) => OUT_VARS[b.type] || (typeof b.type === 'string' && b.type.startsWith('i2c_') && I2C[b.type.slice(4)] ? I2C[b.type.slice(4)].outs.map((o) => o[0]) : []);

/** Visit every block in the program (setup, loop, handlers). fn(block, section, depth) */
function walk(program, fn) {
  const rec = (blocks, section, depth) => { for (const b of blocks || []) { fn(b, section, depth); for (const k of CHILD_KEYS[b.type] || []) rec(b[k], section, depth + 1); } };
  rec(program.setup, 'setup', 0); rec(program.loop, 'loop', 0);
  (program.handlers || []).forEach((h) => rec(h.body, 'handler', 0));
}

/** Fill in ids / empty arrays so later code can rely on shape. Returns a clean deep copy. */
function normalize(program) {
  let n = 0; const p = JSON.parse(JSON.stringify(program || {}));
  p.setup = Array.isArray(p.setup) ? p.setup : []; p.loop = Array.isArray(p.loop) ? p.loop : []; p.handlers = Array.isArray(p.handlers) ? p.handlers : [];
  p.interval = Number(p.interval);
  const fix = (blocks) => { for (const b of blocks) { if (!b || typeof b !== 'object') continue; b.id = isStr(b.id) && b.id ? b.id : 'b' + (++n); for (const k of CHILD_KEYS[b.type] || []) { b[k] = Array.isArray(b[k]) ? b[k] : []; fix(b[k]); } } };
  p.setup = p.setup.filter((b) => b && typeof b === 'object'); p.loop = p.loop.filter((b) => b && typeof b === 'object');
  p.handlers = p.handlers.filter((h) => h && typeof h === 'object').map((h, i) => ({ id: isStr(h.id) && h.id ? h.id : 'h' + (i + 1), name: isStr(h.name) ? h.name.trim() : '', body: (Array.isArray(h.body) ? h.body : []).filter((b) => b && typeof b === 'object') }));
  fix(p.setup); fix(p.loop); p.handlers.forEach((h) => fix(h.body));
  return p;
}

function pinInfo(board, id) { return BOARDS[board].pins.find((p) => p.id === String(id)); }

/** Validate -> { errors:[{id,msg}], warnings:[{id,msg}] } */
function validate(targetId, program, settings = {}, opts = {}) {
  const errors = [], warnings = []; const err = (id, msg) => errors.push({ id: id || null, msg }); const warn = (id, msg) => warnings.push({ id: id || null, msg });
  const T = TARGETS[targetId]; if (!T) { err(null, 'Unknown target board/language'); return { errors, warnings }; }
  const board = BOARDS[T.board];

  if (!(program.interval >= 1 && program.interval <= 3600)) err(null, 'Repeat interval must be between 1 and 3600 seconds');
  if (program.handlers.length > 20) err(null, 'Too many command handlers (max 20)');
  let total = 0; walk(program, () => total++); if (total > 300) err(null, 'Too many blocks (max 300)');

  // settings
  if (board.wifi) {
    if (settings.wifiSsid && !/^[\x20-\x7e]{1,32}$/.test(settings.wifiSsid)) err(null, 'Wi-Fi name must be 1-32 plain ASCII characters');
    if (settings.wifiPass && !/^[\x20-\x7e]{1,63}$/.test(settings.wifiPass)) err(null, 'Wi-Fi password must be 1-63 plain ASCII characters');
  }
  // declared variables
  const declared = new Set(program.handlers.length ? ['cmd_value'] : []);
  walk(program, (b) => { for (const k of outVars(b)) if (isStr(b[k]) && VAR_RE.test(b[k])) declared.add(b[k]); });
  const names = new Set();
  program.handlers.forEach((h) => {
    if (!/^[\w.\-]{1,40}$/.test(h.name)) err(null, `Command handler name "${h.name}" is invalid (letters, numbers, _ . - only, max 40)`);
    else if (names.has(h.name)) err(null, `Two handlers use the command name "${h.name}"`);
    names.add(h.name);
  });

  const pinUse = new Map(); const usePin = (id, pin, role) => { const k = String(pin); if (!pinUse.has(k)) pinUse.set(k, new Map()); pinUse.get(k).set(role, id); };
  let sendsSomething = false; let usesI2c = null;
  const checkI2c = (id, b) => {
    const S = I2C[b.type.slice(4)]; if (!S) return err(id, 'Unknown I2C sensor');
    if (!board.i2c && T.board !== 'pc') err(id, `${board.label} has no I2C bus we can use yet`);
    S.outs.forEach(([k, label]) => checkVarOut(id, b[k], label));
    const vs = S.outs.map(([k]) => b[k]); if (new Set(vs).size !== vs.length) err(id, 'Each reading needs its own variable name');
    if (!S.addrs.some(([a]) => a === b.addr)) err(id, "Choose the sensor's I2C address");
    if (S.models && !S.models.includes(String(b.model))) err(id, 'Choose the sensor model');
    usesI2c = usesI2c || id;
  };

  const checkOperand = (id, v, label) => {
    if (!isStr(v) || !v.trim()) return err(id, `${label} is empty - type a number or a variable name`);
    v = v.trim(); if (isNum(v)) return true;
    if (!VAR_RE.test(v)) return err(id, `${label} "${v}" is not a number or a valid variable name (lowercase letters, digits, _)`);
    if (!declared.has(v)) return err(id, `Variable "${v}" is used but never set - read a sensor or use "Set variable" first`);
    return true;
  };
  const checkVarOut = (id, v, label) => {
    if (!isStr(v) || !VAR_RE.test(v)) return err(id, `${label}: variable names use lowercase letters, digits and _ (start with a letter, max 24)`);
    if (v === 'cmd_value') return err(id, '"cmd_value" is read-only (it holds the value of the received command)');
    return true;
  };
  const checkPin = (id, b, key, cap, role, extra) => {
    const pin = b[key]; const info = isStr(pin) ? pinInfo(T.board, pin) : null;
    if (!info) return err(id, `Pick a pin for ${BLOCKS[b.type].label.toLowerCase()} (${pin || 'none'} is not valid on ${board.label})`);
    if ((opts.excludePins || []).includes(String(pin))) return err(id, `${info.label} is used inside your board and cannot be used for a part. Pick another pin.`);
    if (!info.caps.includes(cap)) return err(id, `${info.label} cannot be used for ${cap === 'adc' ? 'analog input' : cap === 'pwm' ? 'PWM' : cap === 'dht' ? 'a DHT sensor' : cap === 'dout' ? 'output' : 'input'} on ${board.label}`);
    if (extra === 'pullup' && info.noPullup) err(id, `${info.label} has no internal pull-up resistor - use "none" and add an external resistor`);
    usePin(id, pin, role); return info;
  };

  walk(program, (b, section, depth) => {
    const def = BLOCKS[b.type]; const id = b.id;
    if (!def) return err(id, `Unknown block type "${b.type}"`);
    if (depth > 8) err(id, 'Blocks are nested too deeply (max 8)');
    const un = UNSUPPORTED[targetId]?.[b.type]; if (un) { err(id, un); return; }
    if (b.type.startsWith('i2c_')) { checkI2c(id, b); return; }
    switch (b.type) {
      case 'read_analog': checkVarOut(id, b.var, 'Save into'); if (!['percent', 'raw'].includes(b.mode)) err(id, 'Choose percent or raw'); checkPin(id, b, 'pin', 'adc', 'adc'); break;
      case 'read_digital': checkVarOut(id, b.var, 'Save into'); if (!['none', 'up'].includes(b.pull)) err(id, 'Choose a resistor mode'); checkPin(id, b, 'pin', 'din', 'din', b.pull === 'up' ? 'pullup' : null); break;
      case 'read_dht': checkVarOut(id, b.tvar, 'Temperature'); checkVarOut(id, b.hvar, 'Humidity'); if (b.tvar === b.hvar) err(id, 'Temperature and humidity need different variables'); if (!['11', '21', '22'].includes(String(b.model))) err(id, 'Choose DHT11, DHT21 or DHT22'); checkPin(id, b, 'pin', 'dht', 'dht'); break;
      case 'read_ultrasonic': checkVarOut(id, b.var, 'Save into'); checkPin(id, b, 'trig', 'dout', 'trig'); checkPin(id, b, 'echo', 'din', 'echo'); if (String(b.trig) === String(b.echo)) err(id, 'Trig and echo must be different pins'); break;
      case 'read_random': checkVarOut(id, b.var, 'Save into'); if (!Number.isFinite(+b.min) || !Number.isFinite(+b.max) || +b.min >= +b.max) err(id, 'Random range: "from" must be smaller than "to"'); break;
      case 'write_digital': checkPin(id, b, 'pin', 'dout', 'dout'); checkOperand(id, b.value, 'Value'); break;
      case 'write_pwm': checkPin(id, b, 'pin', 'pwm', 'pwm'); checkOperand(id, b.value, 'Level'); break;
      case 'set_var': checkVarOut(id, b.var, 'Variable'); checkOperand(id, b.value, 'Value'); break;
      case 'change_var': checkVarOut(id, b.var, 'Variable'); checkOperand(id, b.by, 'Amount'); break;
      case 'if': {
        const CMP = ['>', '<', '>=', '<=', '==', '!='];
        checkOperand(id, b.left, 'Left side'); checkOperand(id, b.right, 'Right side'); if (!CMP.includes(b.op)) err(id, 'Bad comparison');
        if (b.join !== undefined && !['none', 'and', 'or'].includes(b.join)) err(id, 'Choose AND, OR or a single condition');
        if (b.join === 'and' || b.join === 'or') { checkOperand(id, b.left2, 'Second condition, left side'); checkOperand(id, b.right2, 'Second condition, right side'); if (!CMP.includes(b.op2)) err(id, 'Bad second comparison'); }
        break;
      }
      case 'calc': checkVarOut(id, b.var, 'Save into'); checkOperand(id, b.left, 'First number'); checkOperand(id, b.right, 'Second number'); if (!['+', '-', '*', '/', '%'].includes(b.op)) err(id, 'Choose + - x / or remainder'); if ((b.op === '/' || b.op === '%') && isStr(b.right) && isNum(b.right) && +b.right === 0) err(id, 'You cannot divide by zero'); break;
      case 'map_range':
        checkVarOut(id, b.var, 'Save into'); [['value', 'Value'], ['inMin', 'Input "from"'], ['inMax', 'Input "to"'], ['outMin', 'Output "from"'], ['outMax', 'Output "to"']].forEach(([k, l]) => checkOperand(id, b[k], l));
        if (isStr(b.inMin) && isStr(b.inMax) && isNum(b.inMin) && isNum(b.inMax) && +b.inMin === +b.inMax) err(id, 'Input range cannot be empty (from and to are equal)');
        if (!['yes', 'no'].includes(b.clamp)) err(id, 'Choose whether to limit the result'); break;
      case 'repeat': if (!(Number.isInteger(+b.times) && +b.times >= 1 && +b.times <= 1000)) err(id, 'Repeat count must be a whole number from 1 to 1000'); break;
      case 'read_uptime': checkVarOut(id, b.var, 'Save into'); break;
      case 'comment': if (!/^[\x20-\x7e]{0,80}$/.test(b.text || '') || String(b.text || '').includes('\\')) err(id, 'Comment must be plain ASCII (no backslash), max 80 characters'); break;
      case 'wait': if (!(+b.seconds >= 0.01 && +b.seconds <= 60)) err(id, 'Wait must be between 0.01 and 60 seconds'); break;
      case 'send_cloud': {
        sendsSomething = true; const f = Array.isArray(b.fields) ? b.fields : [];
        if (!f.length) err(id, 'Add at least one field to send'); if (f.length > 40) err(id, 'Too many fields (max 40)');
        const seen = new Set(); f.forEach((r) => { if (!KEY_RE.test(r?.k || '')) err(id, `Field name "${r?.k || ''}" is invalid (letters, numbers, _ . - ; max 40)`); else if (seen.has(r.k)) err(id, `Field name "${r.k}" is used twice`); seen.add(r?.k); checkOperand(id, r?.v, `Value of "${r?.k}"`); });
        break;
      }
      case 'ml_predict': {
        if (!(Number.isInteger(+b.model) && +b.model >= 1)) err(id, 'Model ID must be a whole number from ML Studio');
        const f = Array.isArray(b.inputs) ? b.inputs : []; if (!f.length) err(id, 'Add at least one model input');
        f.forEach((r) => { if (!KEY_RE.test(r?.k || '')) err(id, `Input name "${r?.k || ''}" is invalid`); checkOperand(id, r?.v, `Input "${r?.k}"`); });
        checkVarOut(id, b.var, 'Save result into'); if (!['value', 'score', 'anomaly', 'cluster', 'next', 'confidence'].includes(b.key)) err(id, 'Choose which result to read');
        break;
      }
      case 'log': if (!/^[\x20-\x7e]{0,60}$/.test(b.text || '')) err(id, 'Message must be plain ASCII, max 60 characters'); if (b.value && String(b.value).trim()) checkOperand(id, b.value, 'Value'); break;
      default: break;
    }
  });

  if (usesI2c && board.i2c) { usePin(usesI2c, board.i2c.sda, 'I2C'); usePin(usesI2c, board.i2c.scl, 'I2C'); }
  // pin role conflicts
  for (const [pin, roles] of pinUse) {
    if (roles.size > 1) { const id = [...roles.values()].pop(); err(id, `${pinInfo(T.board, pin)?.label || pin} is used for different jobs (${[...roles.keys()].join(' + ')}). Use a separate pin for each.`); }
  }
  if (!program.loop.length && !program.handlers.length && !program.setup.length) err(null, 'Your program is empty - drag some blocks in');
  if (!sendsSomething && total) warn(null, 'Nothing is sent to your dashboard - add a "Send to TronicIOT dashboard" block to see data.');
  if (board.wifi && !settings.wifiSsid) warn(null, 'Wi-Fi name not set - the code will contain YOUR_WIFI_NAME placeholders to edit.');
  return { errors, warnings };
}

/** Collect what the program uses so generators can emit only what's needed. */
function analyze(program, board) {
  const A = { i2c: new Map(), math: false, map: false, uptime: false, repeat: false, vars: new Set(), dht: new Map(), outs: new Set(), pwm: new Set(), ins: new Map(), ultra: false, ml: false, analog: false, send: false, handlers: program.handlers.length > 0, random: false, log: false };
  if (A.handlers) A.vars.add('cmd_value');
  walk(program, (b) => {
    for (const k of outVars(b)) A.vars.add(b[k]);
    if (typeof b.type === 'string' && b.type.startsWith('i2c_')) A.i2c.set(`${b.type.slice(4)}_${b.addr}`, { sensor: b.type.slice(4), addr: b.addr, model: b.model });
    for (const k of ['left', 'right', 'left2', 'right2', 'value', 'by', 'inMin', 'inMax', 'outMin', 'outMax']) if (isStr(b[k]) && VAR_RE.test(b[k].trim())) A.vars.add(b[k].trim());
    if (b.type === 'calc' && b.op === '%') A.math = true; if (b.type === 'map_range') A.map = true; if (b.type === 'read_uptime') A.uptime = true; if (b.type === 'repeat') A.repeat = true;
    for (const r of [...(b.fields || []), ...(b.inputs || [])]) if (isStr(r.v) && VAR_RE.test(r.v.trim())) A.vars.add(r.v.trim());
    if (b.type === 'read_dht') A.dht.set(`${b.pin}_${b.model}`, { pin: b.pin, model: String(b.model) });
    if (b.type === 'write_digital') A.outs.add(String(b.pin));
    if (b.type === 'write_pwm') A.pwm.add(String(b.pin));
    if (b.type === 'read_digital') A.ins.set(String(b.pin), b.pull === 'up');
    if (b.type === 'read_ultrasonic') { A.ultra = true; A.outs.add(String(b.trig)); A.ins.set(String(b.echo), false); }
    if (b.type === 'read_analog') A.analog = true; if (b.type === 'ml_predict') A.ml = true; if (b.type === 'send_cloud') A.send = true; if (b.type === 'read_random') A.random = true; if (b.type === 'log') A.log = true;
  });
  return A;
}

const num = (s) => String(Number(String(s).trim()));
const q = (s) => JSON.stringify(String(s)); // safe for C++/Python/JS string literals (validated printable ASCII)
const slug = (s) => ('tronic_' + String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).slice(0, 40).replace(/_+$/, '');

module.exports = { NUM_RE, VAR_RE, KEY_RE, isNum, isStr, walk, normalize, validate, analyze, pinInfo, num, q, slug };
