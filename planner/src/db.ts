import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export type DB = Database.Database;
export const stringify = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);
export function openDB(path = process.env.PLANNER_DB_PATH ?? 'data/processed/planner.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS planner_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chain_logs (
      tx TEXT NOT NULL, log_index INTEGER NOT NULL, block_number INTEGER NOT NULL,
      block_hash TEXT NOT NULL, timestamp INTEGER NOT NULL, event TEXT NOT NULL, args TEXT NOT NULL,
      PRIMARY KEY(tx, log_index));
    CREATE INDEX IF NOT EXISTS logs_block ON chain_logs(block_number);
    CREATE TABLE IF NOT EXISTS point_locations (
      deployment TEXT NOT NULL, point_id TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
      neighborhood_id TEXT, zone_id TEXT, PRIMARY KEY(deployment, point_id));
    CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evidence (
      snapshot TEXT NOT NULL REFERENCES snapshots(id), id TEXT NOT NULL, content TEXT NOT NULL,
      area_id TEXT, year INTEGER, period_from INTEGER, period_to INTEGER, sources TEXT NOT NULL,
      vector_id TEXT, PRIMARY KEY(snapshot,id));
    CREATE TABLE IF NOT EXISTS managers (username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES managers(username), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(token_hash));
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_calls (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, model TEXT NOT NULL,
      status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cost REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS tool_audit (id INTEGER PRIMARY KEY, conversation TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS request_limits (key TEXT NOT NULL, timestamp INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS limits_key ON request_limits(key,timestamp);
  `);
  // Unknown-cost interrupted provider requests remain charged at their reserved maximum.
  db.prepare("UPDATE ai_calls SET status='interrupted' WHERE status='reserved'").run();
  return db;
}
export function state<T>(db: DB, key: string): T | null {
  const row = db.prepare('SELECT value FROM planner_state WHERE key=?').get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}
export function setState(db: DB, key: string, value: unknown) {
  db.prepare('INSERT OR REPLACE INTO planner_state VALUES (?,?)').run(key, stringify(value));
}
