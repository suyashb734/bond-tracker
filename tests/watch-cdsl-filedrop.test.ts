import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, initDatabase } from '../src/db/index.js';
import { checkCdslFiledropSync } from '../scripts/watch-cdsl-filedrop.js';

describe('CDSL Master File Drop Watcher', () => {
  let tempDir: string;
  let dropDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bond-tracker-filedrop-test-'));
    dropDir = mkdtempSync(join(tmpdir(), 'bond-tracker-cdsl-drop-'));
    process.env.BOND_TRACKER_CDSL_DROP_DIR = dropDir;

    process.env.BOND_TRACKER_DB_PATH = join(tempDir, 'test_bond_tracker.db');
    closeDatabase();
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    delete process.env.BOND_TRACKER_CDSL_DROP_DIR;
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(dropDir, { recursive: true, force: true });
  });

  it('detects missing files gracefully', async () => {
    const result = await checkCdslFiledropSync();
    expect(result.sync_status).toBe('no_file_dropped');
    expect(result.source_scope).toBe('sample');
  });

  it('processes a full CDSL master file drop correctly', async () => {
    const testFile = join(dropDir, 'ISIN_MSTR_041400_000001_F_202608120000_999.csv');
    const udiffCsv = [
      'ISIN,IssrOrgNm,ISINDesc,FinInstrmTp,IsseDt,MtrtyDt,ParVal,RegarNm,SctySts',
      'INE001A07015,HDFC BANK LIMITED,8.05 NCD 2030,DEBT,2020-01-01,2030-01-01,1000,,ACTIVE',
      'INE002A07809,RELIANCE INDUSTRIES,7.90 BOND 2028,DEBT,2020-01-01,2028-05-15,100,,ACTIVE'
    ].join('\n');

    writeFileSync(testFile, udiffCsv, 'utf8');

    try {
      const result = await checkCdslFiledropSync();
      expect(result.sync_status).toBe('ok');
      expect(result.source_scope).toBe('full');
      expect(result.synced_count).toBe(2);
      expect(result.file_processed).toBe('ISIN_MSTR_041400_000001_F_202608120000_999.csv');
    } finally {
      rmSync(testFile, { force: true });
    }
  });
});
