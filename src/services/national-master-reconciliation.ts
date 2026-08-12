import { getDatabase, initDatabase } from '../db/index.js';

export type SourceOverlapReport = {
  total_unique_isins: number;
  provider_counts: Record<string, number>;
  exclusive_counts: Record<string, number>;
  multi_provider_isins: number;
  face_value_fill_rate_pct: number;
  maturity_date_fill_rate_pct: number;
  issuer_fill_rate_pct: number;
};

export function generateNationalMasterReconciliation(): SourceOverlapReport {
  initDatabase();
  const db = getDatabase();

  const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
  if (total === 0) {
    return {
      total_unique_isins: 0,
      provider_counts: {},
      exclusive_counts: {},
      multi_provider_isins: 0,
      face_value_fill_rate_pct: 0,
      maturity_date_fill_rate_pct: 0,
      issuer_fill_rate_pct: 0
    };
  }

  const rows = db.prepare('SELECT isin, issuer_name, face_value, maturity_date, source_provider FROM bond_instruments').all() as Array<{
    isin: string;
    issuer_name: string;
    face_value: number | null;
    maturity_date: string | null;
    source_provider: string;
  }>;

  const providerCounts: Record<string, number> = {};
  const exclusiveCounts: Record<string, number> = {};
  let multiProviderCount = 0;
  let faceValueCount = 0;
  let maturityCount = 0;
  let issuerCount = 0;

  for (const row of rows) {
    const providers = row.source_provider.split(',').map((p) => p.trim());
    if (providers.length > 1) {
      multiProviderCount++;
    } else if (providers.length === 1) {
      exclusiveCounts[providers[0]] = (exclusiveCounts[providers[0]] ?? 0) + 1;
    }

    for (const p of providers) {
      providerCounts[p] = (providerCounts[p] ?? 0) + 1;
    }

    if (row.face_value !== null && !isNaN(row.face_value) && row.face_value > 0) {
      faceValueCount++;
    }
    if (row.maturity_date && row.maturity_date.length >= 8) {
      maturityCount++;
    }
    if (row.issuer_name && row.issuer_name !== 'UNKNOWN_ISSUER_STUB') {
      issuerCount++;
    }
  }

  return {
    total_unique_isins: total,
    provider_counts: providerCounts,
    exclusive_counts: exclusiveCounts,
    multi_provider_isins: multiProviderCount,
    face_value_fill_rate_pct: Number(((faceValueCount / total) * 100).toFixed(2)),
    maturity_date_fill_rate_pct: Number(((maturityCount / total) * 100).toFixed(2)),
    issuer_fill_rate_pct: Number(((issuerCount / total) * 100).toFixed(2))
  };
}
