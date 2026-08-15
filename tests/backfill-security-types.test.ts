import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { backfillSecurityTypes } from '../scripts/backfill-security-types.js';

describe('ISIN Position-Based Security Type Backfill', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bond-tracker-backfill-test-'));
    process.env.BOND_TRACKER_DB_PATH = join(tempDir, 'test_bond_tracker.db');
    closeDatabase();
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('classifies ISINs accurately based on 2-digit security type code position (SUBSTR isin, 8, 2)', () => {
    const db = getDatabase();

    db.prepare(`
      INSERT INTO bond_instruments (isin, issuer_name, source_provider)
      VALUES 
        ('INE001A07015', 'HDFC BOND', 'nsdl_master'),
        ('INE414A01012', 'EQUITY WITH 14 IN ISSUER CODE', 'nsdl_master'),
        ('INE123A14010', 'REAL CP ISIN', 'nsdl_master'),
        ('INE123A16010', 'REAL CD ISIN', 'nsdl_master'),
        ('INE123A15010', 'REAL PTC ISIN', 'nsdl_master'),
        ('IN0020200010', 'REAL G-SEC ISIN', 'nsdl_master')
    `).run();

    const res = backfillSecurityTypes();
    expect(res.total_updated).toBeGreaterThan(0);

    const get = (isin: string) =>
      (db.prepare('SELECT security_type FROM bond_instruments WHERE isin = ?').get(isin) as any)?.security_type;

    expect(get('INE001A07015')).toBe('CORPORATE_BOND');
    expect(get('INE414A01012')).toBeNull(); // Equity ISIN stays NULL (not mislabeled as CP)
    expect(get('INE123A14010')).toBe('COMMERCIAL_PAPER');
    expect(get('INE123A16010')).toBe('CERTIFICATE_OF_DEPOSIT');
    expect(get('INE123A15010')).toBe('SECURITISED_DEBT');
    expect(get('IN0020200010')).toBe('GOVERNMENT_SECURITY');
  });

  it('respects pre-existing manual_curation rows during backfill', () => {
    const db = getDatabase();

    db.prepare(`
      INSERT INTO bond_instruments (isin, issuer_name, security_type, source_provider)
      VALUES ('INE123A14010', 'CURATED_ISIN', 'CERTIFICATE_OF_DEPOSIT', 'manual_curation')
    `).run();

    backfillSecurityTypes();

    const row = db.prepare('SELECT security_type FROM bond_instruments WHERE isin = ?').get('INE123A14010') as any;
    expect(row.security_type).toBe('CERTIFICATE_OF_DEPOSIT'); // Preserved
  });
});
