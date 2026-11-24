'use strict';
/* App bootstrap: landing + register/login, app shell, router */
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0b1220" stroke="#22d3ee" stroke-opacity=".5"/><path d="M18 4 8 18h7l-1 10 10-14h-7z" fill="#22d3ee"/></svg>';
const app = document.getElementById('app');
let cleanup = null;
const setBadge = (n) => { unseen = n; const b = document.getElementById('abadge'); if (b) { b.textContent = n; b.hidden = !n; } };
let unseen = 0;

function render() { TR.S.token ? renderShell() : renderLanding(); }

// ---------------- Landing / auth ----------------
function renderLanding(mode = 'register') {
  cleanup && cleanup(); cleanup = null;
  app.innerHTML = `<div class="landing">
    <nav class="nav"><a class="logo" href="#/">${LOGO}<span>Tronic<b>IOT</b></span></a><div class="row"><button class="btn" data-mode="login">Sign in</button><button class="btn primary" data-mode="register">Get started free</button></div></nav>
    <section class="hero"><div>
      <span class="pill ok">IoT dashboards + cloud machine learning</span>
      <h1 style="margin-top:.8rem">Connect any board.<br><span class="grad">Build your IoT dashboard.</span><br>Run ML in the cloud.</h1>
      <p class="lead">TronicIOT is the platform for makers and teams: connect your ESP32, ESP8266, Arduino or Pico W in minutes, build live dashboards, control devices, and train &amp; run machine-learning models on our servers - <b>no Raspberry Pi or expensive hardware needed</b>.</p>
      <div class="row"><span class="pill">HTTP + MQTT</span><span class="pill">Live charts</span><span class="pill">Remote control</span><span class="pill">Anomaly detection</span><span class="pill">Forecasting</span></div></div>
    <div class="card authbox" id="authbox"></div></section>
    <section class="features">
      <div class="card feature"><div class="ic">&#129520;</div><h3>Pick your board and parts</h3><p class="muted">Choose from 46 boards and 400+ sensors and modules. The Playground then shows only the blocks you can use - no clutter.</p></div>
      <div class="card feature"><div class="ic">&#129513;</div><h3>Drag, drop, get code</h3><p class="muted">Snap blocks together and get ready-to-run code for Arduino C++, MicroPython, Python and Node.js. Made for ages 10 to 100.</p></div>
      <div class="card feature"><div class="ic">&#128202;</div><h3>Your own dashboard</h3><p class="muted">Widgets for everything: gauges, live charts, value cards, switches and sliders that control your hardware.</p></div>
      <div class="card feature"><div class="ic">&#129302;</div><h3>ML without the hardware bill</h3><p class="muted">Train regression, classifiers, clustering, anomaly detection and forecasts on your data. Your tiny board just calls our cloud.</p></div>
      <div class="card feature"><div class="ic">&#9889;</div><h3>Automations &amp; alerts</h3><p class="muted">If temperature &gt; 30 then switch the fan on. Instant alerts when ML spots an anomaly.</p></div>
    </section>
    <section><h2 style="text-align:center">From zero to live data in 4 steps</h2><div class="steps"><div class="card"><b>Create account</b><p class="muted small">Free, takes 20 seconds.</p></div><div class="card"><b>Add a device</b><p class="muted small">Get a token + code for your board.</p></div><div class="card"><b>See live data</b><p class="muted small">Build widgets on your dashboard.</p></div><div class="card"><b>Add intelligence</b><p class="muted small">Train a model, turn on Auto-run.</p></div></div></section>
    <footer class="foot">TronicIOT &copy; ${new Date().getFullYear()} - build, connect, learn.</footer></div>`;
  const box = document.getElementById('authbox');
  const showForm = (m) => {
    const reg = m === 'register';
    box.innerHTML = `<h2>${reg ? 'Create your account' : 'Welcome back'}</h2><p class="muted small">${reg ? 'Start building your IoT + ML project.' : 'Sign in to your dashboard.'}</p>
    <form id="af" novalidate>${reg ? '<label for="an">Your name</label><input id="an" autocomplete="name" maxlength="60" required>' : ''}
      <label for="ae">Email</label><input id="ae" type="email" autocomplete="email" maxlength="120" required>
      <label for="ap">Password</label><input id="ap" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" maxlength="128" required>
      ${reg ? '<div class="small muted" style="margin-top:.3rem">8+ characters with at least one letter and one number.</div>' : ''}
      <div class="err" id="aerr" role="alert"></div><button class="btn primary" style="width:100%;justify-content:center;margin-top:.6rem" type="submit">${reg ? 'Create account' : 'Sign in'}</button></form>
    <p class="small muted" style="text-align:center;margin-top:1rem">${reg ? 'Already have an account? <a href="#" id="sw">Sign in</a>' : 'New to TronicIOT? <a href="#" id="sw">Create an account</a>'}</p>`;
    document.getElementById('sw').onclick = (e) => { e.preventDefault(); showForm(reg ? 'login' : 'register'); };
    document.getElementById('af').onsubmit = async (e) => {
      e.preventDefault(); const err = document.getElementById('aerr'); err.textContent = ''; const btn = e.target.querySelector('button');
      const body = { email: document.getElementById('ae').value.trim(), password: document.getElementById('ap').value }; if (reg) body.name = document.getElementById('an').value.trim();
      if (!body.email || !body.password || (reg && !body.name)) return (err.textContent = 'Please fill in all fields');
      await TR.busy(btn, async () => { try { const r = await TR.api('POST', reg ? '/auth/register' : '/auth/login', body); TR.setSession(r.token, r.user); location.hash = reg ? '#/kit' : '#/dashboard'; render(); } catch (er) { err.textContent = er.message; } });
    };
  };
  showForm(mode);
  app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { showForm(b.dataset.mode); box.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.querySelector('#authbox input').focus(); }));
}

