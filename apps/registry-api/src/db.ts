// Uses Node.js built-in sqlite (available since Node v22.5, stable in v24)
// No native addon required — zero build step.
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(config.databaseUrl);
    migrate(_db);
  }
  return _db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      agent_address TEXT NOT NULL UNIQUE,
      principal_address TEXT NOT NULL,
      agent_uri TEXT NOT NULL,
      registered_at INTEGER NOT NULL,
      registered_epoch INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Active',
      tx_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_agents_principal ON agents(principal_address);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

    CREATE TABLE IF NOT EXISTS reputation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      reporter TEXT NOT NULL,
      delta INTEGER NOT NULL,
      epoch INTEGER NOT NULL DEFAULT 0,
      evidence_uri TEXT,
      tx_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_rep_events_agent ON reputation_events(agent_id);

    CREATE TABLE IF NOT EXISTS reputation_scores (
      agent_id TEXT PRIMARY KEY,
      score INTEGER NOT NULL DEFAULT 10,
      trust_tier TEXT NOT NULL DEFAULT 'Unverified',
      last_updated_epoch INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS mandates (
      mandate_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      principal_address TEXT NOT NULL,
      scope_hash TEXT NOT NULL,
      max_value INTEGER,
      total_budget INTEGER,
      spent INTEGER NOT NULL DEFAULT 0,
      valid_from INTEGER NOT NULL,
      valid_until INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      issued_epoch INTEGER NOT NULL DEFAULT 0,
      tx_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_mandates_agent ON mandates(agent_id);
    CREATE INDEX IF NOT EXISTS idx_mandates_principal ON mandates(principal_address);
    CREATE INDEX IF NOT EXISTS idx_mandates_scope ON mandates(scope_hash);

    CREATE TABLE IF NOT EXISTS handshakes (
      challenge_id TEXT PRIMARY KEY,
      agent_id_a TEXT NOT NULL,
      requested_scope_hash TEXT NOT NULL,
      nonce TEXT NOT NULL,
      agent_id_b TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      session_token TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}
