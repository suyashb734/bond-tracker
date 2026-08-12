import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { generateNationalMasterReconciliation } from '../src/services/national-master-reconciliation.js';

describe('National Master Reconciliation & Source Overlap Engine', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bond-tracker-reconcile-test-'));
    process.env.BOND_TRACKER_DB_PATH = join(tempDir, 'test_bond_tracker.db');
    closeDatabase();
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates non-empty reconciliation metrics and identifies exclusive/multi-provider ISINs', () => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO bond_instruments (isin, issuer_name, face_value, maturity_date, source_provider)
      VALUES ('INE001A07015', 'HDFC LIMITED', 1000, '2030-01-01', 'nsdl_master,nse_cbm')
    `).run();
    db.prepare(`
      INSERT INTO bond_instruments (isin, issuer_name, face_value, maturity_date, source_provider)
      VALUES ('INE002A07809', 'RELIANCE INDUSTRIES', 100, '2028-05-15', 'nsdl_master')
    `).run();

    const report = generateNationalMasterReconciliation();

    expect(report.total_unique_isins).toBe(2);
    expect(report.multi_provider_isins).toBe(1);
    expect(report.exclusive_counts['nsdl_master']).toBe(1);
    expect(report.provider_counts['nsdl_master']).toBe(2);
    expect(report.provider_counts['nse_cbm']).toBe(1);
    expect(report.face_value_fill_rate_pct).toBe(100);
    expect(report.issuer_fill_rate_pct).toBe(100);
  });
});
