import { existsSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, getDatabasePath, initDatabase } from '../src/db/index.js';

const FORBIDDEN_DB_KEYS = [
  'ownerUserId',
  'user-14b72fb6',
  'access_token',
  'api_key',
  'request_token',
  'checksum',
  'password',
  'secret',
  'dp_id',
  'client_id'
];

function defaultPath(): string {
  return resolve(homedir(), '.bond-tracker', 'bond_tracker.db');
}

describe('Standalone Bond Tracker Database Path & Schema', () => {
  it('uses the isolated default database path', () => {
    delete process.env.BOND_TRACKER_DB_PATH;
    expect(getDatabasePath()).toBe(defaultPath());
  });

  it('uses BOND_TRACKER_DB_PATH override and applies the standalone schema', () => {
    const customPath = join(tmpdir(), `test_bond_tracker_${Date.now()}.db`);
    process.env.BOND_TRACKER_DB_PATH = customPath;

    expect(getDatabasePath()).toBe(customPath);
    const db = initDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain('bond_instruments');
    expect(names).toContain('bond_source_observations');
    expect(names).toContain('ncd_public_issues');
    expect(names).toContain('broker_quote_observations');

    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    if (existsSync(customPath)) unlinkSync(customPath);
    if (existsSync(`${customPath}-shm`)) unlinkSync(`${customPath}-shm`);
    if (existsSync(`${customPath}-wal`)) unlinkSync(`${customPath}-wal`);
  });

  it('scans imported public raw payloads for personal identifiers and credential keys', () => {
    delete process.env.BOND_TRACKER_DB_PATH;
    const db = initDatabase();
    const rows = db.prepare('SELECT raw_json FROM bond_instruments WHERE raw_json IS NOT NULL').iterate() as Iterable<{ raw_json: string }>;

    for (const row of rows) {
      for (const key of FORBIDDEN_DB_KEYS) {
        expect(row.raw_json).not.toMatch(new RegExp(`"${key}"\\s*:`, 'i'));
      }
      expect(row.raw_json).not.toMatch(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    }
    closeDatabase();
  });
});
