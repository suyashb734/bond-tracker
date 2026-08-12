import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseNsdlMasterText, ingestNsdlMasterRows } from '../src/sources/depositories/nsdl-master-parser.js';
import { getObservationsForIsin } from '../src/services/source-observations.js';
import { closeDatabase, initDatabase } from '../src/db/index.js';

describe('NSDL Master Directory Parser', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bond-tracker-nsdl-test-'));
    process.env.BOND_TRACKER_DB_PATH = join(tempDir, 'test_bond_tracker.db');
    closeDatabase();
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('parses NSDL master lines and extracts valid ISINs', () => {
    const content = `INE001A07015|HOUSING DEVELOPMENT FINANCE CORPORATION LIMITED|DEBT\nINE002A07809|RELIANCE INDUSTRIES LIMITED|DEBT`;
    const rows = parseNsdlMasterText(content);

    expect(rows).toHaveLength(2);
    expect(rows[0].isin).toBe('INE001A07015');
    expect(rows[0].company_name).toBe('HOUSING DEVELOPMENT FINANCE CORPORATION LIMITED');
  });

  it('handles reverse column order and quoted commas correctly', () => {
    const content = `"TATA MOTORS, LIMITED",INE001A07015,DEBT`;
    const rows = parseNsdlMasterText(content);

    expect(rows).toHaveLength(1);
    expect(rows[0].isin).toBe('INE001A07015');
    expect(rows[0].company_name).toBe('TATA MOTORS, LIMITED');
  });

  it('correctly parses company names that contain NCD, BOND, or CP as substrings', () => {
    const content = `INE001A07015|NCDEX LIMITED|DEBT`;
    const rows = parseNsdlMasterText(content);

    expect(rows).toHaveLength(1);
    expect(rows[0].isin).toBe('INE001A07015');
    expect(rows[0].company_name).toBe('NCDEX LIMITED');
  });

  it('ingests NSDL rows into bond_instruments and logs source observations', () => {
    const content = `INE999Z07999|TEST NSDL ISSUER|DEBT`;
    const rows = parseNsdlMasterText(content);
    const ingested = ingestNsdlMasterRows(rows, content);

    expect(ingested).toBe(1);

    const obs = getObservationsForIsin('INE999Z07999');
    expect(obs.some((o) => o.source_provider === 'nsdl_master')).toBe(true);
  });
});
