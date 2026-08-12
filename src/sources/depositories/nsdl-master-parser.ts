import { recordSourceObservation } from '../../services/source-observations.js';
import { getDatabase, initDatabase } from '../../db/index.js';

export type NsdlMasterRow = {
  isin: string;
  company_name: string;
  security_type?: string | null;
  allotment_date?: string | null;
  maturity_date?: string | null;
  face_value?: number | null;
};

export function parseNsdlMasterText(content: string): NsdlMasterRow[] {
  const rows: NsdlMasterRow[] = [];
  if (!content || typeof content !== 'string') return rows;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    // Matches NSDL pipes, commas, or fixed-width lines containing valid Indian ISINs
    const isinMatch = clean.match(/\b(IN[A-Z0-9]{10})\b/i);
    if (!isinMatch) continue;

    const isin = isinMatch[1].toUpperCase();

    // Extract company/issuer name if available
    const parts = clean.split(/[,|\t]+/);
    const company = parts.length >= 2 ? parts[1].replace(/["']/g, '').trim() : 'NSDL ADMITTED ISSUER';

    if (company.length < 2) continue;

    rows.push({
      isin,
      company_name: company,
      security_type: 'DEBT',
      allotment_date: null,
      maturity_date: null,
      face_value: null
    });
  }

  return rows;
}

export function ingestNsdlMasterRows(rows: NsdlMasterRow[], rawPayload: string): number {
  if (rows.length === 0) return 0;

  initDatabase();
  const db = getDatabase();

  const upsertStmt = db.prepare(`
    INSERT INTO bond_instruments (
      isin, issuer_name, source_provider, updated_at
    ) VALUES (
      ?, ?, 'nsdl_master', CURRENT_TIMESTAMP
    ) ON CONFLICT(isin) DO UPDATE SET
      issuer_name = CASE
        WHEN bond_instruments.issuer_name = 'UNKNOWN_ISSUER_STUB' THEN excluded.issuer_name
        ELSE bond_instruments.issuer_name
      END,
      source_provider = CASE
        WHEN bond_instruments.source_provider NOT LIKE '%nsdl_master%'
        THEN bond_instruments.source_provider || ',nsdl_master'
        ELSE bond_instruments.source_provider
      END,
      updated_at = CURRENT_TIMESTAMP
  `);

  let ingested = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      upsertStmt.run(row.isin, row.company_name);

      recordSourceObservation({
        isin: row.isin,
        source_provider: 'nsdl_master',
        parser_version: 'nsdl-text-v1',
        raw_payload: JSON.stringify(row)
      });

      ingested += 1;
    }
  });

  tx();
  return ingested;
}
