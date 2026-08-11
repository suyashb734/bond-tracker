import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { initDatabase, getDatabasePath, closeDatabase } from '../src/db/index.js';

describe('Standalone Bond Tracker Database Path & Schema', () => {
  it('uses BOND_TRACKER_DB_PATH override when set', () => {
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
  });
});
