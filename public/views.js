'use strict';
/* Views: dashboard, devices, device detail */
const V = {};
const { $, $$, esc, fmtVal, fmtTime, ago } = TR;
const BOARDS = { esp32: 'ESP32', esp8266: 'ESP8266 / NodeMCU', arduino: 'Arduino (WiFi/Ethernet)', 'raspberry-pico-w': 'Raspberry Pi Pico W', 'raspberry-pi': 'Raspberry Pi / PC', stm32: 'STM32', other: 'Other board' };

// ---------- connection snippets ----------
function snippets(dev) {
  const host = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'YOUR_SERVER_IP' : location.hostname;
  const port = location.port || (location.protocol === 'https:' ? '443' : '80'); const https = location.protocol === 'https:';
  const base = `${https ? 'https' : 'http'}://${host}${location.port ? ':' + location.port : ''}`;
  const t = dev.token;
  return {
    'ESP32 (HTTP)': `// ESP32 - send data & receive commands over HTTP (Arduino IDE / PlatformIO)
// Libraries: ArduinoJson (install from Library Manager)
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const String SERVER   = "${base}";          // your TronicIOT server
const String TOKEN    = "${t}";

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);                       // onboard LED
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\\nWiFi connected");
}

void sendData(float temp, float hum) {
  HTTPClient http;
  http.begin(SERVER + "/api/ingest");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", TOKEN);
  String body = "{\\"temp\\":" + String(temp) + ",\\"hum\\":" + String(hum) + "}";
  int code = http.POST(body);
  Serial.printf("ingest -> %d\\n", code);
  http.end();
}

void checkCommands() {
  HTTPClient http;
  http.begin(SERVER + "/api/device/commands");
  http.addHeader("X-Device-Token", TOKEN);
  if (http.GET() == 200) {
    JsonDocument doc; deserializeJson(doc, http.getString());
    for (JsonObject c : doc["commands"].as<JsonArray>()) {
      String name = c["name"], value = c["value"];
      Serial.println("command " + name + " = " + value);
      if (name == "led") digitalWrite(2, value == "1" ? HIGH : LOW);   // <- handle your commands here
    }
  }
  http.end();
}

void loop() {
  float temp = 24.5, hum = 60.0;            // TODO: read your real sensor (DHT22, BME280, ...)
  sendData(temp, hum);
  checkCommands();
  delay(5000);
}`,
    'ESP32 (MQTT)': `// ESP32 - MQTT (real-time, instant commands). Library: PubSubClient
#include <WiFi.h>
#include <PubSubClient.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST = "${host}";
const int   MQTT_PORT = 1883;
const char* TOKEN     = "${t}";             // used as MQTT username
String topicData = String("tronic/") + TOKEN + "/data";
String topicCmd  = String("tronic/") + TOKEN + "/cmd";

WiFiClient net; PubSubClient mqtt(net);

void onMessage(char* topic, byte* payload, unsigned int len) {
  String msg; for (unsigned i = 0; i < len; i++) msg += (char)payload[i];
  Serial.println("command: " + msg);        // {"id":1,"name":"led","value":"1"}
  if (msg.indexOf("\\"led\\"") > 0) digitalWrite(2, msg.indexOf("\\"value\\":\\"1\\"") > 0 ? HIGH : LOW);
}

void connectMqtt() {
  while (!mqtt.connected()) {
    if (mqtt.connect(("esp32-" + String(random(0xffff), HEX)).c_str(), TOKEN, "")) mqtt.subscribe(topicCmd.c_str());
    else delay(2000);
  }
}

void setup() {
  Serial.begin(115200); pinMode(2, OUTPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  mqtt.setServer(MQTT_HOST, MQTT_PORT); mqtt.setCallback(onMessage);
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  static unsigned long last = 0;
  if (millis() - last > 5000) {
    last = millis();
    float temp = 24.5;                      // TODO: real sensor
    mqtt.publish(topicData.c_str(), (String("{\\"temp\\":") + temp + "}").c_str());
  }
}`,
    'ESP8266': `// ESP8266 / NodeMCU / Wemos D1 - HTTP
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const String URL   = "${base}/api/ingest";
const String TOKEN = "${t}";

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  float temp = 24.5;                        // TODO: read your sensor
  WiFiClient client; HTTPClient http;
  http.begin(client, URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", TOKEN);
  int code = http.POST("{\\"temp\\":" + String(temp) + "}");
  Serial.println(code);
  http.end();
  delay(5000);
}`,
    'Pico W (MicroPython)': `# Raspberry Pi Pico W / ESP32 running MicroPython
import network, time, urequests, machine

WIFI_SSID, WIFI_PASS = "YOUR_WIFI_NAME", "YOUR_WIFI_PASSWORD"
URL   = "${base}/api/ingest"
TOKEN = "${t}"

wlan = network.WLAN(network.STA_IF); wlan.active(True); wlan.connect(WIFI_SSID, WIFI_PASS)
while not wlan.isconnected(): time.sleep(0.5)
print("connected", wlan.ifconfig())

sensor = machine.ADC(4)  # Pico internal temperature sensor
while True:
    v = sensor.read_u16() * 3.3 / 65535
    temp = 27 - (v - 0.706) / 0.001721
    r = urequests.post(URL, json={"temp": round(temp, 2)}, headers={"X-Device-Token": TOKEN})
    print(r.status_code); r.close()
    time.sleep(5)`,
    'Python (Pi / PC)': `# Raspberry Pi, laptop, any computer: pip install requests
import time, random, requests

URL, TOKEN = "${base}/api/ingest", "${t}"
while True:
    data = {"temp": round(20 + random.random() * 10, 2), "hum": round(50 + random.random() * 20, 1)}
    r = requests.post(URL, json=data, headers={"X-Device-Token": TOKEN}, timeout=10)
    print(r.status_code, data)
    time.sleep(5)`,
    'curl / test': `# Quick test from any terminal - no board needed
curl -X POST ${base}/api/ingest \\
  -H "Content-Type: application/json" \\
  -H "X-Device-Token: ${t}" \\
  -d '{"temp": 24.5, "hum": 61}'

# Boards that can only do GET (very simple clients):
curl "${base}/api/ingest?token=${t}&temp=24.5&hum=61"

# Poll commands sent from your dashboard
curl -H "X-Device-Token: ${t}" ${base}/api/device/commands`,
  };
}
function snippetTabs(dev) {
  const sn = snippets(dev); const names = Object.keys(sn);
  const localWarn = ['localhost', '127.0.0.1'].includes(location.hostname) ? `<p class="small" style="color:var(--warn)">You opened the dashboard via <code>localhost</code>. Boards cannot reach that - replace <code>YOUR_SERVER_IP</code> with this computer's LAN IP (run <code>ipconfig</code>), or deploy TronicIOT to a public server.</p>` : '';
  return `${localWarn}<div class="tabs">${names.map((n, i) => `<button class="tab ${i ? '' : 'active'}" data-n="${i}">${esc(n)}</button>`).join('')}</div><div class="row" style="justify-content:flex-end"><button class="btn sm" data-copy>Copy code</button></div><pre class="code" data-code>${esc(sn[names[0]])}</pre>`;
}
function wireSnippets(root, dev) {
  const sn = snippets(dev); const names = Object.keys(sn); let cur = 0; const pre = $('[data-code]', root);
  $$('.tab', root).forEach((b) => (b.onclick = () => { cur = +b.dataset.n; $$('.tab', root).forEach((x) => x.classList.toggle('active', x === b)); pre.textContent = sn[names[cur]]; }));
  $('[data-copy]', root).onclick = () => TR.copy(sn[names[cur]], 'Code copied');
}

