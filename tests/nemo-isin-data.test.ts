import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { syncNemoIsinData } from '../scripts/sync-nemo-isin-data.js';

describe('Nemo ISIN Dataset Sync Adapter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bond-tracker-nemo-test-'));
    process.env.BOND_TRACKER_DB_PATH = join(tempDir, 'test_bond_tracker.db');
    closeDatabase();
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs syncNemoIsinData cleanly using strict fixed-income filtering', async () => {
    const res = await syncNemoIsinData();
    expect(res.sync_status).toBe('ok');
    expect(res.ingested_rows).toBeGreaterThan(1000);
    expect(res.release_tag).toMatch(/^v2026/);

    const db = getDatabase();
    // Verify famous equity ISINs are NOT in bond_instruments
    const relianceEquity = db.prepare("SELECT * FROM bond_instruments WHERE isin = 'INE002A01018'").get();
    expect(relianceEquity).toBeUndefined();

    // Verify all observations are logged under nemo_isin_github
    const obsCount = (db.prepare("SELECT COUNT(*) AS c FROM bond_source_observations WHERE source_provider = 'nemo_isin_github'").get() as { c: number }).c;
    expect(obsCount).toBe(res.ingested_rows);
  });
});
