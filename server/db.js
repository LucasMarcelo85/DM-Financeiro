import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('PF','PJ')),
  name          TEXT NOT NULL,
  document      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'usuario' CHECK (role IN ('usuario','admin')),
  plan          TEXT NOT NULL DEFAULT 'bronze' CHECK (plan IN ('bronze','prata','ouro')),
  trial_ends_at INTEGER NOT NULL,
  access_until  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_nsu       TEXT NOT NULL UNIQUE,
  plan            TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  slug            TEXT,
  transaction_nsu TEXT,
  receipt_url     TEXT,
  created_at      INTEGER NOT NULL,
  paid_at         INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('cobranca','lembrete')),
  number        TEXT NOT NULL,
  has_extra     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('sent','partial','failed')),
  error         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instances_user ON instances(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
`);
