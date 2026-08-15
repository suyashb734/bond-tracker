import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: execFileSyncMock }));

import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { extractNsdlAssetLinksFromNextJs, runOfficialNsdlPipeline } from '../src/sources/depositories/nsdl-official-pipeline.js';

describe('Official NSDL Multi-Asset Pipeline', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bond-tracker-nsdl-pipeline-test-'));
    process.env.BOND_TRACKER_DB_PATH = join(tempDir, 'test_bond_tracker.db');
    closeDatabase();
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('extracts NSDL asset links from Next.js stream HTML correctly with activeSecurities as securitised', () => {
    const mockHtml = `
      self.__next_f.push([1,"\\"debtInstrumentDataSet\\":[{\\"file_name\\":\\"Debt List\\",\\"field_file\\":\\"/nsdl/2026-08/Debt_Test.xls\\"}],\\"activeSecuritiesDataSet\\":[{\\"file_name\\":\\"Securitised List\\",\\"field_file\\":\\"/nsdl/2026-08/Securitised_Test.xlsx\\"}]"]);
    `;

    const links = extractNsdlAssetLinksFromNextJs(mockHtml);
    expect(links.length).toBe(2);
    expect(links[0].type).toBe('debt');
    expect(links[1].type).toBe('securitised');
    expect(links[1].url).toBe('https://nsdl.com/nsdl/2026-08/Securitised_Test.xlsx');
  });

  it('runs official pipeline, respects pre-existing manual curation, and ingests NSDL assets cleanly', async () => {
    const db = getDatabase();
    // Seed pre-existing manual curation row
    db.prepare(`
      INSERT INTO bond_instruments (isin, issuer_name, security_type, lifecycle_status, source_provider)
      VALUES ('INE001A07015', 'PRE_CURATED_NAME', 'CERTIFICATE_OF_DEPOSIT', 'DEFAULTED', 'manual_curation')
    `).run();

    const mockPageHtml = (`\n      self.__next_f.push([1,"\\"debtInstrumentDataSet\\":[{\\"file_name\\":\\"Debt List\\",\\"field_file\\":\\"/nsdl/2026-08/Debt_Test.xls\\"}]"]);\n    `).padEnd(600, ' ');

    const mockTsv = [
      'COMPANY\tISIN\tNAME_OF_THE_INSTRUMENT\tDESCRIPTION_IN_NSDL\tISSUE_PRICE\tFACE_VALUE\tDATE_OF_ALLOTMENT\tREDEMPTION_DATE',
      'HDFC BANK LIMITED\tINE001A07015\t8.05 NCD\t8.05 NCD 2030\t1000\t1000\t01 Jan 2020\t01 Jan 2030'
    ].join('\n');

    execFileSyncMock.mockImplementation((cmd: string, args?: any) => {
      const urlArg = args ? args[args.length - 1] : '';
      if (urlArg && urlArg.includes('detailed-list-debt-instruments')) {
        return mockPageHtml as any;
      }
      const outputIndex = args?.indexOf('-o') ?? -1;
      if (outputIndex >= 0 && args?.[outputIndex + 1]) {
        writeFileSync(args[outputIndex + 1], mockTsv);
      }
      return mockTsv as any;
    });

    const res = await runOfficialNsdlPipeline();
    expect(res.sync_status).toBe('ok');
    expect(res.debt_instruments_parsed).toBeGreaterThan(0);

    // Verify manual_curation security_type and DEFAULTED lifecycle status were preserved
    const checkRow = db.prepare('SELECT security_type, lifecycle_status FROM bond_instruments WHERE isin = ?').get('INE001A07015') as { security_type: string; lifecycle_status: string };
    expect(checkRow.security_type).toBe('CERTIFICATE_OF_DEPOSIT');
    expect(checkRow.lifecycle_status).toBe('DEFAULTED');
  });
});
