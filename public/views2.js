'use strict';
/* Views: ML studio, automation, docs, account */

// ---------- ML helpers ----------
function sourceHTML(devs) {
  return `<label>Training data</label>
  <div class="row"><label style="margin:0;color:var(--text)"><input type="radio" name="src" value="device" checked style="width:auto"> My device's stored data</label><label style="margin:0;color:var(--text)"><input type="radio" name="src" value="csv" style="width:auto"> Upload / paste CSV</label></div>
  <div id="srcdev">${devs.length ? `<select id="sdev">${devs.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>` : '<p class="small muted">You have no devices yet - use CSV, or add a device first.</p>'}</div>
  <div id="srccsv" hidden><input type="file" id="sfile" accept=".csv,.txt,text/csv"><textarea id="scsv" placeholder="temp,hum,fan&#10;24.1,61,off&#10;31.5,48,on" spellcheck="false"></textarea><div class="small muted">First row = column names. Max 2 MB.</div></div>`;
}
function wireSource(el, onCols) {
  const q = (s) => el.querySelector(s); const mode = () => el.querySelector('input[name=src]:checked').value;
  const cols = async () => {
    try {
      if (mode() === 'device') { const id = q('#sdev')?.value; if (!id) return onCols([]); const f = await TR.get(`/devices/${id}/fields`); onCols(f.map((x) => ({ name: x.name, numeric: x.type !== 'string' }))); }
      else { const csv = q('#scsv').value; if (!csv.trim()) return onCols([]); const p = await TR.post('/ml/csv-preview', { csv }); onCols(p.columns); }
    } catch (e) { onCols([], e.message); }
  };
  el.querySelectorAll('input[name=src]').forEach((r) => (r.onchange = () => { q('#srcdev').hidden = mode() !== 'device'; q('#srccsv').hidden = mode() !== 'csv'; cols(); }));
  q('#sdev') && (q('#sdev').onchange = cols); q('#scsv').onchange = cols;
  q('#sfile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 2e6) return TR.toast('File too large (max 2 MB)', 'err'); q('#scsv').value = await f.text(); cols(); };
  return { cols, get: () => (mode() === 'device' ? { type: 'device', deviceId: +q('#sdev')?.value } : { type: 'csv', csv: q('#scsv').value }) };
}
const metricText = (m) => !m ? '' : Object.entries(m).filter(([k, v]) => typeof v !== 'object' && k !== 'trainMs').map(([k, v]) => `<span class="chip">${esc(k)} <b>${esc(v)}</b></span>`).join('');

V.ml = async (root) => {
  const load = () => Promise.all([TR.get('/ml/algorithms'), TR.get('/ml/models'), TR.get('/devices')]);
  const draw = async () => {
    const [algos, models, devs] = await load(); const A = Object.fromEntries(algos.map((a) => [a.id, a]));
    root.innerHTML = `<div class="top"><div class="row"><button class="btn ghost menu-btn" data-menu>&#9776;</button><h1>Smart Models (AI)</h1></div><button class="btn primary" id="new">+ New smart model</button></div>
    <div class="card" style="margin-bottom:1rem;background:linear-gradient(135deg,#12304a,#1a1f4d)"><h3>Run machine learning without extra hardware</h3><p class="muted" style="margin:0">Train and run models on the TronicIOT cloud. Your ESP32 / Arduino / Pico just sends sensor data (or calls a prediction URL) - no Raspberry Pi, Jetson or GPU needed. Turn on <b>Auto-run</b> and every new reading gets a live prediction, anomaly alert or forecast.</p></div>
    ${models.length ? `<div class="devgrid">${models.map((m) => `<div class="card" data-id="${m.id}"><h3><span>${esc(m.name)}</span><span class="pill ${m.status === 'trained' ? 'ok' : 'warn'}">${m.status}</span></h3>
      <div class="muted small">${esc(A[m.algorithm]?.label || m.algorithm)} &middot; inputs: ${esc(m.config.features.join(', '))}${m.config.target ? ` &rarr; <b>${esc(m.config.target)}</b>` : ''}</div>
      <div class="chips">${metricText(m.metrics) || '<span class="muted small">Not trained yet</span>'}</div>
      ${m.status === 'trained' ? `<label>Auto-run on every new reading of</label><select data-auto><option value="">- off -</option>${devs.map((d) => `<option value="${d.id}" ${m.auto_device_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
      <div class="row" style="margin-top:.8rem"><button class="btn sm primary" data-train>${m.status === 'trained' ? 'Retrain' : 'Train'}</button><button class="btn sm" data-test ${m.status !== 'trained' ? 'disabled' : ''}>Test</button><button class="btn sm" data-code ${m.status !== 'trained' ? 'disabled' : ''}>Use in code</button><button class="btn sm" data-exp ${m.status !== 'trained' ? 'disabled' : ''}>Export</button><button class="btn sm danger" data-del>Delete</button></div></div>`).join('')}</div>`
      : `<div class="empty"><h3>No models yet</h3><p>Create a model from your device data or a CSV file. Try <b>Anomaly Detection</b> on a sensor for a 30-second start.</p></div>`}
    <div class="spacer"></div><h2>What can you run?</h2><div class="devgrid">${algos.map((a) => `<div class="card"><h3>${esc(a.label)} <span class="pill">${esc(a.kind)}</span></h3><p class="muted small" style="margin:0">${esc(a.desc)}</p></div>`).join('')}</div>`;
    $('[data-menu]', root).onclick = () => $('.side').classList.toggle('open');
    $('#new', root).onclick = () => newModel(algos, devs, draw);
    $$('[data-id]', root).forEach((card) => {
      const m = models.find((x) => x.id === +card.dataset.id); const b = (s) => $(s, card);
      b('[data-train]').onclick = () => trainDialog(m, devs, draw);
      b('[data-test]').onclick = () => testDialog(m);
      b('[data-code]').onclick = () => codeDialog(m, devs);
      b('[data-exp]').onclick = async () => { try { const r = await TR.api('GET', `/ml/models/${m.id}/export`, undefined, true); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m.name.replace(/[^\w.-]+/g, '_') + '.json'; a.click(); } catch (e) { TR.toast(e.message, 'err'); } };
      b('[data-del]').onclick = async () => { if (await TR.confirmBox(`Delete model "${m.name}"?`)) { await TR.del('/ml/models/' + m.id); draw(); } };
      const au = b('[data-auto]'); if (au) au.onchange = async () => { try { await TR.put('/ml/models/' + m.id, { autoDeviceId: au.value || null }); TR.toast(au.value ? 'Auto-run enabled' : 'Auto-run off', 'ok'); } catch (e) { TR.toast(e.message, 'err'); } };
    });
  };
  await draw();
  TR.bus.on('prediction', () => {}); // keeps ws handler registered; cleared on route change
};

function newModel(algos, devs, done) {
  TR.modal(`<h3>New ML model</h3>
    <label>Algorithm</label><select id="algo">${algos.map((a) => `<option value="${a.id}">${esc(a.label)}</option>`).join('')}</select><p class="small muted" id="adesc"></p>
    <label>Model name</label><input id="name" maxlength="60" placeholder="Fan controller">
    ${sourceHTML(devs)}
    <div id="colmsg" class="small muted" style="margin-top:.5rem"></div>
    <div id="featbox"><label id="featlabel">Input fields (features)</label><div class="checks" id="feats"></div></div>
    <div id="targetbox"><label>Field to predict (target)</label><select id="target"></select></div>
    <div id="pk"><label id="pklabel">Neighbours / clusters (k)</label><input id="kv" type="number" min="1" max="50" value="5"></div>
    <div id="pt"><label>Anomaly threshold (std-devs, 3 = strict, 2 = sensitive)</label><input id="tv" type="number" min="1" max="10" step="0.5" value="3"></div>
    <div class="err" id="err"></div><div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Create &amp; train</button></div>`, {
    wide: true,
    onMount(el, close) {
      const q = (s) => el.querySelector(s); let cols = [];
      const algo = () => algos.find((a) => a.id === q('#algo').value);
      const paint = () => {
        const a = algo(); q('#adesc').textContent = a.desc; q('#targetbox').hidden = !a.needsTarget; q('#pk').hidden = !['knn', 'kmeans'].includes(a.id); q('#pt').hidden = a.id !== 'anomaly';
        q('#kv').value = a.id === 'kmeans' ? 3 : 5; q('#pklabel').textContent = a.id === 'kmeans' ? 'Number of clusters' : 'Neighbours (k)';
        const numeric = cols.filter((c) => c.numeric); const single = a.singleFeature;
        q('#featlabel').textContent = single ? 'Field to forecast' : 'Input fields (features)';
        q('#feats').innerHTML = numeric.map((c, i) => `<label><input type="${single ? 'radio' : 'checkbox'}" name="feat" value="${esc(c.name)}" ${single && i === 0 ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') || '<span class="muted small">Choose a data source with numeric fields first</span>';
        const tcols = a.id === 'linear_regression' ? numeric : cols; q('#target').innerHTML = tcols.map((c) => `<option>${esc(c.name)}</option>`).join('');
      };
      const src = wireSource(el, (c, msg) => { cols = c; q('#colmsg').textContent = msg || (c.length ? `Found ${c.length} fields: ${c.map((x) => x.name).join(', ')}` : 'No fields found yet - the device needs to send data first, or paste a CSV.'); paint(); });
      q('#algo').onchange = paint; paint(); src.cols();
      q('[data-x]').onclick = close;
      q('[data-ok]').onclick = async (ev) => {
        const a = algo(); const features = [...el.querySelectorAll('[name=feat]:checked')].map((x) => x.value); const err = q('#err'); err.textContent = '';
        const config = { features }; if (a.needsTarget) config.target = q('#target').value; if (!q('#pk').hidden) config.k = +q('#kv').value; if (!q('#pt').hidden) config.threshold = +q('#tv').value;
        await TR.busy(ev.target, async () => {
          let model; try { model = await TR.post('/ml/models', { name: q('#name').value, algorithm: a.id, config }); } catch (e) { return (err.textContent = e.message); }
          try { const t = await TR.post(`/ml/models/${model.id}/train`, { source: src.get() }); TR.toast('Model trained!', 'ok'); close(); done(); } catch (e) { err.textContent = `Model saved, but training failed: ${e.message}`; done(); }
        });
      };
    },
  });
}

function trainDialog(m, devs, done) {
  TR.modal(`<h3>${m.status === 'trained' ? 'Retrain' : 'Train'} "${esc(m.name)}"</h3><p class="muted small">Inputs: ${esc(m.config.features.join(', '))}${m.config.target ? ' &rarr; ' + esc(m.config.target) : ''}</p>${sourceHTML(devs)}<div class="err" id="err"></div><div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Train now</button></div>`, {
    onMount(el, close) { const src = wireSource(el, () => {}); el.querySelector('[data-x]').onclick = close; el.querySelector('[data-ok]').onclick = async (ev) => TR.busy(ev.target, async () => { try { await TR.post(`/ml/models/${m.id}/train`, { source: src.get() }); TR.toast('Model trained!', 'ok'); close(); done(); } catch (e) { el.querySelector('#err').textContent = e.message; } }); },
  });
}

function testDialog(m) {
  const forecast = m.algorithm === 'forecast';
  TR.modal(`<h3>Test "${esc(m.name)}"</h3><p class="muted small">Enter sample values and see what the model returns.</p>${forecast ? '<label>Steps ahead</label><input data-in="steps" type="number" value="5" min="1" max="100">' : m.config.features.map((f) => `<label>${esc(f)}</label><input data-in="${esc(f)}" type="number" step="any" value="0">`).join('')}<div class="actions"><button class="btn" data-x>Close</button><button class="btn primary" data-ok>Run prediction</button></div><pre class="code" id="out" hidden></pre>`, {
    onMount(el, close) { el.querySelector('[data-x]').onclick = close; el.querySelector('[data-ok]').onclick = async (ev) => TR.busy(ev.target, async () => { const inputs = {}; el.querySelectorAll('[data-in]').forEach((i) => (inputs[i.dataset.in] = +i.value)); const out = el.querySelector('#out'); out.hidden = false; try { out.textContent = JSON.stringify((await TR.post(`/ml/models/${m.id}/predict`, { inputs })).output, null, 2); } catch (e) { out.textContent = 'Error: ' + e.message; } }); },
  });
}

function codeDialog(m, devs) {
  const base = TR.origin(); const tok = devs[0]?.token || 'YOUR_DEVICE_TOKEN'; const ins = m.algorithm === 'forecast' ? { steps: 5 } : Object.fromEntries(m.config.features.map((f) => [f, 24.5]));
  const json = JSON.stringify({ inputs: ins }); const ino = json.replace(/"/g, '\\"');
  const code = {
    'ESP32 (cloud inference)': `// Your ESP32 asks the TronicIOT cloud to run the model - no heavy hardware needed.
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
const String SERVER = "${base}";
const String TOKEN  = "${tok}";

String predict(float temp) {       // adapt the inputs to your model
  HTTPClient http;
  http.begin(SERVER + "/api/ml/models/${m.id}/predict");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", TOKEN);
  int code = http.POST("${ino}");
  String res = (code == 200) ? http.getString() : "";
  http.end();
  return res;                      // {"model":"${m.name}","output":{...}}
}`,
    'Python / curl': `curl -X POST ${base}/api/ml/models/${m.id}/predict \\
  -H "Content-Type: application/json" \\
  -H "X-Device-Token: ${tok}" \\
  -d '${json}'`,
    'Auto-run (no code)': `1. Open ML Studio -> this model -> "Auto-run on every new reading of" -> choose your device.
2. Every time that device sends data, TronicIOT runs "${m.name}" automatically.
3. Show it live with the dashboard widget "ML model output".
4. Anomaly models also raise alerts automatically.
5. Automation rules can switch relays/LEDs based on sensor values.`,
  };
  const names = Object.keys(code);
  TR.modal(`<h3>Use "${esc(m.name)}" in your project</h3><div class="tabs">${names.map((n, i) => `<button class="tab ${i ? '' : 'active'}" data-i="${i}">${esc(n)}</button>`).join('')}</div><pre class="code" id="cd">${esc(code[names[0]])}</pre><div class="actions"><button class="btn" data-copy>Copy</button><button class="btn primary" data-x>Close</button></div>`, {
    wide: true, onMount(el, close) { let cur = 0; el.querySelectorAll('.tab').forEach((b) => (b.onclick = () => { cur = +b.dataset.i; el.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b)); el.querySelector('#cd').textContent = code[names[cur]]; })); el.querySelector('[data-x]').onclick = close; el.querySelector('[data-copy]').onclick = () => TR.copy(code[names[cur]]); },
  });
}

// ---------- AUTOMATION ----------
V.automation = async (root) => {
  const draw = async () => {
    const [devs, rules, alerts] = await Promise.all([TR.get('/devices'), TR.get('/rules'), TR.get('/alerts')]);
    root.innerHTML = `<div class="top"><div class="row"><button class="btn ghost menu-btn" data-menu>&#9776;</button><h1>Rules &amp; Alerts</h1></div></div>
    <div class="grid2" style="align-items:start">
      <div class="card"><h3>New rule</h3><p class="small muted">When a sensor value passes a limit: raise an alert and (optionally) send a command to the board - e.g. turn a fan on.</p>
        ${devs.length ? `<label>Device</label><select id="rd">${devs.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
        <div class="grid2"><div><label>Field</label><input id="rf" placeholder="temp" maxlength="40"></div><div class="row" style="align-items:end"><div class="grow"><label>Condition</label><select id="ro">${['>', '<', '>=', '<=', '==', '!='].map((o) => `<option>${o}</option>`).join('')}</select></div><div class="grow"><label>Value</label><input id="rt" type="number" step="any"></div></div></div>
        <label>Alert message (optional)</label><input id="rm" maxlength="200" placeholder="Greenhouse is too hot!">
        <div class="grid2"><div><label>Then send command (optional)</label><input id="rc" placeholder="fan" maxlength="40"></div><div><label>Command value</label><input id="rv" placeholder="1" maxlength="200"></div></div>
        <div class="err" id="rerr"></div><div class="row" style="margin-top:.6rem"><button class="btn primary" id="radd">Add rule</button></div>` : '<p class="muted">Add a device first.</p>'}
        <h3 style="margin-top:1.2rem">Active rules</h3>
        ${rules.length ? `<table><tbody>${rules.map((r) => `<tr><td><b>${esc(r.device_name)}</b>: ${esc(r.field)} ${esc(r.op)} ${esc(r.threshold)}${r.cmd_name ? `<div class="small muted">&rarr; send ${esc(r.cmd_name)}=${esc(r.cmd_value)}</div>` : ''}</td><td style="text-align:right"><button class="btn sm danger" data-rd="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No rules yet.</p>'}</div>
      <div class="card"><h3>Alerts <span class="row"><button class="btn sm" id="aread">Mark read</button><button class="btn sm danger" id="aclr">Clear</button></span></h3><div id="al">${alerts.length ? alerts.map(alertRow).join('') : '<p class="muted small">No alerts. Alerts from rules and ML anomaly detection appear here live.</p>'}</div></div>
    </div>`;
    $('[data-menu]', root).onclick = () => $('.side').classList.toggle('open');
    const add = $('#radd', root);
    if (add) add.onclick = async (e) => TR.busy(e.target, async () => { try { await TR.post('/rules', { deviceId: +$('#rd', root).value, field: $('#rf', root).value, op: $('#ro', root).value, threshold: $('#rt', root).value, message: $('#rm', root).value, cmdName: $('#rc', root).value, cmdValue: $('#rv', root).value }); TR.toast('Rule added', 'ok'); draw(); } catch (er) { $('#rerr', root).textContent = er.message; } });
    $$('[data-rd]', root).forEach((b) => (b.onclick = async () => { await TR.del('/rules/' + b.dataset.rd); draw(); }));
    $('#aread', root).onclick = async () => { await TR.post('/alerts/read'); setBadge(0); draw(); };
    $('#aclr', root).onclick = async () => { await TR.del('/alerts'); setBadge(0); draw(); };
    TR.post('/alerts/read').then(() => setBadge(0)).catch(() => {});
  };
  await draw();
  TR.bus.on('alert', (ev) => { const al = $('#al', root); if (al) { if (al.querySelector('p')) al.innerHTML = ''; al.insertAdjacentHTML('afterbegin', alertRow({ ...ev, device_name: '' })); } });
};
const alertRow = (a) => `<div class="alert-item ${esc(a.level)}"><span class="lvl">&#9679;</span><div class="grow"><div>${esc(a.message)}</div><div class="small muted">${esc(a.device_name || '')} ${a.device_name ? '&middot;' : ''} ${ago(a.ts)}</div></div></div>`;

// ---------- DOCS ----------
V.docs = async (root) => {
  const base = TR.origin();
  root.innerHTML = `<div class="top"><div class="row"><button class="btn ghost menu-btn" data-menu>&#9776;</button><h1>Help</h1></div></div>
  <div class="card"><h2>Quick start (5 minutes)</h2><div class="steps">
    <div class="card"><b>Add a device</b><p class="muted small">Devices &rarr; Add device. You get a secret token and ready-to-paste code for ESP32, ESP8266, Pico W, Arduino or Python.</p></div>
    <div class="card"><b>Send data</b><p class="muted small">Your board POSTs JSON like <code>{"temp":24.5}</code>. Any field names, up to 50 per message.</p></div>
    <div class="card"><b>Build a dashboard</b><p class="muted small">Add gauges, live charts, switches and sliders. Switches send commands back to the board.</p></div>
    <div class="card"><b>Add ML</b><p class="muted small">ML Studio &rarr; train on stored data or a CSV, then turn on Auto-run for live predictions and anomaly alerts.</p></div></div></div>
  <div class="spacer"></div>
  <div class="card"><h2>Device API</h2><p class="muted small">Authenticate with header <code>X-Device-Token: &lt;token&gt;</code> (or <code>Authorization: Bearer &lt;token&gt;</code>).</p>
    <table><thead><tr><th>Method &amp; path</th><th>What it does</th></tr></thead><tbody>
    <tr><td class="mono">POST /api/ingest</td><td>Send readings. Body: flat JSON <code>{"temp":24.5,"relay":true}</code></td></tr>
    <tr><td class="mono">GET /api/ingest?token=..&amp;temp=24</td><td>Same, for very simple clients</td></tr>
    <tr><td class="mono">GET /api/device/commands</td><td>Fetch pending commands <code>{"commands":[{"id":1,"name":"led","value":"1"}]}</code> (each delivered once)</td></tr>
    <tr><td class="mono">POST /api/ml/models/:id/predict</td><td>Run a trained model in the cloud: <code>{"inputs":{"temp":24}}</code></td></tr></tbody></table></div>
  <div class="spacer"></div>
  <div class="card"><h2>MQTT</h2><p class="muted small">Built-in broker on port <b>1883</b> (host: <code>${esc(TR.mqttHost())}</code>). Username = your device token, password = anything.</p>
    <table><tbody><tr><td class="mono">publish tronic/&lt;token&gt;/data</td><td>JSON readings, e.g. <code>{"temp":24.5}</code></td></tr><tr><td class="mono">subscribe tronic/&lt;token&gt;/cmd</td><td>Receive <code>{"id":1,"name":"led","value":"1"}</code> instantly</td></tr></tbody></table></div>
  <div class="spacer"></div>
  <div class="card"><h2>Running ML without a Raspberry Pi</h2><p>Cloud ML is built in. Pick an algorithm in ML Studio:</p><ul class="muted"><li><b>Linear regression</b> - estimate a number (e.g. predict humidity from temperature).</li><li><b>Classifier / KNN</b> - decide a label (fan on/off, healthy/faulty).</li><li><b>K-Means</b> - discover operating modes with no labels.</li><li><b>Anomaly detection</b> - learn "normal", alert on odd readings.</li><li><b>Forecast</b> - predict the next values of a sensor.</li></ul>
    <p class="muted small">Every model can be exported as JSON (coefficients/centroids) if you later want to run it directly on a board. Test from any terminal:</p><pre class="code">curl -X POST ${esc(base)}/api/ml/models/1/predict -H "X-Device-Token: tr_..." -H "Content-Type: application/json" -d '{"inputs":{"temp":24.5}}'</pre></div>
  <div class="spacer"></div>
  <div class="card"><h2>Limits &amp; tips</h2><ul class="muted"><li>Device is "online" if it sent data or polled commands in the last 90 seconds.</li><li>Rate limit: 240 requests/minute per device. Sending every 2-5 s is plenty.</li><li>Latest 20,000 readings per device are kept; export CSV any time.</li><li>Regenerate a token if you ever leak it.</li></ul></div>`;
  $('[data-menu]', root).onclick = () => $('.side').classList.toggle('open');
};

// ---------- ACCOUNT ----------
V.account = async (root) => {
  const u = TR.S.user;
  root.innerHTML = `<div class="top"><div class="row"><button class="btn ghost menu-btn" data-menu>&#9776;</button><h1>Account</h1></div></div>
  <div class="grid2" style="align-items:start"><div class="card"><h3>Profile</h3><p><b>${esc(u.name)}</b><br><span class="muted">${esc(u.email)}</span></p><button class="btn danger" id="lo">Sign out</button></div>
  <div class="card"><h3>Change password</h3><label>Current password</label><input id="cp" type="password" autocomplete="current-password"><label>New password (8+ chars, letter + number)</label><input id="np" type="password" autocomplete="new-password"><div class="err" id="e"></div><div class="row" style="margin-top:.6rem"><button class="btn primary" id="sv">Update password</button></div></div></div>`;
  $('[data-menu]', root).onclick = () => $('.side').classList.toggle('open');
  $('#lo', root).onclick = () => TR.logout();
  $('#sv', root).onclick = async (e) => TR.busy(e.target, async () => { try { await TR.put('/auth/password', { current: $('#cp', root).value, next: $('#np', root).value }); TR.toast('Password updated', 'ok'); $('#cp', root).value = $('#np', root).value = ''; $('#e', root).textContent = ''; } catch (er) { $('#e', root).textContent = er.message; } });
};
