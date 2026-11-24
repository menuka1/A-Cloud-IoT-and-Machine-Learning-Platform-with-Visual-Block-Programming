'use strict';
/* Dashboard widgets. Each mounts into a card body and returns { update(ev), destroy() } */
const Widgets = (() => {
  const { esc, fmtVal, fmtTime, num, ago } = TR;
  const TYPES = {
    value:  { label: 'Value card', icon: 'Aa', fields: ['device', 'field', 'unit'] },
    gauge:  { label: 'Gauge', icon: 'O', fields: ['device', 'field', 'unit', 'range'] },
    line:   { label: 'Line chart (live)', icon: '~', fields: ['device', 'field', 'unit', 'points'] },
    bar:    { label: 'Bar chart (live)', icon: '|||', fields: ['device', 'field', 'unit', 'points'] },
    switch: { label: 'Switch (send command)', icon: 'ON', fields: ['device', 'command', 'state', 'onoff'] },
    slider: { label: 'Slider (send command)', icon: '-o-', fields: ['device', 'command', 'range', 'step'] },
    status: { label: 'Device status', icon: '*', fields: ['device'] },
    ml:     { label: 'ML model output', icon: 'AI', fields: ['model', 'outputKey'] },
    log:    { label: 'Live data log', icon: '=', fields: ['device'] },
  };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function mount(w, card, ctx) {
    const c = w.config || {}; const body = card.querySelector('.wbody'); const dev = ctx.devices.get(c.deviceId);
    const build = BUILD[w.type]; if (!build) { body.textContent = 'Unknown widget'; return { update() {}, destroy() {} }; }
    if (c.deviceId !== undefined && !dev) { body.innerHTML = '<div class="muted small">Device was deleted.</div>'; return { update() {}, destroy() {} }; }
    return build(w, body, ctx, c, dev) || { update() {}, destroy() {} };
  }

  const lastOf = (hist, field) => { for (let i = hist.length - 1; i >= 0; i--) if (hist[i].data[field] !== undefined) return { v: hist[i].data[field], ts: hist[i].ts }; return null; };

  const BUILD = {
    value(w, body, ctx, c) {
      body.innerHTML = '<div class="big">-</div><div class="foot"></div>'; const big = body.querySelector('.big'), foot = body.querySelector('.foot'); let ts = 0;
      const set = (v, t) => { big.innerHTML = `${esc(fmtVal(v))}<small>${esc(c.unit || '')}</small>`; ts = t; foot.textContent = `${c.field} - ${ago(t)}`; };
      ctx.hist(c.deviceId).then((h) => { const l = lastOf(h, c.field); if (l) set(l.v, l.ts); else foot.textContent = `waiting for "${c.field}"...`; });
      const timer = setInterval(() => { if (ts) foot.textContent = `${c.field} - ${ago(ts)}`; }, 5000);
      return { update(ev) { if (ev.type === 'reading' && ev.deviceId === c.deviceId && ev.data[c.field] !== undefined) set(ev.data[c.field], ev.ts); }, destroy() { clearInterval(timer); } };
    },
    gauge(w, body, ctx, c) {
      const min = c.min ?? 0, max = c.max ?? 100;
      body.innerHTML = `<svg class="gauge" viewBox="0 0 200 125"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#1b2b4d" stroke-width="16" stroke-linecap="round"/><path class="arc" d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="${css('--accent')}" stroke-width="16" stroke-linecap="round" stroke-dasharray="0 252"/><text class="gv" x="100" y="96" text-anchor="middle" fill="${css('--text')}" font-size="30" font-weight="700">-</text><text x="20" y="120" text-anchor="middle" fill="${css('--muted')}" font-size="11">${esc(min)}</text><text x="180" y="120" text-anchor="middle" fill="${css('--muted')}" font-size="11">${esc(max)}</text></svg><div class="foot" style="text-align:center">${esc(c.field)}</div>`;
      const arc = body.querySelector('.arc'), gv = body.querySelector('.gv');
      const set = (v) => { const n = num(v); if (typeof n !== 'number' || Number.isNaN(n)) return; const f = Math.max(0, Math.min(1, (n - min) / ((max - min) || 1))); arc.setAttribute('stroke-dasharray', `${(f * 251.3).toFixed(1)} 252`); gv.textContent = fmtVal(+n.toFixed(1)) + (c.unit || ''); };
      ctx.hist(c.deviceId).then((h) => { const l = lastOf(h, c.field); if (l) set(l.v); });
      return { update(ev) { if (ev.type === 'reading' && ev.deviceId === c.deviceId && ev.data[c.field] !== undefined) set(ev.data[c.field]); } };
    },
    line(w, body, ctx, c) { return chart(w, body, ctx, c, 'line'); },
    bar(w, body, ctx, c) { return chart(w, body, ctx, c, 'bar'); },
    switch(w, body, ctx, c) {
      const on = String(c.onValue ?? 1), off = String(c.offValue ?? 0);
      body.innerHTML = `<div class="switch" role="switch" tabindex="0" aria-checked="false"></div><div class="foot" style="text-align:center">command: ${esc(c.command)}</div>`;
      const sw = body.querySelector('.switch'); let state = false; const paint = () => { sw.classList.toggle('on', state); sw.setAttribute('aria-checked', state); };
      const fromVal = (v) => String(v) === on || v === true || String(v).toLowerCase() === 'on';
      if (c.field) ctx.hist(c.deviceId).then((h) => { const l = lastOf(h, c.field); if (l) { state = fromVal(l.v); paint(); } });
      const toggle = async () => { state = !state; paint(); try { await TR.post(`/devices/${c.deviceId}/commands`, { name: c.command, value: state ? on : off }); } catch (e) { state = !state; paint(); TR.toast(e.message, 'err'); } };
      sw.onclick = toggle; sw.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } };
      return { update(ev) { if (c.field && ev.type === 'reading' && ev.deviceId === c.deviceId && ev.data[c.field] !== undefined) { state = fromVal(ev.data[c.field]); paint(); } } };
    },
    slider(w, body, ctx, c) {
      const min = c.min ?? 0, max = c.max ?? 100;
      body.innerHTML = `<div class="big" style="font-size:1.8rem">${esc(min)}</div><input type="range" min="${min}" max="${max}" step="${c.step || 1}" value="${min}" aria-label="${esc(w.title)}"><div class="foot">command: ${esc(c.command)}</div>`;
      const r = body.querySelector('input'), big = body.querySelector('.big');
      r.oninput = () => { big.textContent = r.value; };
      r.onchange = async () => { try { await TR.post(`/devices/${c.deviceId}/commands`, { name: c.command, value: r.value }); } catch (e) { TR.toast(e.message, 'err'); } };
    },
    status(w, body, ctx, c, dev) {
      let seen = dev.last_seen;
      body.innerHTML = '<div class="big" style="font-size:1.6rem"></div><div class="foot"></div>'; const big = body.querySelector('.big'), foot = body.querySelector('.foot');
      const paint = () => { const on = seen && Date.now() - seen < 90000; big.innerHTML = `<span class="dot ${on ? 'on' : ''}"></span> ${on ? 'Online' : 'Offline'}`; foot.textContent = `${dev.name} - last seen ${ago(seen)}`; };
      paint(); const t = setInterval(paint, 5000);
      return { update(ev) { if (ev.type === 'reading' && ev.deviceId === c.deviceId) { seen = ev.ts; paint(); } }, destroy() { clearInterval(t); } };
    },
    ml(w, body, ctx, c) {
      const model = ctx.models.get(c.modelId); if (!model) { body.innerHTML = '<div class="muted small">Model was deleted.</div>'; return; }
      body.innerHTML = '<div class="mlout muted">waiting for prediction...</div>'; const out = body.querySelector('.mlout');
      const show = (o, ts) => {
        const keys = Object.keys(o); const main = c.outputKey && o[c.outputKey] !== undefined ? c.outputKey : ['value', 'label', 'cluster', 'anomaly', 'next'].find((k) => o[k] !== undefined) || keys[0];
        const mv = o[main]; const bad = main === 'anomaly' && mv === true;
        out.className = 'mlout'; out.innerHTML = `<div class="big" style="${bad ? 'color:var(--bad)' : ''}">${esc(Array.isArray(mv) ? mv.slice(0, 3).join(', ') : fmtVal(mv))}</div>` + keys.filter((k) => k !== main && typeof o[k] !== 'object').slice(0, 4).map((k) => `<div class="kv"><span class="muted">${esc(k)}</span><span>${esc(fmtVal(o[k]))}</span></div>`).join('') + `<div class="foot">${esc(model.name)} - ${ago(ts)}</div>`;
      };
      TR.get(`/ml/models/${c.modelId}/predictions?limit=1`).then((p) => { if (p.length) show(p[0].output, p[0].ts); }).catch(() => {});
      return { update(ev) { if (ev.type === 'prediction' && ev.modelId === c.modelId) show(ev.output, ev.ts); } };
    },
    log(w, body, ctx, c) {
      body.innerHTML = '<div style="overflow:auto;max-height:220px"><table><tbody></tbody></table></div>'; const tb = body.querySelector('tbody');
      const row = (ts, d) => `<tr><td class="muted mono">${fmtTime(ts)}</td><td class="mono small">${esc(Object.entries(d).map(([k, v]) => `${k}=${fmtVal(v)}`).join('  '))}</td></tr>`;
      ctx.hist(c.deviceId).then((h) => { tb.innerHTML = h.slice(-8).reverse().map((r) => row(r.ts, r.data)).join('') || '<tr><td class="muted">no data yet</td></tr>'; });
      return { update(ev) { if (ev.type === 'reading' && ev.deviceId === c.deviceId) { tb.insertAdjacentHTML('afterbegin', row(ev.ts, ev.data)); while (tb.rows.length > 8) tb.deleteRow(-1); } } };
    },
  };

  function chart(w, body, ctx, c, type) {
    const max = Math.min(Math.max(+c.points || (type === 'bar' ? 15 : 60), 5), 300);
    body.innerHTML = '<div class="chartbox"><canvas></canvas></div>'; let ch;
    const color = c.color || css('--accent');
    const mk = (rows) => {
      ch = new Chart(body.querySelector('canvas'), {
        type, data: { labels: rows.map((r) => fmtTime(r.ts)), datasets: [{ label: c.field + (c.unit ? ` (${c.unit})` : ''), data: rows.map((r) => num(r.data[c.field])), borderColor: color, backgroundColor: type === 'bar' ? color + 'aa' : color + '22', fill: type === 'line', tension: 0.3, pointRadius: 0, borderWidth: 2, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: css('--muted'), maxTicksLimit: 5, maxRotation: 0 }, grid: { color: '#1f2f5255' } }, y: { ticks: { color: css('--muted') }, grid: { color: '#1f2f5255' } } } },
      });
    };
    ctx.hist(c.deviceId).then((h) => mk(h.filter((r) => r.data[c.field] !== undefined).slice(-max)));
    return {
      update(ev) { if (!ch || ev.type !== 'reading' || ev.deviceId !== c.deviceId || ev.data[c.field] === undefined) return; ch.data.labels.push(fmtTime(ev.ts)); ch.data.datasets[0].data.push(num(ev.data[c.field])); while (ch.data.labels.length > max) { ch.data.labels.shift(); ch.data.datasets[0].data.shift(); } ch.update('none'); },
      destroy() { ch && ch.destroy(); },
    };
  }

  // ---------- add-widget dialog ----------
  function addDialog(dashId, ctx, done) {
    const devs = [...ctx.devices.values()], models = [...ctx.models.values()];
    if (!devs.length && !models.length) { TR.toast('Add a device first (Devices page)', 'warn'); location.hash = '#/devices'; return; }
    const m = TR.modal(`
      <h3>Add widget</h3>
      <label>Widget type</label><select id="wt">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <label>Title</label><input id="wtitle" maxlength="60" placeholder="e.g. Room temperature">
      <div data-f="device"><label>Device</label><select id="wdev">${devs.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
      <div data-f="field"><label>Data field (key your board sends)</label><input id="wfield" list="fl" placeholder="temp" autocomplete="off"><datalist id="fl"></datalist></div>
      <div data-f="model"><label>ML model</label><select id="wmodel">${models.map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(x.algorithm)})</option>`).join('') || '<option value="">no models yet</option>'}</select></div>
      <div data-f="outputKey"><label>Output to show (optional: value, label, anomaly, score...)</label><input id="wout" placeholder="auto"></div>
      <div data-f="command"><label>Command name (your board reads this)</label><input id="wcmd" placeholder="led" maxlength="40"></div>
      <div data-f="state"><label>State field (optional - keeps switch in sync with the board)</label><input id="wstate" list="fl" placeholder="led_state" autocomplete="off"></div>
      <div class="grid2" data-f="onoff"><div><label>ON value</label><input id="won" value="1"></div><div><label>OFF value</label><input id="woff" value="0"></div></div>
      <div class="grid2" data-f="range"><div><label>Min</label><input id="wmin" type="number" value="0"></div><div><label>Max</label><input id="wmax" type="number" value="100"></div></div>
      <div data-f="step"><label>Step</label><input id="wstep" type="number" value="1" min="0.01" step="any"></div>
      <div class="grid2" data-f="unit"><div><label>Unit (optional)</label><input id="wunit" maxlength="10" placeholder="C"></div><div data-f="points"><label>History points</label><input id="wpts" type="number" value="60" min="5" max="300"></div></div>
      <label>Size</label><select id="wsize"><option value="m">Normal</option><option value="l">Wide (2 columns)</option><option value="s">Compact</option></select>
      <div class="err" id="werr"></div>
      <div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Add widget</button></div>`, {
      onMount(el, close) {
        const $ = (s) => el.querySelector(s);
        const sync = () => { const t = TYPES[$('#wt').value]; el.querySelectorAll('[data-f]').forEach((n) => { n.style.display = t.fields.includes(n.dataset.f) ? '' : 'none'; }); $('[data-f=points]').style.display = t.fields.includes('points') ? '' : 'none'; loadFields(); };
        const loadFields = async () => { const id = $('#wdev').value; if (!id) return; try { const f = await TR.get(`/devices/${id}/fields`); $('#fl').innerHTML = f.map((x) => `<option value="${esc(x.name)}">`).join(''); if (!$('#wfield').value && f[0]) $('#wfield').placeholder = f[0].name; } catch {} };
        $('#wt').onchange = sync; $('#wdev').onchange = loadFields; sync();
        $('[data-x]').onclick = close;
        $('[data-ok]').onclick = async (e) => {
          const type = $('#wt').value, t = TYPES[type]; const config = {};
          if (t.fields.includes('device')) config.deviceId = +$('#wdev').value;
          if (t.fields.includes('model')) config.modelId = +$('#wmodel').value;
          if (t.fields.includes('field')) { config.field = $('#wfield').value.trim(); if (!config.field) return ($('#werr').textContent = 'Enter the data field name'); }
          if (t.fields.includes('command')) { config.command = $('#wcmd').value.trim(); if (!config.command) return ($('#werr').textContent = 'Enter a command name'); }
          if (type === 'switch') { config.field = $('#wstate').value.trim(); config.onValue = $('#won').value; config.offValue = $('#woff').value; }
          if (t.fields.includes('unit')) config.unit = $('#wunit').value.trim();
          if (t.fields.includes('range')) { config.min = +$('#wmin').value; config.max = +$('#wmax').value; if (config.max <= config.min) return ($('#werr').textContent = 'Max must be greater than min'); }
          if (t.fields.includes('step')) config.step = +$('#wstep').value || 1;
          if (t.fields.includes('points')) config.points = +$('#wpts').value;
          if (t.fields.includes('outputKey')) config.outputKey = $('#wout').value.trim();
          await TR.busy(e.target, async () => { try { await TR.post(`/dashboards/${dashId}/widgets`, { type, title: $('#wtitle').value.trim() || (config.field || config.command || t.label), size: $('#wsize').value, config }); close(); done(); } catch (er) { $('#werr').textContent = er.message; } });
        };
      },
    });
  }

  return { TYPES, mount, addDialog };
})();
