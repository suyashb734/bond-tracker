import { createHash } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { ingestDepositoryMasterRows, parseDepositoryMasterCsv } from '../src/sources/depositories/depository-master-parser.js';
import { getObservationsForIsin } from '../src/services/source-observations.js';

const TEST_DB_PATH = join(tmpdir(), `bond_tracker_depository_test_${Date.now()}.db`);

beforeAll(() => {
  process.env.BOND_TRACKER_DB_PATH = TEST_DB_PATH;
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  delete process.env.BOND_TRACKER_DB_PATH;
  for (const suffix of ['', '-shm', '-wal']) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
});

describe('CDSL & NSDL Depository Master Parser & Ingestion', () => {
  it('parses depository CSV lines correctly', () => {
    const csv = `ISIN, Issuer Name, Coupon, Maturity, Face Value
INE002A07809, RELIANCE INDUSTRIES LIMITED, 8.75, 2028-06-15, 100000
INE101Q07BU7, MUTHOOT FINANCE LIMITED, 9.25, 2028-01-13, 10000
INVALID_ISIN, BAD DATA, abc, invalid_date, def`;

    const rows = parseDepositoryMasterCsv(csv, 'cdsl_master');
    expect(rows).toHaveLength(2);
    expect(rows[0].isin).toBe('INE002A07809');
    expect(rows[0].issuer_name).toBe('RELIANCE INDUSTRIES LIMITED');
    expect(rows[0].coupon_rate).toBe(8.75);
    expect(rows[1].isin).toBe('INE101Q07BU7');
    expect(rows[1].face_value).toBe(10000);
  });

  it('ingests depository rows into bond_instruments and logs source observations', () => {
    const csv = `INE002A07809, RELIANCE INDUSTRIES LIMITED, 8.75, 2028-06-15, 100000`;
    const rows = parseDepositoryMasterCsv(csv, 'nsdl_master');
    const ingested = ingestDepositoryMasterRows(rows, csv);

    expect(ingested).toBe(1);

    const db = getDatabase();
    const inst = db.prepare('SELECT * FROM bond_instruments WHERE isin = ?').get('INE002A07809') as any;
    expect(inst).toBeDefined();
    expect(inst.issuer_name).toBe('RELIANCE INDUSTRIES LIMITED');

    const obs = getObservationsForIsin('INE002A07809');
    expect(obs.some((o) => o.source_provider === 'nsdl_master')).toBe(true);
    expect(obs.some((o) => o.raw_payload_hash === createHash('sha256').update(csv).digest('hex'))).toBe(true);
  });
});