// ---------------- App shell + router ----------------
const ROUTES = [
  [/^#\/dashboard$/, () => V.dashboard, 'dashboard'], [/^#\/devices$/, () => V.devices, 'devices'], [/^#\/devices\/(\d+)$/, () => V.device, 'devices'],
  [/^#\/kit$/, () => V.kit, 'kit'], [/^#\/builder$/, () => V.builder, 'builder'], [/^#\/ml$/, () => V.ml, 'ml'], [/^#\/automation$/, () => V.automation, 'automation'], [/^#\/docs$/, () => V.docs, 'docs'], [/^#\/account$/, () => V.account, 'account'],
];
const NAV = [['dashboard', 'My Dashboard', '🏠'], ['kit', 'My Kit', '🧰'], ['builder', 'Playground', '🧩'], ['devices', 'My Boards', '📡'], ['ml', 'Smart Models (AI)', '🧠'], ['automation', 'Rules & Alerts', '⚡'], ['docs', 'Help', '📖'], ['account', 'Account', '👤']];

async function renderShell() {
  if (!TR.S.user) { try { TR.S.user = (await TR.get('/auth/me')).user; TR.connectWS(); } catch { return TR.logout(); } }
  if (!document.getElementById('main')) {
    app.innerHTML = `<div class="shell"><aside class="side"><a class="logo" href="#/dashboard">${LOGO}<span>Tronic<b>IOT</b></span></a>
      ${NAV.map(([k, l, i]) => `<a class="nav-item" data-nav="${k}" href="#/${k}"><span class="ni">${i}</span>${l}${k === 'automation' ? '<span class="badge" id="abadge" hidden>0</span>' : ''}</a>`).join('')}
      <div class="bottom"><div class="prefs"><button id="fsdown" aria-label="Smaller text" title="Smaller text">A&minus;</button><button id="fsup" aria-label="Larger text" title="Larger text">A+</button><button id="thm" aria-label="Switch between light and dark" title="Light / dark">🌓</button></div><div class="small muted" style="padding:.2rem .6rem">${TR.esc(TR.S.user.name)}</div><a class="nav-item" href="#" id="logout"><span>&#10162;</span>Sign out</a></div></aside><main class="main" id="main"></main></div>`;
    document.getElementById('fsdown').onclick = () => TR.prefs.bump(-10); document.getElementById('fsup').onclick = () => TR.prefs.bump(10); document.getElementById('thm').onclick = () => TR.prefs.toggleTheme();
    document.getElementById('logout').onclick = (e) => { e.preventDefault(); TR.logout(); };
    app.querySelector('.side').addEventListener('click', (e) => { if (e.target.closest('a.nav-item')) app.querySelector('.side').classList.remove('open'); });
    TR.get('/overview').then((o) => setBadge(o.unseenAlerts)).catch(() => {});
  }
  route();
}

async function route() {
  if (!TR.S.token) return render();
  const main = document.getElementById('main'); if (!main) return renderShell();
  cleanup && cleanup(); cleanup = null; TR.bus.clear();
  const h = location.hash || '#/dashboard'; let hit = null;
  for (const [re, get, nav] of ROUTES) { const m = h.match(re); if (m) { hit = { fn: get(), nav, args: m.slice(1) }; break; } }
  if (!hit) { location.hash = '#/dashboard'; return; }
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === hit.nav));
  const mine = (route.n = (route.n || 0) + 1); main.innerHTML = '<div class="muted">Loading...</div>'; window.scrollTo(0, 0);
  try { const c = await hit.fn(main, ...hit.args); if (mine === route.n) cleanup = c; else c && c(); }
  catch (e) { if (mine === route.n) main.innerHTML = `<div class="card"><h3>Something went wrong</h3><p class="err">${TR.esc(e.message)}</p><button class="btn" onclick="route()">Retry</button></div>`; }
}

window.addEventListener('hashchange', () => { if (TR.S.token) route(); });
TR.bus.sticky('alert', () => { if (location.hash !== '#/automation') setBadge(unseen + 1); });
if (TR.S.token && (!location.hash || location.hash === '#/')) location.hash = '#/dashboard';
render();
