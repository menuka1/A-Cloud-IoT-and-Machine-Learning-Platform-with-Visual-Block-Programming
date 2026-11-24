'use strict';
/**
 * TronicIOT cloud ML engine - pure JS, no native deps.
 * Every algorithm: train(rows, cfg) -> { state, metrics }   predict(state, input) -> output
 * Models are plain JSON so they can be stored in the DB and exported to run on-device.
 */

// ---------- helpers ----------
function rng(seed = 42) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toNum = (v) => { if (isNum(v)) return v; if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) return +v; return NaN; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = (a, m = mean(a)) => Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length || 1)) || 1;
const round = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : x);

function shuffle(arr, seed = 7) { const r = rng(seed); const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function split(rows, frac = 0.8) { if (rows.length < 10) return { train: rows, test: rows }; const s = shuffle(rows); const n = Math.floor(s.length * frac); return { train: s.slice(0, n), test: s.slice(n) }; }

function scaler(rows, feats) {
  const mu = feats.map((f) => mean(rows.map((r) => r[f])));
  const sd = feats.map((f, i) => std(rows.map((r) => r[f]), mu[i]));
  return { mu, sd };
}
const vec = (row, feats, sc) => feats.map((f, i) => (row[f] - sc.mu[i]) / sc.sd[i]);

function solve(A, b) { // gaussian elimination w/ partial pivoting
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) M[c][c] = 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}

// ---------- data prep ----------
function parseCSV(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const cols = lines[0].split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((l) => {
    const cells = l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    const o = {}; cols.forEach((c, i) => { const n = toNum(cells[i]); o[c] = Number.isNaN(n) ? cells[i] : n; });
    return o;
  });
}

function cleanRows(rows, feats, target) {
  const need = target ? [...feats, target] : feats;
  const out = [];
  for (const r of rows) {
    const o = {}; let ok = true;
    for (const f of feats) { const v = toNum(r[f]); if (Number.isNaN(v)) { ok = false; break; } o[f] = v; }
    if (!ok) continue;
    if (target) { if (r[target] === undefined || r[target] === null || r[target] === '') continue; o[target] = r[target]; }
    out.push(o);
  }
  if (!out.length) throw new Error(`No usable rows: every row must contain ${need.join(', ')}`);
  return out;
}

function input(state, inp) {
  const row = {};
  for (const f of state.features) {
    const v = toNum(inp?.[f]);
    if (Number.isNaN(v)) throw new Error(`Missing or non-numeric input "${f}"`);
    row[f] = v;
  }
  return row;
}

// ---------- algorithms ----------
const ALGOS = {};

ALGOS.linear_regression = {
  label: 'Linear Regression', kind: 'supervised', needsTarget: true, targetNumeric: true,
  desc: 'Predict a number from other sensor values (e.g. estimate soil moisture from temperature + humidity).',
  train(rowsIn, cfg) {
    const { features, target } = cfg; const lambda = cfg.ridge ?? 1e-6;
    const fit = (rows) => {
      const sc = scaler(rows, features); const y = rows.map((r) => toNum(r[target]));
      const ym = mean(y); const d = features.length + 1;
      const A = Array.from({ length: d }, () => new Array(d).fill(0)); const b = new Array(d).fill(0);
      rows.forEach((r, i) => { const x = [1, ...vec(r, features, sc)]; for (let p = 0; p < d; p++) { b[p] += x[p] * (y[i] - ym); for (let q = 0; q < d; q++) A[p][q] += x[p] * x[q]; } });
      for (let p = 1; p < d; p++) A[p][p] += lambda * rows.length;
      const w = solve(A, b); return { features, target, scaler: sc, weights: w.slice(1), bias: w[0] + ym };
    };
    const rows = cleanRows(rowsIn, features, target).map((r) => ({ ...r, [target]: toNum(r[target]) })).filter((r) => !Number.isNaN(r[target]));
    if (rows.length < features.length + 2) throw new Error(`Need at least ${features.length + 2} rows to train`);
    const { train, test } = split(rows); const m = fit(train);
    const y = test.map((r) => r[target]); const yh = test.map((r) => ALGOS.linear_regression.predict(m, r).value);
    const ym = mean(y); const sse = y.reduce((s, v, i) => s + (v - yh[i]) ** 2, 0); const sst = y.reduce((s, v) => s + (v - ym) ** 2, 0) || 1;
    const final = fit(rows);
    return { state: final, metrics: { samples: rows.length, r2: round(1 - sse / sst), rmse: round(Math.sqrt(sse / y.length)), mae: round(y.reduce((s, v, i) => s + Math.abs(v - yh[i]), 0) / y.length) } };
  },
  predict(st, inp) { const r = input(st, inp); const x = vec(r, st.features, st.scaler); return { value: round(st.bias + x.reduce((s, v, i) => s + v * st.weights[i], 0)) }; },
};

