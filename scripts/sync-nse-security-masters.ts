import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { recordSourceObservation } from '../src/services/source-observations.js';

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://www.nseindia.com/all-reports-debt'
};

const CBM_API = 'https://www.nseindia.com/api/daily-reports?key=CBM';
const WDM_API = 'https://www.nseindia.com/api/daily-reports?key=WDM';

type NseReport = { fileKey: string; fileActlName: string; filePath: string; tradingDate?: string };
type NseMasterRow = {
  isin: string;
  issuer_name: string;
  allotment_date: string | null;
  maturity_date: string | null;
  face_value: number | null;
  raw_payload: string;
};

export function parseNseSecurityCsv(content: string, source: 'cbm' | 'wdm'): NseMasterRow[] {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /(^|,)ISIN( NO\.)?\s*(,|$)/i.test(line) || /(^|,)ISIN\s*,/i.test(line));
  if (headerIndex < 0) return [];

  const headers = parseCsvLine(lines[headerIndex]).map((x) => x.trim().toUpperCase());
  const isinIndex = headers.findIndex((x) => x === 'ISIN' || x === 'ISIN NO.');
  const issuerIndex = headers.indexOf('ISSUER');
  const issueDateIndex = headers.findIndex((x) => x === 'ISSUE DATE' || x === 'ISSUE_DATE');
  const maturityIndex = headers.findIndex((x) => x === 'MATURITY DATE' || x === 'MAT_DATE');
  const faceValueIndex = headers.findIndex((x) => x === 'FACE VALUE');
  if (isinIndex < 0) return [];

  const rows: NseMasterRow[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || raw.trim() === '') continue;
    const parts = parseCsvLine(raw);
    const isin = parts[isinIndex]?.trim().toUpperCase();
    if (!isin || !/^IN[A-Z0-9]{10}$/.test(isin)) continue;

    const face = faceValueIndex >= 0 ? Number(parts[faceValueIndex]?.replace(/,/g, '')) : NaN;
    rows.push({
      isin,
      issuer_name: issuerIndex >= 0 && parts[issuerIndex]?.trim() ? parts[issuerIndex].trim() : 'UNKNOWN_ISSUER_STUB',
      allotment_date: normalizeNseDate(issueDateIndex >= 0 ? parts[issueDateIndex] : undefined),
      maturity_date: normalizeNseDate(maturityIndex >= 0 ? parts[maturityIndex] : undefined),
      face_value: Number.isFinite(face) ? face : null,
      raw_payload: raw
    });
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      result.push(current.trim()); current = '';
    } else current += ch;
  }
  result.push(current.trim());
  return result;
}

function normalizeNseDate(value?: string): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const months: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  const month = months[m[2].toUpperCase()];
  return month ? `${m[3]}-${month}-${m[1].padStart(2, '0')}` : null;
}

export function ingestNseSecurityRows(rows: NseMasterRow[], sourceProvider: 'nse_cbm' | 'nse_wdm', sourceUrl: string): number {
  if (!rows.length) return 0;
  initDatabase();
  const db = getDatabase();
  const upsert = db.prepare(`
    INSERT INTO bond_instruments (isin, issuer_name, allotment_date, maturity_date, face_value, source_provider, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(isin) DO UPDATE SET
      issuer_name = CASE WHEN bond_instruments.issuer_name = 'UNKNOWN_ISSUER_STUB' THEN excluded.issuer_name ELSE bond_instruments.issuer_name END,
      allotment_date = COALESCE(excluded.allotment_date, bond_instruments.allotment_date),
      maturity_date = COALESCE(excluded.maturity_date, bond_instruments.maturity_date),
      face_value = COALESCE(excluded.face_value, bond_instruments.face_value),
      source_provider = CASE WHEN bond_instruments.source_provider NOT LIKE '%' || excluded.source_provider || '%' THEN bond_instruments.source_provider || ',' || excluded.source_provider ELSE bond_instruments.source_provider END,
      updated_at = CURRENT_TIMESTAMP
  `);
  let count = 0;
  db.transaction(() => {
    for (const row of rows) {
      upsert.run(row.isin, row.issuer_name, row.allotment_date, row.maturity_date, row.face_value, sourceProvider);
      recordSourceObservation({ isin: row.isin, source_provider: sourceProvider, source_url: sourceUrl, parser_version: 'nse-security-csv-v1', raw_payload: row.raw_payload });
      count++;
    }
  })();
  return count;
}

async function latestReport(apiUrl: string, fileKey: string): Promise<NseReport> {
  const response = await fetch(apiUrl, { headers: NSE_HEADERS });
  if (!response.ok) throw new Error(`NSE report API HTTP ${response.status}`);
  const payload = await response.json() as Record<string, NseReport[]>;
  const report = [...(payload.CurrentDay ?? []), ...(payload.PreviousDay ?? [])].find((x) => x.fileKey === fileKey);
  if (!report) throw new Error(`NSE report ${fileKey} unavailable`);
  return report;
}

async function downloadReport(apiUrl: string, key: string): Promise<{ report: NseReport; url: string; content: string }> {
  const report = await latestReport(apiUrl, key);
  const url = report.filePath + report.fileActlName;
  const response = await fetch(url, { headers: NSE_HEADERS });
  if (!response.ok) throw new Error(`NSE asset HTTP ${response.status}`);
  return { report, url, content: await response.text() };
}

export async function syncNseSecurityMasters() {
  const cbm = await downloadReport(CBM_API, 'CBM-SECURITY-CSV');
  const wdm = await downloadReport(WDM_API, 'WDM-SEC-AVAILABLE-FOR-TRADE');
  const cbmRows = parseNseSecurityCsv(cbm.content, 'cbm');
  const wdmRows = parseNseSecurityCsv(wdm.content, 'wdm');
  const cbmIngested = ingestNseSecurityRows(cbmRows, 'nse_cbm', cbm.url);
  const wdmIngested = ingestNseSecurityRows(wdmRows, 'nse_wdm', wdm.url);
  const db = getDatabase();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
  return { cbm_url: cbm.url, cbm_rows: cbmRows.length, cbm_ingested: cbmIngested, wdm_url: wdm.url, wdm_rows: wdmRows.length, wdm_ingested: wdmIngested, total_instruments: total, payload_sha256: { cbm: createHash('sha256').update(cbm.content).digest('hex'), wdm: createHash('sha256').update(wdm.content).digest('hex') } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  initDatabase();
  console.log(JSON.stringify(await syncNseSecurityMasters(), null, 2));
  closeDatabase();
}