// ---------- DASHBOARD ----------
V.dashboard = async (root) => {
  root.innerHTML = '<div class="muted">Loading...</div>';
  const [devs, models, dashes, ov, kit, projs] = await Promise.all([TR.get('/devices'), TR.get('/ml/models'), TR.get('/dashboards'), TR.get('/overview'), TR.get('/kit'), TR.get('/projects')]);
  const steps = [[kit.configured && kit.boardId, '#/kit', 'Choose your board and parts', 'Tell us what you own'], [projs.length > 0, '#/builder', 'Build your program', 'Drag blocks, get code'], [devs.length > 0, '#/devices', 'Add your board here', 'Get its secret token'], [ov.readings > 0, '#/devices', 'See your data arrive', 'Flash the code and watch']];
  const showList = !steps.every((s) => s[0]);
  const ctx = { devices: new Map(devs.map((d) => [d.id, d])), models: new Map(models.map((m) => [m.id, m])), _h: new Map(), hist(id) { if (!this._h.has(id)) this._h.set(id, TR.get(`/devices/${id}/readings?limit=150`).catch(() => [])); return this._h.get(id); } };
  let cur = dashes.find((d) => d.id === +TR.store.get('tronic_dash')) || dashes[0]; let mounted = [];
  const draw = () => {
    mounted.forEach((m) => m.destroy && m.destroy()); mounted = []; ctx._h.clear();
    root.innerHTML = `
      <div class="top"><div class="row"><button class="btn ghost menu-btn" data-menu>&#9776;</button><h1>My Dashboard</h1><span class="pill" id="live"><span class="dot"></span> connecting</span></div>
        <div class="row"><select id="dsel" style="width:auto">${dashes.map((d) => `<option value="${d.id}" ${d.id === cur.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        <button class="btn sm" id="dnew">+ Dashboard</button><button class="btn sm danger" id="ddel" ${dashes.length < 2 ? 'disabled' : ''}>Delete</button><button class="btn primary" id="wadd">+ Add widget</button></div></div>
      ${showList ? `<div class="checklist" aria-label="Getting started">${steps.map((s, i) => `<a class="cl ${s[0] ? 'done' : ''}" href="${s[1]}"><span class="n">${s[0] ? '&#10003;' : i + 1}</span><b>${s[2]}</b><span class="d">${s[3]}</span></a>`).join('')}</div>` : ''}
      <div class="stats">
        <div class="card stat"><div class="n">${ov.devices}</div><div class="l">Devices</div></div>
        <div class="card stat"><div class="n" style="color:var(--ok)">${ov.online}</div><div class="l">Online now</div></div>
        <div class="card stat"><div class="n">${ov.readings.toLocaleString()}</div><div class="l">Readings stored</div></div>
        <div class="card stat"><div class="n">${ov.models}</div><div class="l">ML models</div></div></div>
      ${cur.widgets.length ? '<div class="wgrid" id="wg"></div>' : `<div class="empty"><h3>Your dashboard is empty</h3><p>${devs.length ? 'Add widgets to show your sensors, charts, switches and ML results.' : 'Start by connecting a board - then add widgets here.'}</p><button class="btn primary" id="wadd2">${devs.length ? '+ Add your first widget' : '+ Connect a device'}</button></div>`}`;
    $('[data-menu]', root).onclick = () => $('.side').classList.toggle('open');
    const live = $('#live', root); const setLive = () => { live.className = 'pill ' + (TR.isLive() ? 'ok' : 'warn'); live.innerHTML = `<span class="dot ${TR.isLive() ? 'on' : ''}"></span> ${TR.isLive() ? 'live' : 'reconnecting'}`; }; setLive();
    TR.bus.on('ws', setLive);
    $('#dsel', root).onchange = (e) => { cur = dashes.find((d) => d.id === +e.target.value); TR.store.set('tronic_dash', cur.id); draw(); };
    $('#dnew', root).onclick = () => { const m = TR.modal('<h3>New dashboard</h3><label>Name</label><input id="n" maxlength="60" placeholder="Greenhouse"><div class="err" id="e"></div><div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Create</button></div>', { onMount(el, close) { $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = async () => { try { const d = await TR.post('/dashboards', { name: $('#n', el).value }); dashes.push(d); cur = d; TR.store.set('tronic_dash', d.id); close(); draw(); } catch (e) { $('#e', el).textContent = e.message; } }; } }); };
    $('#ddel', root).onclick = async () => { if (!(await TR.confirmBox(`Delete dashboard "${cur.name}" and all its widgets?`))) return; await TR.del('/dashboards/' + cur.id); dashes.splice(dashes.indexOf(cur), 1); cur = dashes[0]; draw(); };
    const add = () => (devs.length ? Widgets.addDialog(cur.id, ctx, reload) : (location.hash = '#/devices'));
    $('#wadd', root).onclick = add; const w2 = $('#wadd2', root); if (w2) w2.onclick = add;
    const grid = $('#wg', root);
    if (grid) cur.widgets.forEach((w) => {
      const card = document.createElement('div'); card.className = `card w ${w.size}${['line', 'bar'].includes(w.type) ? ' tall' : ''}`;
      card.innerHTML = `<div class="wh"><span>${esc(w.title)}</span><button class="x" title="Remove widget" aria-label="Remove widget">&#10005;</button></div><div class="wbody" style="flex:1;display:flex;flex-direction:column"></div>`;
      grid.append(card); mounted.push(Widgets.mount(w, card, ctx) || {});
      card.querySelector('.x').onclick = async () => { if (!(await TR.confirmBox(`Remove widget "${w.title}"?`, 'Remove'))) return; await TR.del('/widgets/' + w.id); reload(); };
    });
  };
  const reload = async () => { const ds = await TR.get('/dashboards'); dashes.splice(0, dashes.length, ...ds); cur = dashes.find((d) => d.id === cur.id) || dashes[0]; draw(); };
  draw();
  TR.bus.on('*', (ev) => { if (ev.type === 'reading' || ev.type === 'prediction') mounted.forEach((m) => m.update && m.update(ev)); if (ev.type === 'alert') TR.toast(`${ev.level.toUpperCase()}: ${ev.message}`, ev.level === 'critical' ? 'err' : 'warn'); });
  return () => mounted.forEach((m) => m.destroy && m.destroy());
};