ALGOS.logistic_regression = {
  label: 'Classifier (Logistic)', kind: 'supervised', needsTarget: true,
  desc: 'Classify readings into labels (e.g. "fan_on" / "fan_off", "healthy" / "faulty").',
  train(rowsIn, cfg) {
    const { features, target } = cfg;
    const rows = cleanRows(rowsIn, features, target).map((r) => ({ ...r, [target]: String(r[target]) }));
    const classes = [...new Set(rows.map((r) => r[target]))].sort();
    if (classes.length < 2) throw new Error('Need at least 2 different labels in the target column');
    if (classes.length > 20) throw new Error('Too many distinct labels - is the target a number? Use Linear Regression instead');
    const fit = (data) => {
      const sc = scaler(data, features); const X = data.map((r) => vec(r, features, sc)); const d = features.length;
      const epochs = cfg.epochs ?? 400; const lr = cfg.lr ?? 0.2;
      const W = classes.map((c) => { // one-vs-rest
        const w = new Array(d + 1).fill(0); const y = data.map((r) => (r[target] === c ? 1 : 0));
        for (let e = 0; e < epochs; e++) {
          const g = new Array(d + 1).fill(0);
          X.forEach((x, i) => { let z = w[d]; for (let k = 0; k < d; k++) z += w[k] * x[k]; const err = 1 / (1 + Math.exp(-z)) - y[i]; for (let k = 0; k < d; k++) g[k] += err * x[k]; g[d] += err; });
          for (let k = 0; k <= d; k++) w[k] -= lr * (g[k] / X.length + (k < d ? 1e-4 * w[k] : 0));
        }
        return w;
      });
      return { features, target, classes, scaler: sc, W };
    };
    const { train, test } = split(rows); const m = fit(train);
    const acc = test.filter((r) => ALGOS.logistic_regression.predict(m, r).label === r[target]).length / test.length;
    return { state: fit(rows), metrics: { samples: rows.length, classes: classes.length, accuracy: round(acc) } };
  },
  predict(st, inp) {
    const r = input(st, inp); const x = vec(r, st.features, st.scaler); const d = st.features.length;
    const p = st.W.map((w) => { let z = w[d]; for (let k = 0; k < d; k++) z += w[k] * x[k]; return 1 / (1 + Math.exp(-z)); });
    const s = p.reduce((a, b) => a + b, 0) || 1; const probs = {}; st.classes.forEach((c, i) => { probs[c] = round(p[i] / s); });
    let bi = 0; p.forEach((v, i) => { if (v > p[bi]) bi = i; });
    return { label: st.classes[bi], confidence: round(p[bi] / s), probabilities: probs };
  },
};

