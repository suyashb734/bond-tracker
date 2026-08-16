import { getDatabase, initDatabase } from '../src/db/index.js';
import { fetchCdslIsinContractualTerms } from '../src/sources/depositories/cdsl-detail-fetcher.js';
import { generateCatalogCashflows } from './generate-catalog-cashflows.js';

export async function enrichMissingBondTerms(batchSize = 20): Promise<{ enriched_count: number; total_cashflows: number }> {
  initDatabase();
  const db = getDatabase();

  const missingRows = db.prepare(`
    SELECT isin
    FROM bond_instruments
    WHERE security_type = 'CORPORATE_BOND'
      AND (coupon_rate IS NULL OR face_value IS NULL)
    LIMIT ?
  `).all(batchSize) as Array<{ isin: string }>;

  let enriched = 0;

  for (const row of missingRows) {
    try {
      const detail = await fetchCdslIsinContractualTerms(row.isin);
      if (detail && (detail.coupon_rate !== null || detail.face_value !== null)) {
        enriched += 1;
      }
    } catch (e) {
      // Ignore transient network errors
    }
  }

  // Re-run cashflow schedule generation
  const cfRes = generateCatalogCashflows();

  return { enriched_count: enriched, total_cashflows: cfRes.total_generated };
}
