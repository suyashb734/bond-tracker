import { recordSourceObservation } from '../../services/source-observations.js';
import { getDatabase, initDatabase } from '../../db/index.js';

export type NsdlMasterRow = {
  isin: string;
  company_name: string;
  security_type?: string | null;
  allotment_date?: string | null;
  maturity_date?: string | null;
  face_value?: number | null;
  raw_payload?: string;
};

export function parseNsdlMasterText(content: string): NsdlMasterRow[] {
  const rows: NsdlMasterRow[] = [];
  if (!content || typeof content !== 'string') return rows;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    // Split quote-aware parts
    const parts = parseQuoteAwareLine(clean);
    if (parts.length < 2) continue;

    // Find the part that is an exact 12-character Indian ISIN
    const isinPartIndex = parts.findIndex((p) => /^IN[A-Z0-9]{10}$/i.test(p.trim()));
    if (isinPartIndex === -1) continue;

    const isin = parts[isinPartIndex].trim().toUpperCase();

    // Extract company name from the non-ISIN parts
    const nonIsinParts = parts.filter(
      (_, idx) => idx !== isinPartIndex && !/^(DEBT|NCD|BOND|CP|EQTY|PREF)$/i.test(parts[idx].trim())
    );

    let company = nonIsinParts.length > 0 ? nonIsinParts[0].trim() : '';
    if (!company || company.length < 2) {
      company = clean.replace(isin, '').replace(/^[,|\t"'\s]+|[,|\t"'\s]+$/g, '').trim();
    }
    if (!company || company.length < 2) company = 'NSDL ADMITTED ISSUER';

    rows.push({
      isin,
      company_name: company,
      security_type: 'DEBT',
      allotment_date: null,
      maturity_date: null,
      face_value: null,
      raw_payload: clean
    });
  }

  return rows;
}

function parseQuoteAwareLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === '|' || char === '\t') && !inQuotes) {
      result.push(current.trim().replace(/^["']|["']$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^["']|["']$/g, ''));
  return result.filter((p) => p.length > 0);
}

export function ingestNsdlMasterRows(rows: NsdlMasterRow[], rawPayload: string, sourceUrl?: string): number {
  if (rows.length === 0) return 0;

  initDatabase();
  const db = getDatabase();

  const upsertStmt = db.prepare(`
    INSERT INTO bond_instruments (isin, issuer_name, source_provider, updated_at)
    VALUES (?, ?, 'nsdl_master', CURRENT_TIMESTAMP)
    ON CONFLICT(isin) DO UPDATE SET
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
        source_url: sourceUrl,
        parser_version: 'nsdl-text-v1',
        raw_payload: row.raw_payload ?? rawPayload
      });
      ingested += 1;
    }
  });

  tx();
  return ingested;
}