ALGOS.knn = {
  label: 'K-Nearest Neighbours', kind: 'supervised', needsTarget: true,
  desc: 'Predicts by looking at the most similar past readings. Works for labels or numbers, no training maths needed.',
  train(rowsIn, cfg) {
    const { features, target } = cfg; const k = Math.max(1, Math.min(50, cfg.k ?? 5));
    let rows = cleanRows(rowsIn, features, target);
    const regression = rows.every((r) => !Number.isNaN(toNum(r[target])));
    rows = rows.map((r) => ({ ...r, [target]: regression ? toNum(r[target]) : String(r[target]) }));
    if (rows.length < 3) throw new Error('Need at least 3 rows');
    if (rows.length > 3000) rows = shuffle(rows).slice(0, 3000);
    const sc = scaler(rows, features);
    const st = { features, target, k, regression, scaler: sc, X: rows.map((r) => vec(r, features, sc).map((v) => round(v, 5))), y: rows.map((r) => r[target]) };
    // leave-one-out estimate on a subset
    const probe = shuffle(rows.map((_, i) => i)).slice(0, Math.min(300, rows.length)); let good = 0, err = 0;
    for (const i of probe) { const o = ALGOS.knn.predict(st, rows[i], i); if (regression) err += Math.abs(o.value - st.y[i]); else if (o.label === st.y[i]) good++; }
    return { state: st, metrics: regression ? { samples: rows.length, mae: round(err / probe.length) } : { samples: rows.length, accuracy: round(good / probe.length) } };
  },
  predict(st, inp, skip = -1) {
    const r = input(st, inp); const x = vec(r, st.features, st.scaler);
    const d = st.X.map((p, i) => (i === skip ? [Infinity, i] : [p.reduce((s, v, j) => s + (v - x[j]) ** 2, 0), i])).sort((a, b) => a[0] - b[0]).slice(0, st.k);
    if (st.regression) return { value: round(mean(d.map(([, i]) => st.y[i]))) };
    const votes = {}; d.forEach(([, i]) => { votes[st.y[i]] = (votes[st.y[i]] || 0) + 1; });
    const label = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
    return { label, confidence: round(votes[label] / d.length) };
  },
};

ALGOS.kmeans = {
  label: 'K-Means Clustering', kind: 'unsupervised', needsTarget: false,
  desc: 'Finds natural groups/modes in your data without labels (e.g. "idle", "running", "overheating").',
  train(rowsIn, cfg) {
    const { features } = cfg; const k = Math.max(2, Math.min(12, cfg.k ?? 3));
    const rows = cleanRows(rowsIn, features); if (rows.length < k) throw new Error(`Need at least ${k} rows for ${k} clusters`);
    const sc = scaler(rows, features); const X = rows.map((r) => vec(r, features, sc)); const R = rng(11);
    const d2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
    let C = [X[Math.floor(R() * X.length)].slice()]; // k-means++
    while (C.length < k) { const ds = X.map((x) => Math.min(...C.map((c) => d2(x, c)))); const tot = ds.reduce((a, b) => a + b, 0) || 1; let t = R() * tot, i = 0; while (i < ds.length - 1 && (t -= ds[i]) > 0) i++; C.push(X[i].slice()); }
    let asg = new Array(X.length).fill(0);
    for (let it = 0; it < 100; it++) {
      let changed = false;
      X.forEach((x, i) => { let b = 0, bd = Infinity; C.forEach((c, j) => { const dd = d2(x, c); if (dd < bd) { bd = dd; b = j; } }); if (asg[i] !== b) { asg[i] = b; changed = true; } });
      C = C.map((c, j) => { const m = X.filter((_, i) => asg[i] === j); return m.length ? c.map((_, q) => mean(m.map((x) => x[q]))) : c; });
      if (!changed) break;
    }
    const inertia = X.reduce((s, x, i) => s + d2(x, C[asg[i]]), 0);
    const sizes = C.map((_, j) => asg.filter((a) => a === j).length);
    const centers = C.map((c) => Object.fromEntries(features.map((f, q) => [f, round(c[q] * sc.sd[q] + sc.mu[q])])));
    return { state: { features, k, scaler: sc, centroids: C, centers }, metrics: { samples: rows.length, inertia: round(inertia), sizes, centers } };
  },
  predict(st, inp) {
    const r = input(st, inp); const x = vec(r, st.features, st.scaler); let b = 0, bd = Infinity;
    st.centroids.forEach((c, j) => { const dd = Math.sqrt(c.reduce((s, v, i) => s + (v - x[i]) ** 2, 0)); if (dd < bd) { bd = dd; b = j; } });
    return { cluster: b, distance: round(bd), label: `cluster_${b}` };
  },
};

