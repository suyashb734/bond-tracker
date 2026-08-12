import { getDatabase, initDatabase } from '../db/index.js';

export type CoverageMetrics = {
  total_instruments: number;
  instruments_with_face_value: number;
  instruments_with_maturity_date: number;
  instruments_with_allotment_date: number;
  instruments_with_coupon_rate: number;
  face_value_fill_rate_pct: number;
  maturity_fill_rate_pct: number;
  source_provider_distribution: Record<string, number>;
  total_source_observations: number;
  total_ncd_public_issues: number;
  total_unitized_cashflow_rows: number;
  total_broker_quotes: number;
  generated_at_utc: string;
};

export function generateNationalCoverageReport(): CoverageMetrics {
  initDatabase();
  const db = getDatabase();

  const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
  const faceVal = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments WHERE face_value IS NOT NULL AND face_value > 0').get() as { c: number }).c;
  const maturity = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments WHERE maturity_date IS NOT NULL').get() as { c: number }).c;
  const allotment = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments WHERE allotment_date IS NOT NULL').get() as { c: number }).c;
  const coupon = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments WHERE coupon_rate IS NOT NULL').get() as { c: number }).c;

  const obsCount = (db.prepare('SELECT COUNT(*) AS c FROM bond_source_observations').get() as { c: number }).c;
  const ncdCount = (db.prepare('SELECT COUNT(*) AS c FROM ncd_public_issues').get() as { c: number }).c;
  const cashflowCount = (db.prepare('SELECT COUNT(*) AS c FROM bond_unitized_cashflows').get() as { c: number }).c;
  const quoteCount = (db.prepare('SELECT COUNT(*) AS c FROM broker_quote_observations').get() as { c: number }).c;

  const providerRows = db.prepare('SELECT source_provider FROM bond_instruments').all() as Array<{ source_provider: string }>;
  const providerDist: Record<string, number> = {};

  for (const row of providerRows) {
    const providers = (row.source_provider || 'unknown').split(',');
    for (const p of providers) {
      const cleanP = p.trim();
      providerDist[cleanP] = (providerDist[cleanP] || 0) + 1;
    }
  }

  return {
    total_instruments: total,
    instruments_with_face_value: faceVal,
    instruments_with_maturity_date: maturity,
    instruments_with_allotment_date: allotment,
    instruments_with_coupon_rate: coupon,
    face_value_fill_rate_pct: total > 0 ? Math.round((faceVal / total) * 10000) / 100 : 0,
    maturity_fill_rate_pct: total > 0 ? Math.round((maturity / total) * 10000) / 100 : 0,
    source_provider_distribution: providerDist,
    total_source_observations: obsCount,
    total_ncd_public_issues: ncdCount,
    total_unitized_cashflow_rows: cashflowCount,
    total_broker_quotes: quoteCount,
    generated_at_utc: new Date().toISOString()
  };
}
