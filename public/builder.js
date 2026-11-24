'use strict';
/* Visual block builder: drag blocks -> live generated code for many boards & languages */
V.builder = async (root) => {
  let [cat, devices, projects, kit] = await Promise.all([TR.get('/builder/catalog'), TR.get('/devices'), TR.get('/projects'), TR.get('/kit')]);
  const kitBoard = () => cat.library.boards.find((x) => x.id === kit.boardId);
  const kitTargets = () => (kitBoard() && kitBoard().targets.length ? kitBoard().targets : Object.keys(cat.targets));
  const SIMPLE_HIDE = new Set(['calc', 'map_range', 'set_var', 'change_var', 'read_uptime', 'comment', 'log']);
  const LS = 'tronic_builder_settings';
  let saved = {}; try { saved = JSON.parse(TR.store.get(LS) || '{}'); } catch {}
  const S = { wifiSsid: saved.wifiSsid || '', wifiPass: saved.wifiPass || '', serverUrl: saved.serverUrl || location.origin };
  const st = { name: 'My project', target: saved.target || 'esp32-arduino', deviceId: devices[0] ? String(devices[0].id) : '', projectId: null, active: 'loop', flyout: 'My Parts', zoom: 1, simple: TR.store.get('tronic_simple') !== '0', tab: 'code', result: null, projects };
  let P = blank(); let timer = null, seq = 0, dragging = null;
  const uid = () => 'b' + Math.random().toString(36).slice(2, 9);
  const board = () => cat.boards[cat.targets[st.target].board];

  function blank() { return { interval: 5, setup: [], loop: [], handlers: [] }; }
  function withIds(blocks) { blocks.forEach((b) => { b.id = b.id || uid(); (cat.blocks[b.type]?.children || []).forEach((k) => withIds((b[k] = b[k] || []))); }); return blocks; }
  function loadProgram(p) { P = { interval: p.interval || 5, setup: withIds(p.setup || []), loop: withIds(p.loop || []), handlers: (p.handlers || []).map((h) => ({ id: h.id || uid(), name: h.name || '', body: withIds(h.body || []) })) }; }
  const resolvePins = (p) => JSON.parse(JSON.stringify(p, (k, v) => (typeof v === 'string' && v[0] === '@' ? board().defaults[v.slice(1)] ?? '' : v)));
  const excluded = () => kitBoard()?.excludePins || [];
  const pinOptions = (cap, f) => board().pins.filter((p) => p.caps.includes(cap) && !excluded().includes(p.id) && !(f?.pullup && p.noPullup));
  const usedPins = (skip) => { const s = new Set(); const rec = (arr) => arr.forEach((x) => { if (x !== skip) (cat.blocks[x.type]?.fields || []).forEach((f) => { if (f.kind === 'pin' && x[f.k] !== undefined && x[f.k] !== '') s.add(String(x[f.k])); }); (cat.blocks[x.type]?.children || []).forEach((k) => rec(x[k] || [])); }); rec(P.setup); rec(P.loop); P.handlers.forEach((h) => rec(h.body)); return s; };
  function pickPin(f, used) { // a sensible FREE pin: the board's default if free, otherwise the next unused one
    const opts = pinOptions(f.cap, f); const d = typeof f.default === 'string' && f.default[0] === '@' ? board().defaults[f.default.slice(1)] : f.default; const reserved = new Set(Object.values(board().i2c || {})); const unused = opts.filter((p) => !used.has(p.id)); const free = unused.filter((p) => !reserved.has(p.id)).length ? unused.filter((p) => !reserved.has(p.id)) : unused;
    return (free.find((p) => p.id === d) || free.find((p) => p.id !== 'LED') || free[0] || opts.find((p) => p.id === d) || opts[0])?.id ?? '';
  }
  function newBlock(type) {
    const def = cat.blocks[type]; const blk = { id: uid(), type }; const used = usedPins();
    def.fields.forEach((f) => { if (f.kind === 'pin') { blk[f.k] = pickPin(f, used); used.add(blk[f.k]); } else blk[f.k] = f.kind === 'pairs' ? JSON.parse(JSON.stringify(f.default)) : f.default; });
    (def.children || []).forEach((k) => (blk[k] = [])); return blk;
  }
  function fixPins() { // after a board change keep pins valid
    const fix = (blocks) => blocks.forEach((x) => { (cat.blocks[x.type]?.fields || []).forEach((f) => { if (f.kind === 'pin' && !pinOptions(f.cap, f).some((p) => p.id === String(x[f.k]))) x[f.k] = pickPin(f, usedPins(x)); }); (cat.blocks[x.type]?.children || []).forEach((k) => fix(x[k])); });
    fix(P.setup); fix(P.loop); P.handlers.forEach((h) => fix(h.body));
  }
  function ensureTarget() { if (!kitTargets().includes(st.target)) st.target = kitTargets()[0]; }
  // ---- tree helpers ----
  function arrByKey(key) {
    if (key === 'setup') return P.setup; if (key === 'loop') return P.loop; if (key.startsWith('h:')) return P.handlers.find((h) => h.id === key.slice(2))?.body;
    if (key.startsWith('c:')) { const [, id, k] = key.split(':'); return find(id)?.block[k]; }
  }
  function find(id, blocks = null) {
    const search = (arr) => { for (let i = 0; i < arr.length; i++) { if (arr[i].id === id) return { block: arr[i], arr, i }; for (const k of cat.blocks[arr[i].type]?.children || []) { const r = search(arr[i][k]); if (r) return r; } } };
    return search(P.setup) || search(P.loop) || P.handlers.map((h) => search(h.body)).find(Boolean);
  }
  const contains = (block, id) => block.id === id || (cat.blocks[block.type]?.children || []).some((k) => block[k].some((c) => contains(c, id)));
  const varNames = () => { const s = new Set(P.handlers.length ? ['cmd_value'] : []); const rec = (arr) => arr.forEach((b) => { ['var', 'tvar', 'hvar'].forEach((k) => { if (b[k]) s.add(b[k]); }); (cat.blocks[b.type]?.children || []).forEach((k) => rec(b[k])); }); rec(P.setup); rec(P.loop); P.handlers.forEach((h) => rec(h.body)); return [...s]; };

  // ---- rendering ----
  const E = TR.esc;
  function fieldHTML(b, f) {
    const v = b[f.k]; const lab = f.label ? `<span class="fl">${E(f.label)}</span>` : '';
    if (f.kind === 'pin') return `<label class="f">${lab}<select data-f="${f.k}">${pinOptions(f.cap, f).map((p) => `<option value="${E(p.id)}" ${String(v) === p.id ? 'selected' : ''}>${E(p.label)}</option>`).join('') || '<option value="">no pin available</option>'}</select></label>`;
    if (f.kind === 'select') return `<label class="f">${lab}<select data-f="${f.k}">${f.options.map(([o, l]) => `<option value="${E(o)}" ${String(v) === o ? 'selected' : ''}>${E(l)}</option>`).join('')}</select></label>`;
    if (f.kind === 'number') return `<label class="f">${lab}<input data-f="${f.k}" data-num type="number" step="any" value="${E(v)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}></label>`;
    if (f.kind === 'text') return `<label class="f">${lab}<input data-f="${f.k}" maxlength="60" value="${E(v)}"></label>`;
    if (f.kind === 'pairs') return `<div class="f pairs">${lab}${(v || []).map((r, i) => `<div class="pr"><input data-pk="${f.k}:${i}:k" placeholder="${E(f.keyLabel)}" maxlength="40" value="${E(r.k)}"><span>=</span><input data-pk="${f.k}:${i}:v" list="vars" placeholder="${E(f.valLabel)}" value="${E(r.v)}"><button class="bx" data-padd-rm="${f.k}:${i}" title="Remove row">&#10005;</button></div>`).join('')}<button class="btn sm ghost" data-padd="${f.k}">+ add row</button></div>`;
    return `<label class="f">${lab}<input data-f="${f.k}" list="vars" maxlength="24" value="${E(v)}" placeholder="${f.kind === 'var' ? 'name' : 'number or variable'}"></label>`; // var / operand
  }
  function blockHTML(b) {
    const def = cat.blocks[b.type]; const col = def.tint || cat.categories[def.cat];
    const kids = (def.children || []).map((k) => `<div class="zlab">${({ then: 'then', else: 'else', body: 'do' })[k]}</div>${zoneHTML(`c:${b.id}:${k}`, b[k])}`).join('');
    return `<div class="blk" data-id="${b.id}" style="--c:${col}"><div class="bh" draggable="true" title="${E(def.help || 'Drag to move')}"><span class="grip">&#8942;&#8942;</span><b>${E(def.label)}</b><button class="bx" data-del="${b.id}" title="Delete block">&#10005;</button></div><div class="bf">${def.fields.map((f) => `<span class="fw" ${f.showIf && !Object.entries(f.showIf).every(([k, vals]) => vals.includes(b[k])) ? 'hidden' : ''}>${fieldHTML(b, f)}</span>`).join('')}</div>${kids}<div class="berr"></div></div>`;
  }
  const zoneHTML = (key, arr) => `<div class="zone ${st.active === key ? 'active' : ''}" data-zone="${key}">${arr.length ? arr.map(blockHTML).join('') : '<div class="zempty">Drag blocks here</div>'}</div>`;

  function renderCanvas() {
    const sc = window.scrollY;
    $('#canvas', root).innerHTML = `
      <div class="sect" style="--hc:#16a34a"><div class="shead"><b>&#9654; When the board starts</b><span class="muted small">runs once</span></div>${zoneHTML('setup', P.setup)}</div>
      <div class="sect" style="--hc:#ea580c"><div class="shead"><b>&#10227; Repeat forever, every</b><input id="interval" type="number" min="1" max="3600" step="any" value="${E(P.interval)}" style="width:70px"><b>seconds</b></div>${zoneHTML('loop', P.loop)}</div>
      ${P.handlers.map((h) => `<div class="sect hsect" style="--hc:#7c3aed"><div class="shead"><b>&#9889; When dashboard sends command</b><input data-hname="${h.id}" value="${E(h.name)}" maxlength="40" placeholder="fan" style="width:120px"><span class="muted small">value is in <code>cmd_value</code></span><button class="bx" data-hdel="${h.id}" title="Delete handler">&#10005;</button></div>${zoneHTML('h:' + h.id, h.body)}</div>`).join('')}
      <button class="btn" id="addh">+ Add "when command received"</button>
      <datalist id="vars">${varNames().map((n) => `<option value="${E(n)}">`).join('')}</datalist>`;
    window.scrollTo(0, sc); wireCanvas(); paintErrors();
  }
  const railCats = () => { const hasKit = kit.parts.length > 0; return [...(hasKit || !kit.configured ? ['My Parts'] : ['My Parts']), ...Object.keys(cat.categories).filter((c) => c !== 'My Parts' && !(st.simple && c === 'Utility'))]; };
  function renderRail() {
    $('#rail', root).innerHTML = railCats().map((c) => `<button class="rcat ${st.flyout === c ? 'on' : ''}" data-cat="${E(c)}" style="--c:${cat.categories[c]}"><span class="rdot"></span>${E(c === 'My Parts' ? 'My Parts' : c)}</button>`).join('') + '<button class="rcat add" id="addparts"><span class="rdot plus">+</span>Add parts</button>';
    $$('.rcat[data-cat]', root).forEach((btn) => (btn.onclick = () => { st.flyout = st.flyout === btn.dataset.cat ? null : btn.dataset.cat; renderRail(); renderPalette(); }));
    $('#addparts', root).onclick = openKit;
  }
  function wirePalette() {
    $$('.pblock', root).forEach((el) => {
      el.ondragstart = (e) => { dragging = { kind: 'new', type: el.dataset.new }; e.dataTransfer.setData('text/plain', 'new'); e.dataTransfer.effectAllowed = 'copy'; };
      el.ondragend = () => { dragging = null; clearMarks(); };
      el.onclick = () => { if (el.classList.contains('off')) return TR.toast(el.title || 'Not available', 'warn'); const arr = arrByKey(st.active) || P.loop; arr.push(newBlock(el.dataset.new)); changed(true); };
    });
    const ap = $('[data-addparts]', root); if (ap) ap.onclick = openKit;
  }
  function renderPalette() {
    const fl = $('#palette', root); const c = st.flyout; fl.hidden = !c; if (!c) return;
    const supported = (type) => !cat.unsupported[st.target]?.[type];
    if (c === 'My Parts') {
      const byId = new Map(cat.library.parts.map((p) => [p.id, p])); const clab = new Map(cat.library.categories.map((x) => [x.id, x]));
      const items = kit.parts.map((id) => ({ id, type: id.startsWith('cp_') ? id : 'p_' + id, p: byId.get(id) }));
      const ready = items.filter((i) => cat.blocks[i.type]); const soon = items.filter((i) => !cat.blocks[i.type] && i.p && i.p.tier === 'soon');
      const groups = new Map(); ready.forEach((i) => { const key = i.id.startsWith('cp_') ? 'mine' : i.p.cats[0]; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); });
      let html = '';
      for (const [key, arr] of groups) { const lab = key === 'mine' ? { emoji: '⭐', label: 'My own parts' } : clab.get(key); html += `<div class="phead">${lab.emoji} ${E(lab.label)}</div>` + arr.map((i) => { const d = cat.blocks[i.type]; return `<div class="pblock ${supported(i.type) ? '' : 'off'}" draggable="true" data-new="${i.type}" style="--c:${d.tint}" title="${E(d.help || 'Drag into the workspace, or click to add')}">${E(d.label)}${d.beta ? ' <i class="bmark">beta</i>' : ''}</div>`; }).join(''); }
      if (!ready.length) html += `<div class="fempty"><b>${kit.configured ? 'No ready parts in your kit yet' : 'Start here'}</b><p>${kit.configured ? 'Add parts you own and they appear here as blocks.' : 'Tell us which board and parts you have, and this list fills up with the right blocks.'}</p></div>`;
      if (soon.length) html += `<div class="phead">⏳ In your kit - coming soon</div>` + soon.map((i) => `<div class="pblock off" style="--c:#94a3b8" title="Needs a library for this sensor - not available yet">${E(i.p.name)}</div>`).join('');
      fl.innerHTML = html + '<button class="btn sm primary fadd" data-addparts>+ Add or find parts</button>';
    } else {
      const col = cat.categories[c];
      fl.innerHTML = Object.entries(cat.blocks).filter(([t, d]) => d.cat === c && !(st.simple && SIMPLE_HIDE.has(t))).map(([t, d]) => `<div class="pblock ${supported(t) ? '' : 'off'}" draggable="${supported(t)}" data-new="${t}" style="--c:${col}" title="${E(supported(t) ? (d.help || 'Drag into the workspace, or click to add') : cat.unsupported[st.target][t])}">${E(d.label)}</div>`).join('') + '<p class="fhint">Drag a block into the workspace, or click it to add. Drop a block back here to delete it.</p>';
    }
    wirePalette();
  }
  function wireTrash() { // drop a block on the rail / flyout to delete it (like Blockly)
    [$('#rail', root), $('#palette', root)].forEach((t) => {
      t.ondragover = (e) => { if (dragging?.kind === 'move') { e.preventDefault(); t.classList.add('trash'); } };
      t.ondragleave = () => t.classList.remove('trash');
      t.ondrop = (e) => { t.classList.remove('trash'); if (dragging?.kind !== 'move') return; e.preventDefault(); const f = find(dragging.id); dragging = null; if (f) { f.arr.splice(f.i, 1); changed(true); } };
    });
  }
  const clearMarks = () => { $$('.zone.over', root).forEach((z) => z.classList.remove('over')); $$('.dropline', root).forEach((d) => d.remove()); };

  function wireCanvas() {
    const c = $('#canvas', root);
    $('#interval', c).oninput = (e) => { P.interval = parseFloat(e.target.value); changed(false); };
    $('#addh', c).onclick = () => { P.handlers.push({ id: uid(), name: P.handlers.length ? '' : 'fan', body: [] }); st.active = 'h:' + P.handlers[P.handlers.length - 1].id; changed(true); };
    $$('[data-hname]', c).forEach((i) => (i.oninput = () => { P.handlers.find((h) => h.id === i.dataset.hname).name = i.value.trim(); changed(false); }));
    $$('[data-hdel]', c).forEach((b) => (b.onclick = () => { P.handlers = P.handlers.filter((h) => h.id !== b.dataset.hdel); changed(true); }));
    $$('[data-del]', c).forEach((b) => (b.onclick = () => { const f = find(b.dataset.del); if (f) f.arr.splice(f.i, 1); changed(true); }));
    $$('.blk', c).forEach((el) => {
      const b = find(el.dataset.id)?.block; if (!b) return; const def = cat.blocks[b.type];
      $$(':scope > .bf [data-f]', el).forEach((inp) => { const f = def.fields.find((x) => x.k === inp.dataset.f); const upd = () => { b[inp.dataset.f] = inp.dataset.num !== undefined ? (inp.value === '' ? '' : parseFloat(inp.value)) : inp.value; changed(!!f?.rerender); }; inp.oninput = upd; inp.onchange = upd; });
      $$(':scope > .bf [data-pk]', el).forEach((inp) => (inp.oninput = () => { const [k, i, w] = inp.dataset.pk.split(':'); b[k][+i][w] = inp.value; changed(false); }));
      $$(':scope > .bf [data-padd]', el).forEach((bt) => (bt.onclick = () => { b[bt.dataset.padd].push({ k: '', v: '' }); changed(true); }));
      $$(':scope > .bf [data-padd-rm]', el).forEach((bt) => (bt.onclick = () => { const [k, i] = bt.dataset.paddRm.split(':'); if (b[k].length > 1) b[k].splice(+i, 1); changed(true); }));
      const h = $(':scope > .bh', el);
      h.ondragstart = (e) => { dragging = { kind: 'move', id: b.id }; e.dataTransfer.setData('text/plain', 'move'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(el, 12, 12); e.stopPropagation(); setTimeout(() => el.classList.add('ghost'), 0); };
      h.ondragend = () => { dragging = null; el.classList.remove('ghost'); clearMarks(); };
    });
    $$('.zone', c).forEach((z) => {
      z.onmousedown = (e) => { if (!e.target.closest('.blk') || e.target.closest('.zone') === z) { st.active = z.dataset.zone; $$('.zone.active', c).forEach((x) => x.classList.remove('active')); z.classList.add('active'); } };
      z.ondragover = (e) => {
        if (!dragging) return; if (dragging.kind === 'move') { const f = find(dragging.id); const key = z.dataset.zone; if (f && key.startsWith('c:') && contains(f.block, key.split(':')[1])) return; }
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = dragging.kind === 'new' ? 'copy' : 'move'; clearMarks(); z.classList.add('over');
        const idx = dropIndex(z, e.clientY); const kids = $$(':scope > .blk', z); const line = document.createElement('div'); line.className = 'dropline';
        if (idx >= kids.length) { z.querySelector('.zempty')?.remove(); z.append(line); } else z.insertBefore(line, kids[idx]);
      };
      z.ondragleave = (e) => { if (!z.contains(e.relatedTarget)) { z.classList.remove('over'); $$(':scope > .dropline', z).forEach((d) => d.remove()); } };
      z.ondrop = (e) => {
        if (!dragging) return; e.preventDefault(); e.stopPropagation(); const key = z.dataset.zone; let idx = dropIndex(z, e.clientY); const target = arrByKey(key); const d = dragging; dragging = null; clearMarks(); if (!target) return;
        if (d.kind === 'new') target.splice(idx, 0, newBlock(d.type));
        else { const f = find(d.id); if (!f || (key.startsWith('c:') && contains(f.block, key.split(':')[1]))) return; if (f.arr === target && f.i < idx) idx--; f.arr.splice(f.i, 1); target.splice(idx, 0, f.block); }
        st.active = key; changed(true);
      };
    });
  }
  function dropIndex(zone, y) { const kids = $$(':scope > .blk', zone); for (let i = 0; i < kids.length; i++) { const r = kids[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; } return kids.length; }

  // ---- validation + output ----
  function paintErrors() {
    $$('.blk.err', root).forEach((b) => { b.classList.remove('err'); $('.berr', b).textContent = ''; });
    $$('.berr', root).forEach((e) => (e.textContent = ''));
    (st.result?.errors || []).forEach((er) => { if (!er.id) return; const el = root.querySelector(`.blk[data-id="${er.id}"]`); if (el) { el.classList.add('err'); const be = $(':scope > .berr', el); be.textContent = (be.textContent ? be.textContent + ' ' : '') + er.msg; } });
  }
  function renderOutput() {
    const r = st.result; const o = $('#output', root);
    if (!P.setup.length && !P.loop.length && !P.handlers.some((h) => h.body.length)) { o.innerHTML = '<div class="cempty"><div class="ci">&#10515;</div><p>Your code will appear here.<br>Add some blocks to get started.</p></div>'; return; }
    if (!r) { o.innerHTML = '<div class="muted small">Checking...</div>'; return; }
    const msgs = [...(r.errors || []).map((e) => `<div class="msg bad" ${e.id ? `data-goto="${e.id}"` : ''}>&#10007; ${E(e.msg)}</div>`), ...(r.warnings || []).map((w) => `<div class="msg warn">&#9888; ${E(w.msg)}</div>`)].join('');
    if (!r.ok) { o.innerHTML = `<h3>Fix these to get your code</h3>${msgs}`; $$('[data-goto]', o).forEach((m) => (m.onclick = () => root.querySelector(`.blk[data-id="${m.dataset.goto}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))); return; }
    const f = r.files[0];
    o.innerHTML = `${msgs}<div class="row" style="justify-content:space-between"><span class="pill ok">&#10003; code ready - ${E(cat.targets[st.target].label)}</span><span class="row"><button class="btn sm" id="ocopy">Copy</button><button class="btn sm primary" id="odl">Download ${E(f.name)}</button></span></div>
      <div class="tabs"><button class="tab ${st.tab === 'code' ? 'active' : ''}" data-tab="code">Code</button><button class="tab ${st.tab === 'guide' ? 'active' : ''}" data-tab="guide">How to run it</button><button class="tab ${st.tab === 'wiring' ? 'active' : ''}" data-tab="wiring">Wiring</button></div>
      <div id="otab">${st.tab === 'code' ? `<pre class="code" style="max-height:520px">${E(f.content)}</pre>` : st.tab === 'guide' ? `<h4>You need</h4><ul>${r.requirements.map((x) => `<li>${E(x)}</li>`).join('')}</ul><h4>Steps</h4><ol>${r.steps.map((x) => `<li>${E(x)}</li>`).join('')}</ol>` : (r.wiring.length ? `<ul>${r.wiring.map((x) => `<li>${E(x)}</li>`).join('')}</ul><p class="small muted">Always double-check wiring against your exact module's datasheet before powering up.</p>` : '<p class="muted">No external parts needed for this program.</p>')}</div>`;
    $('#ocopy', o).onclick = () => TR.copy(f.content, 'Code copied');
    $('#odl', o).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([f.content], { type: 'text/plain' })); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
    $$('[data-tab]', o).forEach((t) => (t.onclick = () => { st.tab = t.dataset.tab; renderOutput(); }));
  }
  async function check() {
    const mine = ++seq;
    try { const r = await TR.post('/builder/generate', { target: st.target, name: st.name, deviceId: st.deviceId || undefined, boardId: kit.boardId || undefined, program: P, settings: S }); if (mine !== seq) return; st.result = r; } catch (e) { if (mine !== seq) return; st.result = { ok: false, errors: [{ id: null, msg: e.message }], warnings: [] }; }
    paintErrors(); renderOutput();
  }
  function changed(structural) { if (structural) { renderCanvas(); } else { $('#vars', root).innerHTML = varNames().map((n) => `<option value="${E(n)}">`).join(''); } st.dirty = true; clearTimeout(timer); timer = setTimeout(check, 350); }

  // ---- toolbar ----
  function drawShell() {
    const langs = { arduino: 'Arduino C++', micropython: 'MicroPython', python: 'Python', nodejs: 'Node.js' };
    root.innerHTML = `<div class="cb">
      <div class="cbar">
        <button class="btn ghost menu-btn" data-menu>&#9776;</button>
        <input id="pname" class="pname" maxlength="60" value="${E(st.name)}" title="Project name">
        <button class="btn sm kitbtn" id="kitbtn" title="Your board and parts">${kitBoard() ? E(kitBoard().emoji + ' ' + kitBoard().name) : '🧰 Choose my board'}</button>
        <select id="target" title="Programming language">${Object.entries(langs).map(([l, ln]) => { const opts = Object.entries(cat.targets).filter(([id, t]) => t.lang === l && kitTargets().includes(id)); return opts.length ? `<optgroup label="${ln}">${opts.map(([id, t]) => `<option value="${id}" ${st.target === id ? 'selected' : ''}>${E(kitBoard() ? ln : t.label)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select>
        <select id="dev" title="Device that receives the data"><option value="">Device: choose...</option>${devices.map((d) => `<option value="${d.id}" ${String(d.id) === st.deviceId ? 'selected' : ''}>${E(d.name)}</option>`).join('')}</select>
        <select id="tpl" title="Start from an example"><option value="">Examples</option>${cat.templates.map((t) => `<option value="${t.id}">${E(t.name)}</option>`).join('')}</select>
        <span class="grow"></span>
        <select id="plist" title="Open a saved project"><option value="">Open</option>${st.projects.map((p) => `<option value="${p.id}" ${st.projectId === p.id ? 'selected' : ''}>${E(p.name)}</option>`).join('')}</select>
        <button class="btn sm" id="save">Save</button><button class="btn sm" id="new">New</button><button class="btn sm danger" id="del" ${st.projectId ? '' : 'disabled'}>Delete</button><button class="btn sm" id="modebtn" title="Simple mode hides the advanced math blocks">${st.simple ? 'Simple blocks: on' : 'All blocks'}</button><button class="btn sm" id="settings" title="Wi-Fi & server address">&#9881; Settings</button>
        <span class="small muted" id="hint">${st.dirty ? 'unsaved' : ''}</span>
      </div>
      <div class="cbody">
        <nav class="rail" id="rail"></nav>
        <div class="flyout" id="palette" hidden></div>
        <section class="wsw"><div class="ws" id="canvas"></div><div class="zoom"><button data-z="1" title="Zoom in">+</button><button data-z="-1" title="Zoom out">&minus;</button><button data-z="0" title="Reset zoom">&#8982;</button></div></section>
        <aside class="cpanel"><div class="chead"><b>Code</b></div><div id="output"></div></aside>
      </div>
    </div>`;
    $('[data-menu]', root).onclick = () => $('.side').classList.toggle('open');
    $('#pname', root).oninput = (e) => { st.name = e.target.value; st.dirty = true; clearTimeout(timer); timer = setTimeout(check, 500); };
    $('#target', root).onchange = (e) => { st.target = e.target.value; persist(); fixPins(); renderRail(); renderPalette(); renderCanvas(); check(); };
    $('#dev', root).onchange = (e) => { st.deviceId = e.target.value; check(); };
    $('#tpl', root).onchange = async (e) => { const t = cat.templates.find((x) => x.id === e.target.value); e.target.value = ''; if (!t) return; if (P.loop.length + P.setup.length + P.handlers.length && !(await TR.confirmBox('Replace the current program with this template?', 'Replace'))) return; loadProgram(resolvePins(t.program)); if (st.name === 'My project') { st.name = t.name; $('#pname', root).value = t.name; } st.projectId = null; changed(true); };
    $('#plist', root).onchange = (e) => { const p = st.projects.find((x) => x.id === +e.target.value); if (!p) return; st.projectId = p.id; st.name = p.name; st.target = p.target; st.deviceId = p.device_id ? String(p.device_id) : st.deviceId; st.dirty = false; loadProgram(p.program); persist(); fullDraw(); };
    $('#new', root).onclick = async () => { if (st.dirty && !(await TR.confirmBox('Discard your unsaved changes and start a new project?', 'Discard'))) return; st.projectId = null; st.name = 'My project'; st.dirty = false; P = blank(); fullDraw(); };
    $('#save', root).onclick = async (e) => TR.busy(e.target, async () => {
      try { const body = { name: st.name, target: st.target, program: P, deviceId: st.deviceId || undefined }; const p = st.projectId ? await TR.put('/projects/' + st.projectId, body) : await TR.post('/projects', body); st.projectId = p.id; st.projects = await TR.get('/projects'); st.dirty = false; TR.toast('Project saved', 'ok'); fullDraw(); } catch (er) { TR.toast(er.message, 'err'); }
    });
    $('#del', root).onclick = async () => { if (!(await TR.confirmBox(`Delete project "${st.name}"?`))) return; await TR.del('/projects/' + st.projectId); st.projects = await TR.get('/projects'); st.projectId = null; P = blank(); fullDraw(); };
    $('#settings', root).onclick = settingsDialog;
    $('#kitbtn', root).onclick = openKit;
    $('#modebtn', root).onclick = () => { st.simple = !st.simple; TR.store.set('tronic_simple', st.simple ? '1' : '0'); $('#modebtn', root).textContent = st.simple ? 'Simple blocks: on' : 'All blocks'; renderRail(); renderPalette(); };
    $$('[data-z]', root).forEach((bt) => (bt.onclick = () => { st.zoom = bt.dataset.z === '0' ? 1 : Math.max(0.5, Math.min(1.5, st.zoom + (bt.dataset.z === '1' ? 0.1 : -0.1))); $('#canvas', root).style.setProperty('--z', st.zoom.toFixed(2)); }));
    $('#canvas', root).style.setProperty('--z', st.zoom.toFixed(2)); wireTrash();
  }
  const persist = () => TR.store.set(LS, JSON.stringify({ ...S, target: st.target }));
  function settingsDialog() {
    TR.modal(`<h3>Wi-Fi &amp; server settings</h3><p class="small muted">Used only to fill in your code. They stay in this browser and are not saved to your account.</p>
      <label>TronicIOT server address (what your board will connect to)</label><input id="s1" value="${E(S.serverUrl)}" placeholder="http://192.168.1.20:3000">
      ${['localhost', '127.0.0.1'].includes(location.hostname) ? '<p class="small" style="color:var(--warn)">You are on <code>localhost</code>: for Wi-Fi boards use this computer\'s LAN IP (run <code>ipconfig</code>), e.g. http://192.168.1.20:3000. Computer-based targets can keep localhost.</p>' : ''}
      <label>Wi-Fi name (ESP32 / ESP8266 / Pico W)</label><input id="s2" value="${E(S.wifiSsid)}" maxlength="32" autocomplete="off">
      <label>Wi-Fi password</label><input id="s3" type="password" value="${E(S.wifiPass)}" maxlength="63" autocomplete="off">
      <div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, { onMount(el, close) { $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = () => { S.serverUrl = $('#s1', el).value.trim(); S.wifiSsid = $('#s2', el).value; S.wifiPass = $('#s3', el).value; persist(); close(); check(); }; } });
  }
  function openKit() {
    Kit.openPicker({ kit, library: cat.library, customKinds: cat.customKinds, onDone: async (k) => { kit = k; cat = await TR.get('/builder/catalog'); ensureTarget(); persist(); fixPins(); fullDraw(); } });
  }
  function fullDraw() { drawShell(); renderRail(); renderPalette(); renderCanvas(); check(); }

  ensureTarget();
  loadProgram(resolvePins(cat.templates[0].program)); st.name = cat.templates[0].name; // start with a working example
  fullDraw();
  const onLeave = (e) => { if (st.dirty && location.hash === '#/builder') { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', onLeave);
  return () => { clearTimeout(timer); window.removeEventListener('beforeunload', onLeave); };
};
