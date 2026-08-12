import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, initDatabase, getDatabase } from '../src/db/index.js';
import { ingestNseSecurityRows, parseNseSecurityCsv } from '../scripts/sync-nse-security-masters.js';

describe('NSE security master adapters', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bond-tracker-nse-test-'));
    process.env.BOND_TRACKER_DB_PATH = join(tempDir, 'test_bond_tracker.db');
    closeDatabase();
    initDatabase();
  });
  afterEach(() => {
    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses CBM data after the six-row report preamble and preserves the row', () => {
    const content = `,,,,NSE,,,,,,,,,,,,,,,,,,,,,,\n,,,,Report,,,,,,,,,,,,,,,,,,,,,,\nDetails report for :- 12-Aug-2026,,,,,,,,,,,,,,,,,,,,,,,\n,,,,,,,,,,,,,,,,,,,,,,,\n,,,,,,,,,,,,,,,,,,,,,,,\nSectype,Security,Issue Name,Issue Desc,Issuer,Face Value,Credit Rating,Issue Date,Maturity Date,ISIN,Status\nAT,AXBK32,7.88%,Axis Tier 2,UTI BANK LIMITED,100.00,,13-Dec-2022,13-Dec-2032,INE238A08484,Listed`;
    const rows = parseNseSecurityCsv(content, 'cbm');
    expect(rows).toHaveLength(1);
    expect(rows[0].isin).toBe('INE238A08484');
    expect(rows[0].issuer_name).toBe('UTI BANK LIMITED');
    expect(rows[0].maturity_date).toBe('2032-12-13');
    expect(rows[0].raw_payload.startsWith('AT,AXBK32')).toBe(true);
  });

  it('parses WDM data with an unknown issuer without fabricating one', () => {
    const content = `SECTYPE,SECURITY,ISSUE_NAME,ISSUE_DESC,ISSUE_DATE,MAT_DATE,Last IP Dt,Next IP Dt,Cpn Freq,Last Traded Date,Last Traded Price (in Rs.),ISIN NO.,STATUS\nGS,CG2036,8.33%,GOI LOAN 8.33% 2036,07-Jun-2006,07-Jun-2036,07-Jun-2026,07-Dec-2026,Half Yearly,12-Nov-2025,111.5522,IN0020060045,Listed`;
    const rows = parseNseSecurityCsv(content, 'wdm');
    expect(rows).toHaveLength(1);
    expect(rows[0].isin).toBe('IN0020060045');
    expect(rows[0].issuer_name).toBe('UNKNOWN_ISSUER_STUB');
    expect(rows[0].allotment_date).toBe('2006-06-07');
  });

  it('ingests rows with source URL and deduplicates an identical retry', () => {
    const content = `SECTYPE,SECURITY,ISSUE_NAME,ISSUE_DESC,ISSUE_DATE,MAT_DATE,ISIN NO.,STATUS\nGS,CG2036,8.33%,GOI LOAN 8.33% 2036,07-Jun-2006,07-Jun-2036,IN0020060045,Listed`;
    const rows = parseNseSecurityCsv(content, 'wdm');
    expect(ingestNseSecurityRows(rows, 'nse_wdm', 'https://example.test/wdm.csv')).toBe(1);
    expect(ingestNseSecurityRows(rows, 'nse_wdm', 'https://example.test/wdm.csv')).toBe(1);
    const db = getDatabase();
    expect(db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM bond_source_observations').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT source_url FROM bond_source_observations').get()).toEqual({ source_url: 'https://example.test/wdm.csv' });
  });
});