// ---------- DEVICES ----------
V.devices = async (root) => {
  const list = async () => {
    const devs = await TR.get('/devices');
    root.innerHTML = `<div class="top"><div class="row"><button class="btn ghost menu-btn" data-menu>&#9776;</button><h1>My Boards</h1></div><button class="btn primary" id="add">+ Add a board</button></div>
    <div class="tip"><span class="ti">💡</span><div><b>What is a board?</b><p class="muted">The little computer you program, like an ESP32 or a Raspberry Pi. Add it here to get its secret token, then build its program in the <a href="#/builder">Playground</a>.</p></div></div>
    ${devs.length ? `<div class="devgrid">${devs.map((d) => `<div class="card devcard" data-id="${d.id}"><h3><span>${esc(d.name)}</span><span class="pill ${d.online ? 'ok' : ''}"><span class="dot ${d.online ? 'on' : ''}"></span>${d.online ? 'online' : 'offline'}</span></h3>
      <div class="muted small">${esc(BOARDS[d.board] || d.board)} - last seen ${ago(d.last_seen)}</div>
      <div class="chips">${d.latest ? Object.entries(d.latest.data).slice(0, 6).map(([k, v]) => `<span class="chip">${esc(k)} <b>${esc(fmtVal(v))}</b></span>`).join('') : '<span class="muted small">No data yet - open to get connection code</span>'}</div></div>`).join('')}</div>`
      : `<div class="empty"><h3>No boards yet</h3><p>Add your board to get a secret token and ready-to-paste code.</p><button class="btn primary" id="add2">+ Add your first board</button></div>`}`;
    $('[data-menu]', root).onclick = () => $('.side').classList.toggle('open');
    $$('.devcard', root).forEach((c) => (c.onclick = () => (location.hash = '#/devices/' + c.dataset.id)));
    const add = () => TR.modal(`<h3>Add device</h3><label>Name</label><input id="n" maxlength="60" placeholder="Living-room sensor"><label>Board</label><select id="b">${Object.entries(BOARDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><label>Description (optional)</label><input id="d" maxlength="300"><div class="err" id="e"></div><div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Create device</button></div>`, { onMount(el, close) { $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = async (ev) => { await TR.busy(ev.target, async () => { try { const d = await TR.post('/devices', { name: $('#n', el).value, board: $('#b', el).value, description: $('#d', el).value }); close(); location.hash = '#/devices/' + d.id; } catch (e) { $('#e', el).textContent = e.message; } }); }; } });
    $('#add', root).onclick = add; const a2 = $('#add2', root); if (a2) a2.onclick = add;
  };
  await list(); const t = setInterval(() => { if (location.hash === '#/devices' && !$('.overlay')) list().catch(() => {}); }, 15000);
  return () => clearInterval(t);
};

