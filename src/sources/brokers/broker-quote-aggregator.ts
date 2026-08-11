import { getDatabase, initDatabase } from '../../db/index.js';

export type BrokerQuoteObservation = {
  isin: string;
  broker_name: string;
  clean_price?: number | null;
  dirty_price?: number | null;
  accrued_interest?: number | null;
  minimum_lot?: number | null;
  quoted_ytm?: number | null;
  calculated_ytm?: number | null;
  day_count_convention?: string | null;
  source_url?: string | null;
  raw_payload?: string | null;
};

export function recordBrokerQuoteObservation(quote: BrokerQuoteObservation): number {
  if (!quote.isin || typeof quote.isin !== 'string' || quote.isin.trim() === '') {
    throw new Error('[Broker Quote Error] isin is required and must be a non-empty string.');
  }
  if (!quote.broker_name || typeof quote.broker_name !== 'string' || quote.broker_name.trim() === '') {
    throw new Error('[Broker Quote Error] broker_name is required and must be a non-empty string.');
  }

  initDatabase();
  const db = getDatabase();

  const isinClean = quote.isin.trim().toUpperCase();
  const brokerClean = quote.broker_name.trim();

  // Auto-create stub in bond_instruments if ISIN is newly discovered
  const existingInst = db.prepare('SELECT isin FROM bond_instruments WHERE isin = ?').get(isinClean);
  if (!existingInst) {
    db.prepare(`
      INSERT INTO bond_instruments (isin, issuer_name, source_provider)
      VALUES (?, 'UNKNOWN_ISSUER_STUB', ?)
    `).run(isinClean, brokerClean);
  }

  const stmt = db.prepare(`
    INSERT INTO broker_quote_observations (
      isin, broker_name, clean_price, dirty_price, accrued_interest,
      minimum_lot, quoted_ytm, calculated_ytm, day_count_convention,
      source_url, raw_payload, quoted_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
    )
  `);

  const result = stmt.run(
    quote.isin.trim().toUpperCase(),
    quote.broker_name.trim(),
    quote.clean_price ?? null,
    quote.dirty_price ?? null,
    quote.accrued_interest ?? null,
    quote.minimum_lot ?? null,
    quote.quoted_ytm ?? null,
    quote.calculated_ytm ?? null,
    quote.day_count_convention ?? 'Actual/365',
    quote.source_url ?? null,
    quote.raw_payload ?? null
  );

  return Number(result.lastInsertRowid);
}

export function getBrokerQuotesForIsin(isin: string): Array<Record<string, unknown>> {
  initDatabase();
  const db = getDatabase();
  return db.prepare('SELECT * FROM broker_quote_observations WHERE isin = ? ORDER BY quoted_at DESC').all(isin.trim().toUpperCase()) as Array<Record<string, unknown>>;
}
