import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { closeDatabase, initDatabase } from '../src/db/index.js';
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

  it('runs syncNemoIsinData cleanly using existing release asset', async () => {
    const res = await syncNemoIsinData();
    expect(res.sync_status).toBe('ok');
    expect(res.ingested_rows).toBeGreaterThan(1000);
    expect(res.release_tag).toMatch(/^v2026/);
  });
});
