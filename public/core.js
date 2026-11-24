'use strict';
/* TronicIOT frontend core: api client, live socket, helpers, toasts, modals */
const TR = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

  const S = { token: store.get('tronic_token'), user: null };

  async function api(method, path, body, raw) {
    const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (raw) return r;
    let j = null; try { j = await r.json(); } catch {}
    if (r.status === 401 && S.token && !path.startsWith('/auth/login')) { logout(true); throw new Error('Session expired - please sign in again'); }
    if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`);
    return j;
  }
  const get = (p) => api('GET', p), post = (p, b) => api('POST', p, b ?? {}), put = (p, b) => api('PUT', p, b), del = (p) => api('DELETE', p);

  // ---- event bus (cleared on every route change) ----
  let handlers = [];
  const bus = { on(type, fn) { const h = { type, fn }; handlers.push(h); return () => { handlers = handlers.filter((x) => x !== h); }; }, emit(ev) { handlers.slice().forEach((h) => { if (h.type === ev.type || h.type === '*') try { h.fn(ev); } catch (e) { console.error(e); } }); }, clear() { handlers = handlers.filter((h) => h.sticky); }, sticky(type, fn) { handlers.push({ type, fn, sticky: true }); } };

  // ---- live websocket ----
  let ws, wsTimer, wsDelay = 1000, wsLive = false;
  function connectWS() {
    if (!S.token || (ws && ws.readyState <= 1)) return;
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: S.token }));
    ws.onmessage = (m) => { let ev; try { ev = JSON.parse(m.data); } catch { return; } if (ev.type === 'ready') { wsLive = true; wsDelay = 1000; bus.emit({ type: 'ws', live: true }); } else bus.emit(ev); };
    ws.onclose = () => { wsLive = false; bus.emit({ type: 'ws', live: false }); if (S.token) { clearTimeout(wsTimer); wsTimer = setTimeout(connectWS, wsDelay); wsDelay = Math.min(wsDelay * 2, 15000); } };
    ws.onerror = () => {};
  }
  function logout(expired) { S.token = null; S.user = null; store.del('tronic_token'); try { ws && ws.close(); } catch {} bus.clear(); location.hash = '#/'; if (expired) toast('Session expired - please sign in again', 'warn'); render(); }
  function setSession(token, user) { S.token = token; S.user = user; store.set('tronic_token', token); connectWS(); }

  // ---- toast / modal ----
  function toast(msg, kind = '') { const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3500); }
  function modal(html, { wide = false, onMount } = {}) {
    const o = document.createElement('div'); o.className = 'overlay'; o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { o.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    o.addEventListener('mousedown', (e) => { if (e.target === o) close(); }); document.addEventListener('keydown', onKey);
    document.body.append(o); const m = $('.modal', o); onMount && onMount(m, close); const f = $('input,select,textarea', m); f && f.focus(); return { el: m, close };
  }
  function confirmBox(msg, okLabel = 'Delete') { return new Promise((res) => { const m = modal(`<h3>Are you sure?</h3><p>${esc(msg)}</p><div class="actions"><button class="btn" data-no>Cancel</button><button class="btn danger" data-yes>${esc(okLabel)}</button></div>`); $('[data-no]', m.el).onclick = () => { m.close(); res(false); }; $('[data-yes]', m.el).onclick = () => { m.close(); res(true); }; }); }
  async function busy(btn, fn) { const t = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait...'; try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; } }
  function copy(text, label = 'Copied') { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(label, 'ok'), () => { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); toast(label, 'ok'); } catch { toast('Copy failed - select and copy manually', 'err'); } t.remove(); }); }

  const ago = (ts) => { if (!ts) return 'never'; const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 5) return 'just now'; if (s < 60) return `${Math.floor(s)}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });
  const fmtVal = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(2))) : typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : String(v ?? '-'));
  const num = (v) => (typeof v === 'boolean' ? +v : typeof v === 'string' && v.trim() !== '' ? +v : v);
  const origin = () => location.origin;
  const mqttHost = () => location.hostname;

  // ---- display preferences (theme + text size) ----
  const prefs = {
    theme() { return store.get('tronic_theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); },
    size() { return Math.min(150, Math.max(90, +store.get('tronic_fs') || 100)); },
    apply() { document.documentElement.dataset.theme = prefs.theme(); document.documentElement.style.setProperty('--fs', prefs.size() + '%'); },
    toggleTheme() { store.set('tronic_theme', prefs.theme() === 'light' ? 'dark' : 'light'); prefs.apply(); },
    bump(d) { store.set('tronic_fs', String(Math.min(150, Math.max(90, prefs.size() + d)))); prefs.apply(); },
  };
  prefs.apply();

  return { prefs, $, $$, esc, store, S, api, get, post, put, del, bus, connectWS, logout, setSession, toast, modal, confirmBox, busy, copy, ago, fmtTime, fmtVal, num, origin, mqttHost, isLive: () => wsLive };
})();
