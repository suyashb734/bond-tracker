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
    if (!line || line.trim() === '') continue;
    const exactRawLine = line.replace(/\r?\n$/, '');
    const parts = parseQuoteAwareLine(exactRawLine);
    if (parts.length < 2) continue;

    const isinPartIndex = parts.findIndex((p) => /^IN[A-Z0-9]{10}$/i.test(p.trim()));
    if (isinPartIndex === -1) continue;

    const isin = parts[isinPartIndex].trim().toUpperCase();
    const nonIsinParts = parts.filter(
      (_, idx) => idx !== isinPartIndex && !/^(DEBT|NCD|BOND|CP|EQTY|PREF)$/i.test(parts[idx].trim())
    );

    let company = nonIsinParts.length > 0 ? nonIsinParts[0].trim() : '';
    if (!company || company.length < 2) {
      company = exactRawLine.replace(isin, '').replace(/^[,|\t"'\s]+|[,|\t"'\s]+$/g, '').trim();
    }
    if (!company || company.length < 2) company = 'NSDL ADMITTED ISSUER';

    // The official NSDL debt master places these fields at fixed positions
    // in its standard layout: face value index 5, maturity date index 7.
    // Leave them unknown for alternate layouts rather than guessing.
    const standardLayout = isinPartIndex === 1 && parts.length >= 8;
    const faceValue = standardLayout ? parseAmount(parts[5]) : null;
    const maturityDate = standardLayout ? normalizeNsdlDate(parts[7]) : null;

    rows.push({
      isin,
      company_name: company,
      security_type: 'DEBT',
      allotment_date: standardLayout ? normalizeNsdlDate(parts[6]) : null,
      maturity_date: maturityDate,
      face_value: faceValue,
      raw_payload: exactRawLine
    });
  }

  return rows;
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeNsdlDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim();
  const iso = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const named = clean.match(/^(\d{1,2})[ -\/]+([A-Za-z]+)[ -\/]+(\d{4})$/);
  if (!named) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.findIndex((m) => named[2].toLowerCase().startsWith(m));
  return month < 0 ? null : `${named[3]}-${String(month + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
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
    INSERT INTO bond_instruments (isin, issuer_name, face_value, maturity_date, source_provider, updated_at)
    VALUES (?, ?, ?, ?, 'nsdl_master', CURRENT_TIMESTAMP)
    ON CONFLICT(isin) DO UPDATE SET
      issuer_name = CASE
        WHEN bond_instruments.issuer_name = 'UNKNOWN_ISSUER_STUB' THEN excluded.issuer_name
        ELSE bond_instruments.issuer_name
      END,
      face_value = COALESCE(bond_instruments.face_value, excluded.face_value),
      maturity_date = COALESCE(bond_instruments.maturity_date, excluded.maturity_date),
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
      upsertStmt.run(row.isin, row.company_name, row.face_value ?? null, row.maturity_date ?? null);
      recordSourceObservation({
        isin: row.isin,
        source_provider: 'nsdl_master',
        source_url: sourceUrl,
        parser_version: 'nsdl-text-v2',
        raw_payload: row.raw_payload ?? rawPayload
      });
      ingested += 1;
    }
  });

  tx();
  return ingested;
}
