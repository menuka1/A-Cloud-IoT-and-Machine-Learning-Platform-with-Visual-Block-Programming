'use strict';
/* My Kit: pick your board and the parts you own. Used as a full page (#/kit) and as a pop-up inside the Playground. */
const Kit = (() => {
  const E = TR.esc;
  const KIND = { analog: ['Reads a number', '📈'], digital_in: ['On / off sensor', '🔘'], digital_out: ['Switch', '🔌'], pwm_out: ['Dimmer', '🎚️'], rgb: ['Colour light', '🌈'], ultrasonic: ['Measures distance', '📏'], dht: ['Temperature + humidity', '🌡️'], motor_dir_pwm: ['Motor driver', '⚙️'], motor_dual_pwm: ['Motor driver', '⚙️'], joystick: ['Joystick', '🕹️'] };

  /** Renders the whole picker into `host`. opts: { kit, library, customKinds, onSave(kit) } */
  async function mount(host, opts) {
    const lib = opts.library; const st = { step: opts.kit.configured && opts.kit.boardId ? 2 : 1, boardId: opts.kit.boardId || '', parts: new Set(opts.kit.parts || []), q: '', cat: 'all', show: 'all', bq: '', customs: [] };
    const loadCustoms = async () => { st.customs = await TR.get('/custom-parts'); };
    await loadCustoms();
    const catById = new Map(lib.categories.map((c) => [c.id, c])); const byId = new Map(lib.parts.map((p) => [p.id, p]));

    function draw() {
      host.innerHTML = `<div class="kit">
        <ol class="steps2" aria-label="Steps">
          <li><button class="${st.step === 1 ? 'on' : ''}" data-step="1"><span>1</span> Your board</button></li>
          <li><button class="${st.step === 2 ? 'on' : ''}" data-step="2"><span>2</span> Your parts</button></li>
        </ol>
        ${st.step === 1 ? boardsHTML() : partsHTML()}
        <div class="kitbar"><div class="kitsum"><b>${st.boardId ? E(lib.boards.find((b) => b.id === st.boardId)?.name || '') : 'No board chosen yet'}</b> &middot; ${st.parts.size} part${st.parts.size === 1 ? '' : 's'} in your kit</div>
          <div class="row">${st.step === 2 ? '<button class="btn" data-step="1">&larr; Back</button>' : ''}${st.step === 1 ? '<button class="btn primary big" id="next" ' + (st.boardId ? '' : 'disabled') + '>Next: choose parts &rarr;</button>' : ''}<button class="btn ${st.step === 2 ? 'primary big' : ''}" id="save" ${st.boardId ? '' : 'disabled'}>Save my kit</button></div></div></div>`;
      host.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => { if (+b.dataset.step === 2 && !st.boardId) return TR.toast('Choose your board first', 'warn'); st.step = +b.dataset.step; draw(); }));
      const nx = host.querySelector('#next'); if (nx) nx.onclick = () => { st.step = 2; draw(); };
      host.querySelector('#save').onclick = (e) => TR.busy(e.target, async () => { try { const k = await TR.put('/kit', { boardId: st.boardId, parts: [...st.parts] }); TR.toast('Your kit is saved', 'ok'); opts.onSave(k); } catch (er) { TR.toast(er.message, 'err'); } });
      st.step === 1 ? wireBoards() : wireParts();
    }

    // ---------- step 1: boards ----------
    function boardsHTML() {
      const q = st.bq.trim().toLowerCase(); const fams = [...new Set(lib.boards.map((b) => b.family))];
      const list = lib.boards.filter((b) => !q || (b.name + ' ' + b.family).toLowerCase().includes(q));
      return `<h2 class="kt">Which board do you have?</h2><p class="muted">Tap your board. Boards marked <b>Ready</b> create working code today. Others are on the list and being added.</p>
        <input id="bq" class="bigsearch" type="search" placeholder="Search boards (e.g. ESP32, Pico, Raspberry Pi)" value="${E(st.bq)}" aria-label="Search boards">
        ${fams.map((f) => { const arr = list.filter((b) => b.family === f); return arr.length ? `<h3 class="fam">${E(f)}</h3><div class="cards">${arr.map((b) => `<button class="kcard board ${st.boardId === b.id ? 'sel' : ''} ${b.ready ? '' : 'soon'}" data-board="${b.id}" ${b.ready ? '' : 'aria-disabled="true"'} aria-pressed="${st.boardId === b.id}"><span class="kemo">${b.emoji}</span><b>${E(b.name)}</b><span class="tags">${b.ready ? '<i class="tag ok">Ready</i>' : '<i class="tag">Coming soon</i>'}${b.wifi ? '<i class="tag">Wi-Fi</i>' : '<i class="tag">No Wi-Fi</i>'}</span>${b.note ? `<small>${E(b.note)}</small>` : ''}${st.boardId === b.id ? '<span class="chk">&#10003;</span>' : ''}</button>`).join('')}</div>` : ''; }).join('') || '<div class="empty">No board matches your search.</div>'}`;
    }
    function wireBoards() {
      const bq = host.querySelector('#bq'); bq.oninput = () => { st.bq = bq.value; const pos = bq.selectionStart; draw(); const n = host.querySelector('#bq'); n.focus(); n.setSelectionRange(pos, pos); };
      host.querySelectorAll('[data-board]').forEach((c) => (c.onclick = () => { const b = lib.boards.find((x) => x.id === c.dataset.board); if (!b.ready) return TR.toast(`${b.name} is on the list but cannot make code yet. ${b.note}`, 'warn'); st.boardId = b.id; draw(); }));
    }

    // ---------- step 2: parts ----------
    function visibleParts() {
      const q = st.q.trim().toLowerCase(); let list = lib.parts.filter((p) => (st.cat === 'all' || p.cats.includes(st.cat)) && (st.show === 'all' || (st.show === 'ready' && (p.tier === 'ready' || p.tier === 'beta')) || (st.show === 'soon' && p.tier === 'soon')) && (!q || p.name.toLowerCase().includes(q) || p.cats.some((c) => catById.get(c).label.toLowerCase().includes(q))));
      if (st.show === 'mine') list = lib.parts.filter((p) => st.parts.has(p.id));
      return list;
    }
    function partsHTML() {
      const list = visibleParts(); const counts = (id) => lib.parts.filter((p) => p.cats.includes(id)).length;
      const filters = [['all', 'All'], ['ready', 'Ready to use'], ['soon', 'Coming soon'], ['mine', `My kit (${st.parts.size})`]];
      return `<h2 class="kt">Which sensors and parts do you have?</h2><p class="muted">Tap to add or remove. The Playground will show blocks only for your parts. You can come back and add more any time.</p>
        <input id="pq" class="bigsearch" type="search" placeholder="Search parts (e.g. DHT22, relay, soil, motor)" value="${E(st.q)}" aria-label="Search parts">
        <div class="seg" role="group" aria-label="Show">${filters.map(([k, l]) => `<button class="${st.show === k ? 'on' : ''}" data-show="${k}">${l}</button>`).join('')}</div>
        <div class="chips2" role="group" aria-label="Categories"><button class="${st.cat === 'all' ? 'on' : ''}" data-cat="all">All</button>${lib.categories.map((c) => `<button class="${st.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${c.emoji} ${E(c.label)} <i>${counts(c.id)}</i></button>`).join('')}</div>
        ${st.customs.length || st.cat === 'all' ? `<h3 class="fam">⭐ My own parts</h3><div class="cards">${st.customs.map((c) => { const id = 'cp_' + c.id; return `<button class="kcard part ${st.parts.has(id) ? 'sel' : ''}" data-part="${id}" aria-pressed="${st.parts.has(id)}"><span class="kemo">⭐</span><b>${E(c.name)}</b><span class="tags"><i class="tag ok">Ready</i><i class="tag">${E(opts.customKinds[c.kind] || c.kind)}</i></span>${st.parts.has(id) ? '<span class="chk">&#10003;</span>' : ''}<span class="del" data-delcustom="${c.id}" role="button" tabindex="0" title="Delete this part">&#128465;</span></button>`; }).join('')}<button class="kcard newpart" id="newpart"><span class="kemo">＋</span><b>Create my own part</b><small>Can't find it? Describe it once and it becomes a block.</small></button></div>` : ''}
        <h3 class="fam">${list.length} part${list.length === 1 ? '' : 's'}${st.cat !== 'all' ? ' in ' + E(catById.get(st.cat).label) : ''}</h3>
        <div class="cards">${list.map((p) => { const on = st.parts.has(p.id); const k = p.kind ? KIND[p.kind] : null; const c0 = catById.get(p.cats[0]); return `<button class="kcard part ${on ? 'sel' : ''} ${p.tier}" data-part="${p.id}" aria-pressed="${on}" title="${E(p.hint || '')}"><span class="kemo">${k ? k[1] : c0.emoji}</span><b>${E(p.name)}</b><span class="tags">${p.tier === 'ready' ? '<i class="tag ok">Ready</i>' : p.tier === 'beta' ? '<i class="tag beta" title="Works in our tests with simulated chips. Not yet checked on real hardware.">Beta</i>' : p.tier === 'info' ? '<i class="tag">Checklist only</i>' : '<i class="tag">Coming soon</i>'}${k ? `<i class="tag">${k[0]}</i>` : ''}</span>${on ? '<span class="chk">&#10003;</span>' : ''}</button>`; }).join('') || '<div class="empty">Nothing matches. Try another word, or choose "All".</div>'}</div>`;
    }
    function wireParts() {
      const pq = host.querySelector('#pq'); pq.oninput = () => { st.q = pq.value; const pos = pq.selectionStart; draw(); const n = host.querySelector('#pq'); n.focus(); n.setSelectionRange(pos, pos); };
      host.querySelectorAll('[data-show]').forEach((b) => (b.onclick = () => { st.show = b.dataset.show; draw(); }));
      host.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { st.cat = b.dataset.cat; draw(); }));
      host.querySelectorAll('[data-part]').forEach((b) => (b.onclick = (e) => { if (e.target.closest('[data-delcustom]')) return; const id = b.dataset.part; st.parts.has(id) ? st.parts.delete(id) : st.parts.add(id); const y = host.scrollTop; draw(); host.scrollTop = y; }));
      host.querySelectorAll('[data-delcustom]').forEach((d) => (d.onclick = async (e) => { e.stopPropagation(); if (!(await TR.confirmBox('Delete this part? Blocks using it will stop working.'))) return; await TR.del('/custom-parts/' + d.dataset.delcustom); st.parts.delete('cp_' + d.dataset.delcustom); await loadCustoms(); draw(); }));
      const np = host.querySelector('#newpart'); if (np) np.onclick = () => customDialog(async (c) => { await loadCustoms(); st.parts.add('cp_' + c.id); draw(); });
    }

    function customDialog(done) {
      const kinds = opts.customKinds;
      TR.modal(`<h3>Create my own part</h3><p class="muted small">Describe how your part connects. It becomes a block in the Playground.</p>
        <label>Name</label><input id="cn" maxlength="50" placeholder="e.g. My water-level probe">
        <label>What kind of part is it?</label><select id="ck">${Object.entries(kinds).map(([k, l]) => `<option value="${k}">${E(l)}</option>`).join('')}</select>
        <div id="cextra"></div>
        <label>Note for yourself (optional)</label><input id="cnote" maxlength="200" placeholder="Wiring tips, units...">
        <div class="err" id="cerr"></div><div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Create part</button></div>`, {
        onMount(el, close) {
          const q = (s) => el.querySelector(s);
          const extra = () => { const k = q('#ck').value; q('#cextra').innerHTML = k === 'analog' ? '<p class="small muted">The block gives a 0-100 % reading. To change it into your own unit: result = reading x <b>multiply</b> + <b>add</b>. (Leave 1 and 0 to keep the percent.)</p><div class="grid2"><div><label>Multiply by</label><input id="cm" type="number" step="any" value="1"></div><div><label>Then add</label><input id="ca" type="number" step="any" value="0"></div></div><label>Name of the result (variable)</label><input id="cv" value="value" maxlength="24">' : k === 'digital_in' ? '<div class="grid2"><div><label>It is "ON" when the pin is</label><select id="cact"><option value="high">HIGH</option><option value="low">LOW</option></select></div><div><label>Resistor</label><select id="cpull"><option value="none">none</option><option value="up">pull-up (button to GND)</option></select></div></div><label>Name of the result (variable)</label><input id="cv" value="state" maxlength="24">' : k === 'digital_out' ? '<label>It turns on when the pin is</label><select id="ctrig"><option value="high">HIGH</option><option value="low">LOW (many relay boards)</option></select>' : ''; };
          q('#ck').onchange = extra; extra(); q('[data-x]').onclick = close;
          q('[data-ok]').onclick = async (e) => TR.busy(e.target, async () => {
            const k = q('#ck').value; const params = { note: q('#cnote').value }; if (k === 'analog') { params.mult = q('#cm').value; params.add = q('#ca').value; } if (k === 'digital_in') { params.active = q('#cact').value; params.pull = q('#cpull').value; } if (k === 'digital_out') params.trigger = q('#ctrig').value;
            try { const c = await TR.post('/custom-parts', { name: q('#cn').value, kind: k, var: q('#cv')?.value || '', params }); close(); done(c); } catch (er) { q('#cerr').textContent = er.message; }
          });
        },
      });
    }
    draw();
  }

  function openPicker({ kit, library, customKinds, onDone }) {
    const m = TR.modal('<div id="kmodal" class="kmodal"></div>', { wide: true });
    m.el.classList.add('kitmodal'); const host = m.el.querySelector('#kmodal');
    const close = document.createElement('button'); close.className = 'btn sm kclose'; close.textContent = 'Close'; close.onclick = m.close; m.el.prepend(close);
    mount(host, { kit, library, customKinds, onSave: (k) => { m.close(); onDone(k); } });
  }
  return { mount, openPicker };
})();

V.kit = async (root) => {
  const [cat, kit] = await Promise.all([TR.get('/builder/catalog'), TR.get('/kit')]);
  root.innerHTML = `<div class="page"><div class="top"><div class="row"><button class="btn ghost menu-btn" data-menu>&#9776;</button><h1>My Kit</h1></div></div>
    <p class="lead2">Tell us what you have. We'll show only the blocks you can use in the Playground.</p><div id="kithost"></div></div>`;
  root.querySelector('[data-menu]').onclick = () => $('.side').classList.toggle('open');
  await Kit.mount(root.querySelector('#kithost'), { kit, library: cat.library, customKinds: cat.customKinds, onSave: () => { location.hash = '#/builder'; } });
};
