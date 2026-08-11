import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { getBrokerQuotesForIsin, recordBrokerQuoteObservation } from '../src/sources/brokers/broker-quote-aggregator.js';

const TEST_DB_PATH = join(tmpdir(), `bond_tracker_broker_quote_test_${Date.now()}.db`);

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

describe('Broker & OBPP Quote Aggregator', () => {
  it('records a broker quote with clean/dirty price and YTM fields', () => {
    const id = recordBrokerQuoteObservation({
      isin: 'ine002a07809',
      broker_name: 'test_obpp',
      clean_price: 9850,
      dirty_price: 9925,
      accrued_interest: 75,
      minimum_lot: 10,
      quoted_ytm: 10.25,
      calculated_ytm: 10.12,
      source_url: 'https://example.test/quote',
      raw_payload: JSON.stringify({ fixture: true })
    });

    const quotes = getBrokerQuotesForIsin('INE002A07809');
    expect(id).toBeGreaterThan(0);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].clean_price).toBe(9850);
    expect(quotes[0].dirty_price).toBe(9925);
    expect(quotes[0].quoted_ytm).toBe(10.25);
    expect(quotes[0].calculated_ytm).toBe(10.12);
  });

  it('preserves separate observations for different quote timestamps', () => {
    recordBrokerQuoteObservation({ isin: 'INE002A07809', broker_name: 'test_obpp', clean_price: 9800, quoted_ytm: 10.5 });
    const quotes = getBrokerQuotesForIsin('INE002A07809');
    expect(quotes).toHaveLength(2);
    expect(quotes.some((quote) => quote.clean_price === 9800)).toBe(true);
  });

  it('rejects quotes without ISIN or broker name', () => {
    expect(() => recordBrokerQuoteObservation({ isin: '', broker_name: 'test' })).toThrow('isin is required');
    expect(() => recordBrokerQuoteObservation({ isin: 'INE002A07809', broker_name: '' })).toThrow('broker_name is required');
  });
});
