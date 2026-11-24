'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'tronic.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  board TEXT NOT NULL DEFAULT 'esp32',
  description TEXT DEFAULT '',
  token TEXT NOT NULL UNIQUE,
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_dev_ts ON readings(device_id, ts);

CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmd_dev ON commands(device_id, status);

CREATE TABLE IF NOT EXISTS dashboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS widgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  size TEXT NOT NULL DEFAULT 'm',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ml_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  state TEXT,
  metrics TEXT,
  status TEXT NOT NULL DEFAULT 'untrained',
  auto_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  trained_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL REFERENCES ml_models(id) ON DELETE CASCADE,
  device_id INTEGER,
  ts INTEGER NOT NULL,
  input TEXT NOT NULL,
  output TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pred_model_ts ON predictions(model_id, ts);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target TEXT NOT NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  program TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kits (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  board_id TEXT NOT NULL DEFAULT '',
  parts TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  var TEXT NOT NULL DEFAULT '',
  params TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  op TEXT NOT NULL,
  threshold REAL NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  cmd_name TEXT NOT NULL DEFAULT '',
  cmd_value TEXT NOT NULL DEFAULT '',
  last_fired INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id INTEGER,
  level TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  ts INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, ts);
`);

// tiny helpers (node:sqlite returns null-prototype rows; normalise them)
const plain = (r) => (r ? { ...r } : undefined);
const get = (sql, ...p) => plain(db.prepare(sql).get(...p));
const all = (sql, ...p) => db.prepare(sql).all(...p).map(plain);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const tx = (fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

module.exports = { db, get, all, run, tx, DATA_DIR };
