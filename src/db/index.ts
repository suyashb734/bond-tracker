import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from './runner.js';

let dbInstance: Database.Database | null = null;

export function getDatabasePath(): string {
  if (process.env.BOND_TRACKER_DB_PATH) {
    return resolve(process.env.BOND_TRACKER_DB_PATH);
  }
  return resolve(homedir(), '.bond-tracker', 'bond_tracker.db');
}

export function initDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = getDatabasePath();
  mkdirSync(dirname(dbPath), { recursive: true });

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  runMigrations(dbInstance);
  return dbInstance;
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
