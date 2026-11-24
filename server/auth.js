'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { get, DATA_DIR } = require('./db');

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(DATA_DIR, '.jwt_secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
const checkPassword = (pw, hash) => bcrypt.compareSync(pw, hash);
const signToken = (user) => jwt.sign({ uid: user.id }, SECRET, { expiresIn: '7d' });

function verifyToken(token) {
  try {
    const { uid } = jwt.verify(token, SECRET);
    return get('SELECT id, name, email, created_at FROM users WHERE id = ?', uid) || null;
  } catch { return null; }
}

// Express middleware: requires "Authorization: Bearer <jwt>"
function requireUser(req, res, next) {
  const h = req.headers.authorization || '';
  const user = h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

const newDeviceToken = () => 'tr_' + crypto.randomBytes(18).toString('hex');

// very small in-memory rate limiter
function rateLimit({ windowMs, max, keyFn }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = keyFn(req); const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) return res.status(429).json({ error: 'Too many requests, slow down' });
    next();
  };
}

module.exports = { hashPassword, checkPassword, signToken, verifyToken, requireUser, newDeviceToken, rateLimit };