V.device = async (root, id) => {
  let dev; try { dev = (await TR.get('/devices')).find((d) => d.id === +id); } catch (e) { root.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  if (!dev) { root.innerHTML = '<div class="empty">Device not found. <a href="#/devices">Back to devices</a></div>'; return; }
  let rows = await TR.get(`/devices/${dev.id}/readings?limit=300`); let chart, field = null; let lastSeen = dev.last_seen;
  const fields = () => { const f = new Map(); rows.forEach((r) => Object.entries(r.data).forEach(([k, v]) => f.set(k, typeof v))); return f; };
  root.innerHTML = `
    <div class="top"><div class="row"><button class="btn ghost menu-btn" data-menu>&#9776;</button><a href="#/devices" class="btn sm">&larr; My Boards</a><h1>${esc(dev.name)}</h1><span class="pill" id="st"></span></div>
      <div class="row"><button class="btn sm" id="edit">Rename</button><button class="btn sm danger" id="del">Delete</button></div></div>
    <div class="grid2" style="align-items:start">
      <div class="card"><h3>Device token <span class="pill">${esc(BOARDS[dev.board] || dev.board)}</span></h3><p class="small muted">Secret key your board uses to send data. Keep it private.</p>
        <div class="tokenbox"><code id="tok">${esc(dev.token.slice(0, 8))}${'*'.repeat(24)}</code><button class="btn sm" id="show">Show</button><button class="btn sm" id="cp">Copy</button></div>
        <div class="row" style="margin-top:.6rem"><button class="btn sm" id="regen">Regenerate token</button></div></div>
      <div class="card"><h3>Send a command</h3><p class="small muted">Your board receives it via MQTT instantly, or by polling <code>/api/device/commands</code>.</p>
        <div class="grid2"><div><label>Name</label><input id="cn" value="led" maxlength="40"></div><div><label>Value</label><input id="cv" value="1" maxlength="200"></div></div><div class="row" style="margin-top:.7rem"><button class="btn primary sm" id="csend">Send command</button></div></div>
    </div><div class="spacer"></div>
    <div class="card"><h3>Live data <span class="row"><select id="fsel" style="width:auto"></select><a class="btn sm" id="csv">Export CSV</a><button class="btn sm danger" id="clr">Clear data</button></span></h3>
      <div class="chips" id="latest"></div><div style="position:relative;height:260px;margin-top:.8rem"><canvas id="ch"></canvas></div>
      <div style="overflow:auto;max-height:260px;margin-top:.8rem"><table><thead><tr><th>Time</th><th>Data</th></tr></thead><tbody id="tb"></tbody></table></div></div>
    <div class="spacer"></div>
    <div class="card"><h3>Connect your board</h3><p class="muted small">Pick your board, copy the code (your token is already filled in), flash it, and data appears here.</p>${snippetTabs(dev)}</div>`;
  $('[data-menu]', root).onclick = () => $('.side').classList.toggle('open');
  wireSnippets(root, dev);
  const paintStatus = () => { const on = lastSeen && Date.now() - lastSeen < 90000; $('#st', root).className = 'pill ' + (on ? 'ok' : ''); $('#st', root).innerHTML = `<span class="dot ${on ? 'on' : ''}"></span> ${on ? 'online' : 'offline'} - ${ago(lastSeen)}`; }; paintStatus(); const stT = setInterval(paintStatus, 5000);
  const row = (r) => `<tr><td class="muted mono">${fmtTime(r.ts)}</td><td class="mono small">${esc(Object.entries(r.data).map(([k, v]) => `${k}=${fmtVal(v)}`).join('   '))}</td></tr>`;
  const paintTable = () => { $('#tb', root).innerHTML = rows.slice(-20).reverse().map(row).join('') || '<tr><td colspan="2" class="muted">No data yet. Flash your board with the code below, or run the curl test.</td></tr>'; };
  const paintLatest = () => { const l = rows[rows.length - 1]; $('#latest', root).innerHTML = l ? Object.entries(l.data).map(([k, v]) => `<span class="chip">${esc(k)} <b>${esc(fmtVal(v))}</b></span>`).join('') : ''; };
  const numericFields = () => [...fields()].filter(([, t]) => t === 'number' || t === 'boolean').map(([k]) => k);
  const paintSel = () => { const nf = numericFields(); const sel = $('#fsel', root); if (!field || !nf.includes(field)) field = nf[0] || null; sel.innerHTML = nf.map((f) => `<option ${f === field ? 'selected' : ''}>${esc(f)}</option>`).join(''); sel.style.display = nf.length ? '' : 'none'; };
  const paintChart = () => {
    chart && chart.destroy(); chart = null; if (!field) return; const pts = rows.filter((r) => r.data[field] !== undefined).slice(-150);
    chart = new Chart($('#ch', root), { type: 'line', data: { labels: pts.map((r) => fmtTime(r.ts)), datasets: [{ label: field, data: pts.map((r) => TR.num(r.data[field])), borderColor: '#22d3ee', backgroundColor: '#22d3ee22', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#8da0c3', maxTicksLimit: 6, maxRotation: 0 }, grid: { color: '#1f2f5255' } }, y: { ticks: { color: '#8da0c3' }, grid: { color: '#1f2f5255' } } } } });
  };
  paintSel(); paintTable(); paintLatest(); paintChart();
  $('#fsel', root).onchange = (e) => { field = e.target.value; paintChart(); };
  TR.bus.on('reading', (ev) => {
    if (ev.deviceId !== dev.id) return; rows.push({ ts: ev.ts, data: ev.data }); if (rows.length > 600) rows.shift(); lastSeen = ev.ts; paintStatus(); paintLatest();
    const nf = numericFields(); if (nf.length && !field) { paintSel(); paintChart(); }
    $('#tb', root).insertAdjacentHTML('afterbegin', row(rows[rows.length - 1])); while ($('#tb', root).rows.length > 20) $('#tb', root).deleteRow(-1);
    if (chart && ev.data[field] !== undefined) { chart.data.labels.push(fmtTime(ev.ts)); chart.data.datasets[0].data.push(TR.num(ev.data[field])); if (chart.data.labels.length > 150) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); } chart.update('none'); }
  });
  let shown = false; $('#show', root).onclick = (e) => { shown = !shown; $('#tok', root).textContent = shown ? dev.token : dev.token.slice(0, 8) + '*'.repeat(24); e.target.textContent = shown ? 'Hide' : 'Show'; };
  $('#cp', root).onclick = () => TR.copy(dev.token, 'Token copied');
  $('#regen', root).onclick = async () => { if (!(await TR.confirmBox('The old token stops working immediately - you must re-flash your board with the new one.', 'Regenerate'))) return; await TR.post(`/devices/${dev.id}/regenerate-token`); TR.toast('New token created', 'ok'); V.device(root, id); };
  $('#csend', root).onclick = async (e) => TR.busy(e.target, async () => { try { await TR.post(`/devices/${dev.id}/commands`, { name: $('#cn', root).value, value: $('#cv', root).value }); TR.toast('Command sent', 'ok'); } catch (er) { TR.toast(er.message, 'err'); } });
  $('#clr', root).onclick = async () => { if (!(await TR.confirmBox('Delete all stored readings of this device? This cannot be undone.', 'Clear data'))) return; await TR.del(`/devices/${dev.id}/readings`); rows = []; paintSel(); paintTable(); paintLatest(); paintChart(); };
  $('#del', root).onclick = async () => { if (!(await TR.confirmBox(`Delete "${dev.name}" with all its data, rules and widgets? This cannot be undone.`))) return; await TR.del('/devices/' + dev.id); location.hash = '#/devices'; };
  $('#edit', root).onclick = () => TR.modal(`<h3>Rename device</h3><label>Name</label><input id="n" value="${esc(dev.name)}" maxlength="60"><div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, { onMount(el, close) { $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = async () => { await TR.put('/devices/' + dev.id, { name: $('#n', el).value }); close(); V.device(root, id); }; } });
  $('#csv', root).onclick = async () => { try { const r = await TR.api('GET', `/devices/${dev.id}/export.csv`, undefined, true); if (!r.ok) throw new Error('Export failed'); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = dev.name.replace(/[^\w.-]+/g, '_') + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); } catch (e) { TR.toast(e.message, 'err'); } };
  return () => { clearInterval(stT); chart && chart.destroy(); };
};
