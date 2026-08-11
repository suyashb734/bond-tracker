import { readFileSync } from 'node:fs';
import { initDatabase, getDatabase, closeDatabase } from './db/index.js';

type PublicBondExport = { rows: Array<Record<string, unknown>> };

export function importPublicBondExport(path: string): number {
  const payload = JSON.parse(readFileSync(path, 'utf8')) as PublicBondExport;
  initDatabase();
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO bond_instruments (
      isin, issuer_name, face_value, coupon_rate, payout_frequency,
      allotment_date, maturity_date, seniority, secured_unsecured,
      credit_rating_agency, cra_rating, debenture_trustee, day_count_convention,
      document_link, raw_json, source_provider, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(isin) DO UPDATE SET
      issuer_name = excluded.issuer_name,
      face_value = COALESCE(excluded.face_value, bond_instruments.face_value),
      coupon_rate = COALESCE(excluded.coupon_rate, bond_instruments.coupon_rate),
      payout_frequency = COALESCE(excluded.payout_frequency, bond_instruments.payout_frequency),
      allotment_date = COALESCE(excluded.allotment_date, bond_instruments.allotment_date),
      maturity_date = COALESCE(excluded.maturity_date, bond_instruments.maturity_date),
      seniority = COALESCE(excluded.seniority, bond_instruments.seniority),
      secured_unsecured = COALESCE(excluded.secured_unsecured, bond_instruments.secured_unsecured),
      credit_rating_agency = COALESCE(excluded.credit_rating_agency, bond_instruments.credit_rating_agency),
      cra_rating = COALESCE(excluded.cra_rating, bond_instruments.cra_rating),
      debenture_trustee = COALESCE(excluded.debenture_trustee, bond_instruments.debenture_trustee),
      day_count_convention = COALESCE(excluded.day_count_convention, bond_instruments.day_count_convention),
      document_link = COALESCE(excluded.document_link, bond_instruments.document_link),
      raw_json = COALESCE(excluded.raw_json, bond_instruments.raw_json),
      source_provider = excluded.source_provider,
      updated_at = CURRENT_TIMESTAMP
  `);

  const insert = db.transaction(() => {
    for (const row of payload.rows) {
      stmt.run(row.isin, row.issuer_name, row.face_value ?? null, row.interest_rate ?? null, row.payout_frequency ?? null, row.allotment_date ?? null, row.maturity_date ?? null, row.seniority ?? null, row.secured_unsecured ?? null, row.credit_rating_agency ?? null, row.cra_rating ?? null, row.debenture_trustee ?? null, row.day_count_convention ?? null, row.document_link ?? null, row.raw_json ?? null, row.source_provider ?? 'source_export');
    }
  });
  insert();
  return payload.rows.length;
}

if (process.argv[1]?.endsWith('import-public-export.js')) {
  const count = importPublicBondExport(process.argv[2]);
  console.log(`[Bond Tracker Import] Imported ${count} public bond records.`);
  closeDatabase();
}
