import { recordSourceObservation } from '../../services/source-observations.js';
import { getDatabase, initDatabase } from '../../db/index.js';

export type DepositoryMasterRow = {
  isin: string;
  issuer_name: string;
  security_description?: string | null;
  coupon_rate?: number | null;
  maturity_date?: string | null;
  face_value?: number | null;
  source_provider: 'cdsl_master' | 'nsdl_master';
};

export function parseDepositoryMasterCsv(csvContent: string, provider: 'cdsl_master' | 'nsdl_master'): DepositoryMasterRow[] {
  const rows: DepositoryMasterRow[] = [];
  if (!csvContent || typeof csvContent !== 'string') return rows;

  const lines = csvContent.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.startsWith('ISIN') || line.startsWith('#')) continue;

    const parts = line.split(',').map((p) => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 2) continue;

    const isin = parts[0].toUpperCase();
    if (!/^(INE|IN8|IN0)[A-Z0-9]{9}$/.test(isin)) continue;

    const issuer = parts[1];
    if (!issuer || issuer.length < 2) continue;

    const coupon = parts[2] && !isNaN(parseFloat(parts[2])) ? parseFloat(parts[2]) : null;
    const maturity = parts[3] && /^\d{4}-\d{2}-\d{2}$/.test(parts[3]) ? parts[3] : null;
    const faceValue = parts[4] && !isNaN(parseFloat(parts[4])) ? parseFloat(parts[4]) : null;

    rows.push({
      isin,
      issuer_name: issuer,
      coupon_rate: coupon,
      maturity_date: maturity,
      face_value: faceValue,
      source_provider: provider
    });
  }

  return rows;
}

export function ingestDepositoryMasterRows(rows: DepositoryMasterRow[], rawCsvPayload: string): number {
  if (rows.length === 0) return 0;

  initDatabase();
  const db = getDatabase();

  const upsertStmt = db.prepare(`
    INSERT INTO bond_instruments (
      isin, issuer_name, coupon_rate, maturity_date, face_value, source_provider, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
    ) ON CONFLICT(isin) DO UPDATE SET
      issuer_name = excluded.issuer_name,
      coupon_rate = COALESCE(excluded.coupon_rate, bond_instruments.coupon_rate),
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
        row.coupon_rate ?? null,
        row.maturity_date ?? null,
        row.face_value ?? null,
        row.source_provider
      );

      recordSourceObservation({
        isin: row.isin,
        source_provider: row.source_provider,
        parser_version: 'depository-csv-v1',
        raw_payload: rawCsvPayload
      });

      ingested += 1;
    }
  });

  transaction();
  return ingested;
}