ALGOS.anomaly = {
  label: 'Anomaly Detection', kind: 'unsupervised', needsTarget: false,
  desc: 'Learns what "normal" looks like, then flags readings that deviate (motor vibration, power spikes, sensor faults).',
  train(rowsIn, cfg) {
    const { features } = cfg; const threshold = cfg.threshold ?? 3;
    const rows = cleanRows(rowsIn, features); if (rows.length < 5) throw new Error('Need at least 5 rows');
    const sc = scaler(rows, features); const st = { features, threshold, scaler: sc };
    const flagged = rows.filter((r) => ALGOS.anomaly.predict(st, r).anomaly).length;
    return { state: st, metrics: { samples: rows.length, threshold, trainingAnomalyRate: round(flagged / rows.length), means: Object.fromEntries(features.map((f, i) => [f, round(sc.mu[i])])), stddevs: Object.fromEntries(features.map((f, i) => [f, round(sc.sd[i])])) } };
  },
  predict(st, inp) {
    const r = input(st, inp); const x = vec(r, st.features, st.scaler); let worst = 0, wf = st.features[0];
    x.forEach((z, i) => { if (Math.abs(z) > worst) { worst = Math.abs(z); wf = st.features[i]; } });
    return { anomaly: worst > st.threshold, score: round(worst), worstFeature: wf };
  },
};

ALGOS.forecast = {
  label: 'Time-series Forecast', kind: 'timeseries', needsTarget: false, singleFeature: true,
  desc: 'Predicts the next values of one sensor from its history (Holt linear smoothing). Great for temperature, battery, tank level.',
  train(rowsIn, cfg) {
    const f = cfg.features[0]; const ts = rowsIn.map((r) => r.__ts).filter(Boolean);
    const y = rowsIn.map((r) => toNum(r[f])).filter((v) => !Number.isNaN(v));
    if (y.length < 6) throw new Error('Need at least 6 readings to forecast');
    const sse = (a, b) => { let l = y[0], t = y[1] - y[0], e = 0; for (let i = 1; i < y.length; i++) { const pr = l + t; e += (y[i] - pr) ** 2; const nl = a * y[i] + (1 - a) * (l + t); t = b * (nl - l) + (1 - b) * t; l = nl; } return { e, l, t }; };
    let best = { e: Infinity };
    for (let a = 0.1; a <= 0.95; a += 0.1) for (let b = 0.05; b <= 0.8; b += 0.15) { const r = sse(a, b); if (r.e < best.e) best = { ...r, a, b }; }
    let step = 1; if (ts.length > 2) { const dts = []; for (let i = 1; i < ts.length; i++) dts.push(ts[i] - ts[i - 1]); dts.sort((p, q) => p - q); step = dts[Math.floor(dts.length / 2)] || 1; }
    return { state: { features: [f], level: best.l, trend: best.t, alpha: best.a, beta: best.b, stepMs: step }, metrics: { samples: y.length, rmse: round(Math.sqrt(best.e / y.length)), alpha: round(best.a, 2), beta: round(best.b, 2) } };
  },
  predict(st, inp) { const n = Math.max(1, Math.min(100, Math.floor(toNum(inp?.steps) || 5))); const out = []; for (let i = 1; i <= n; i++) out.push(round(st.level + i * st.trend)); return { forecast: out, next: out[0], stepMs: st.stepMs }; },
};

// ---------- public API ----------
function listAlgorithms() { return Object.entries(ALGOS).map(([id, a]) => ({ id, label: a.label, kind: a.kind, needsTarget: !!a.needsTarget, singleFeature: !!a.singleFeature, desc: a.desc })); }

function validateConfig(algo, cfg) {
  const a = ALGOS[algo]; if (!a) throw new Error('Unknown algorithm');
  const features = Array.isArray(cfg.features) ? cfg.features.map(String).filter(Boolean) : [];
  if (!features.length) throw new Error('Pick at least one feature (input field)');
  if (features.length > 30) throw new Error('Too many features (max 30)');
  if (a.singleFeature && features.length !== 1) throw new Error('This algorithm uses exactly one field');
  if (a.needsTarget && !cfg.target) throw new Error('Pick a target field to predict');
  if (a.needsTarget && features.includes(cfg.target)) throw new Error('Target cannot also be a feature');
  const clean = { features };
  if (a.needsTarget) clean.target = String(cfg.target);
  for (const k of ['k', 'threshold', 'ridge', 'epochs', 'lr']) if (cfg[k] !== undefined && cfg[k] !== '' && isNum(+cfg[k])) clean[k] = +cfg[k];
  return clean;
}

function train(algo, cfg, rows) { const r = ALGOS[algo].train(rows, cfg); return { state: r.state, metrics: r.metrics }; }
function predict(algo, state, inp) { return ALGOS[algo].predict(state, inp); }

module.exports = { listAlgorithms, validateConfig, train, predict, parseCSV, toNum };
