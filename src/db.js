import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  creator TEXT,
  bonding_curve TEXT,
  name TEXT,
  symbol TEXT,
  slot INTEGER,
  signature TEXT,
  created_at INTEGER,
  dev_buy INTEGER NOT NULL DEFAULT 0,
  graduated_at INTEGER,
  mint_authority INTEGER,
  freeze_authority INTEGER,
  supply_raw TEXT,
  first_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  mint TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  real_sol_lamports TEXT,
  virtual_sol_lamports TEXT,
  virtual_token_raw TEXT,
  supply_raw TEXT,
  complete INTEGER,
  curve_missing INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mint, checkpoint)
);

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  funder TEXT,
  funded_at INTEGER,
  first_seen INTEGER
);

CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  funding_root TEXT,
  wallet_count INTEGER,
  supply_pct REAL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS investigations (
  mint TEXT PRIMARY KEY,
  opened_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  report_path TEXT,
  creator_prior_launches INTEGER,
  top10_pct REAL,
  cluster_pct REAL,
  cluster_wallets INTEGER
);

CREATE TABLE IF NOT EXISTS outcomes (
  mint TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  rug_class TEXT,
  labeled_at INTEGER NOT NULL,
  alive_48h INTEGER NOT NULL DEFAULT 0,
  cluster_unchecked INTEGER NOT NULL DEFAULT 0,
  peak_sol_lamports TEXT,
  last_sol_lamports TEXT
);

CREATE TABLE IF NOT EXISTS paper_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT,
  rule_id TEXT,
  signal_at INTEGER,
  hypothetical_entry_price TEXT,
  exit_rule TEXT,
  status TEXT
);

CREATE TABLE IF NOT EXISTS ingest_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_tokens_created ON tokens(created_at);
CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens(creator);
`;

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function openReadOnly(file) {
  return new DatabaseSync(file, { readOnly: true, timeout: 5000 });
}
