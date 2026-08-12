import { recordSourceObservation } from '../../services/source-observations.js';
import { getDatabase, initDatabase } from '../../db/index.js';

export type UdiffIsinMasterRow = {
  isin: string;
  issuer_name: string;
  security_description?: string | null;
  instrument_type?: string | null;
  allotment_date?: string | null;
  maturity_date?: string | null;
  face_value?: number | null;
  rta_name?: string | null;
  security_status?: string | null;
  source_provider: 'cdsl_udiff' | 'nsdl_udiff';
};

export function parseUdiffIsinCsv(csvContent: string, provider: 'cdsl_udiff' | 'nsdl_udiff'): UdiffIsinMasterRow[] {
  const rows: UdiffIsinMasterRow[] = [];
  if (!csvContent || typeof csvContent !== 'string') return rows;

  const lines = csvContent.split(/\r?\n/);
  if (lines.length < 2) return rows;

  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim());

  const isinIdx = headers.indexOf('ISIN');
  const issuerIdx = headers.indexOf('IssrOrgNm');
  const descIdx = headers.indexOf('ISINDesc');
  const typeIdx = headers.indexOf('FinInstrmTp');
  const issueDtIdx = headers.indexOf('IsseDt');
  const maturityDtIdx = headers.indexOf('MtrtyDt');
  const parValIdx = headers.indexOf('ParVal');
  const rtaIdx = headers.indexOf('RegarNm');
  const statusIdx = headers.indexOf('SctySts');

  if (isinIdx === -1 || issuerIdx === -1) {
    // Fallback: simple position-based parsing if headers differ
    return [];
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = parseCsvLine(line);
    const isin = parts[isinIdx]?.toUpperCase().trim();
    if (!isin || !/^IN[A-Z0-9]{10}$/.test(isin)) continue;

    const issuer = parts[issuerIdx]?.trim();
    if (!issuer || issuer.length < 2) continue;

    const instType = parts[typeIdx]?.trim().toUpperCase();
    const desc = (parts[descIdx] || '').toUpperCase();

    // Explicitly reject equity and preference share classifications
    if (instType === 'EQTY' || instType === 'PREF' || desc.includes('EQUITY SHARE') || desc.includes('PREFERENCE SHARE')) {
      continue;
    }

    // Keep debt, NCD, CP, debenture, and bond securities
    const hasDebtCode = Boolean(instType && /DEBT|NCD|BOND|DEB|CP/.test(instType));
    const hasDebtDesc = /\bNCD\b|DEBENTURE|\bBOND\b|NON[- ]CONVERTIBLE|COMMERCIAL PAPER/i.test(desc);

    const isDebtType = instType ? (hasDebtCode || hasDebtDesc) : hasDebtDesc;

    if (!isDebtType) continue;

    const issueDt = parts[issueDtIdx]?.trim();
    const maturityDt = parts[maturityDtIdx]?.trim();
    const parVal = parts[parValIdx] && !isNaN(parseFloat(parts[parValIdx])) ? parseFloat(parts[parValIdx]) : null;

    rows.push({
      isin,
      issuer_name: issuer,
      security_description: parts[descIdx]?.trim() || null,
      instrument_type: instType || null,
      allotment_date: /^\d{4}-\d{2}-\d{2}$/.test(issueDt) ? issueDt : null,
      maturity_date: /^\d{4}-\d{2}-\d{2}$/.test(maturityDt) ? maturityDt : null,
      face_value: parVal,
      rta_name: parts[rtaIdx]?.trim() || null,
      security_status: parts[statusIdx]?.trim() || null,
      source_provider: provider
    });
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^["']|["']$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^["']|["']$/g, ''));
  return result;
}

export function ingestUdiffIsinRows(rows: UdiffIsinMasterRow[], rawCsvContent: string): number {
  if (rows.length === 0) return 0;

  initDatabase();
  const db = getDatabase();

  const upsertStmt = db.prepare(`
    INSERT INTO bond_instruments (
      isin, issuer_name, allotment_date, maturity_date, face_value, source_provider, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
    ) ON CONFLICT(isin) DO UPDATE SET
      issuer_name = excluded.issuer_name,
      allotment_date = COALESCE(excluded.allotment_date, bond_instruments.allotment_date),
      maturity_date = COALESCE(excluded.maturity_date, bond_instruments.maturity_date),
      face_value = COALESCE(excluded.face_value, bond_instruments.face_value),
      source_provider = CASE
        WHEN bond_instruments.source_provider NOT LIKE '%' || excluded.source_provider || '%'
        THEN bond_instruments.source_provider || ',' || excluded.source_provider
        ELSE bond_instruments.source_provider
      END,
      updated_at = CURRENT_TIMESTAMP
  `);

  let ingested = 0;
  const transaction = db.transaction(() => {
    for (const row of rows) {
      upsertStmt.run(
        row.isin,
        row.issuer_name,
        row.allotment_date ?? null,
        row.maturity_date ?? null,
        row.face_value ?? null,
        row.source_provider
      );

      recordSourceObservation({
        isin: row.isin,
        source_provider: row.source_provider,
        parser_version: 'udiff-csv-v1',
        raw_payload: JSON.stringify(row)
      });

      ingested += 1;
    }
  });

  transaction();
  return ingested;
}
