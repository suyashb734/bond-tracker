import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { createPayloadHash, getObservationsForIsin, recordSourceObservation } from '../src/services/source-observations.js';

const TEST_PROVIDER = `test_fixture_${Date.now()}`;
const TEST_DB_PATH = join(tmpdir(), `bond_tracker_source_observations_${Date.now()}.db`);

beforeAll(() => {
  process.env.BOND_TRACKER_DB_PATH = TEST_DB_PATH;
  initDatabase();
  getDatabase().prepare(`
    INSERT INTO bond_instruments (isin, issuer_name, source_provider)
    VALUES ('INE002A07809', 'TEST FIXTURE ISSUER', 'test_fixture')
  `).run();
});

afterAll(() => {
  closeDatabase();
  delete process.env.BOND_TRACKER_DB_PATH;
  for (const suffix of ['', '-shm', '-wal']) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
});

describe('Bond source observations', () => {
  it('hashes payloads deterministically and records one immutable observation', () => {
    const isin = 'INE002A07809';
    const payload = JSON.stringify({ isin, issuer: 'RELIANCE INDUSTRIES LIMITED', observed: 'fixture-v1' });
    const hash = createPayloadHash(payload);
    const id = recordSourceObservation({ isin, source_provider: TEST_PROVIDER, source_url: 'https://example.test/bond', http_status: 200, parser_version: 'test-1', raw_payload: payload });
    const observations = getObservationsForIsin(isin).filter((row) => row.source_provider === TEST_PROVIDER);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(id).toBeGreaterThan(0);
    expect(observations).toHaveLength(1);
    expect(observations[0].raw_payload_hash).toBe(hash);
  });

  it('deduplicates identical retries but preserves distinct failed observations', () => {
    const isin = 'INE002A07809';
    const payload = JSON.stringify({ isin, issuer: 'RELIANCE INDUSTRIES LIMITED', observed: 'fixture-v2' });
    const firstId = recordSourceObservation({ isin, source_provider: TEST_PROVIDER, http_status: 200, parser_version: 'test-1', raw_payload: payload });
    const retryId = recordSourceObservation({ isin, source_provider: TEST_PROVIDER, http_status: 200, parser_version: 'test-1', raw_payload: payload });
    const failedId = recordSourceObservation({ isin, source_provider: TEST_PROVIDER, http_status: 503, parser_version: 'test-1', raw_payload: `${payload}-failed` });
    const observations = getObservationsForIsin(isin).filter((row) => row.source_provider === TEST_PROVIDER);

    expect(retryId).toBe(firstId);
    expect(failedId).not.toBe(firstId);
    expect(observations.length).toBe(3);
    expect(observations.some((row) => row.http_status === 503)).toBe(true);
  });

  it('rejects observations without an ISIN or payload', () => {
    expect(() => recordSourceObservation({ isin: '', source_provider: 'test', parser_version: '1', raw_payload: '{}' })).toThrow('isin is required');
    expect(() => recordSourceObservation({ isin: 'INE002A07809', source_provider: 'test', parser_version: '1', raw_payload: '' })).toThrow('raw_payload is required');
  });
});
