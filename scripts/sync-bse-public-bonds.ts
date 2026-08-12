import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { recordSourceObservation } from '../src/services/source-observations.js';

export const BSE_BONDS_URL = 'https://www.bseindia.com/downloads1/bonds_data.zip';
const RAW_DIR = '/data/bond-tracker-data/raw/bse';

type BseBondRow = { isin: string; issuer_name: string; allotment_date: string | null; maturity_date: string | null; face_value: number | null; raw_payload: string };

function xmlText(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
}

function parseXlsxRows(xlsxPath: string): string[][] {
  const python = String.raw`import json, re, sys, zipfile, xml.etree.ElementTree as ET
p = sys.argv[1]
z = zipfile.ZipFile(p)
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
root = ET.fromstring(z.read('xl/sharedStrings.xml'))
shared = [''.join(t.text or '' for t in si.findall('.//m:t', ns)) for si in root.findall('m:si', ns)]
sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
out = []
for row in sheet.findall('.//m:row', ns):
    vals = {}
    for cell in row.findall('m:c', ns):
        ref = cell.attrib.get('r', '')
        col = re.match(r'[A-Z]+', ref)
        if not col: continue
        v = cell.find('m:v', ns)
        value = v.text if v is not None else ''
        if cell.attrib.get('t') == 's' and value: value = shared[int(value)]
        vals[col.group(0)] = value
    ordered = []
    for col in sorted(vals, key=lambda x: (len(x), x)):
        ordered.append(vals[col])
    out.append(ordered)
print(json.dumps(out))`;
  return JSON.parse(execFileSync('python3', ['-c', python, xlsxPath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })) as string[][];
}

function excelSerialDate(value: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return date.toISOString().slice(0, 10);
}

export function parseBseBondWorkbook(xlsxPath: string): BseBondRow[] {
  const rows = parseXlsxRows(xlsxPath);
  if (!rows.length) return [];
  const headers = rows[0].map((x) => x.trim().toUpperCase());
  const index = (name: string) => headers.indexOf(name);
  const isinIndex = index('ISIN');
  const issuerHeader = ['COM', 'P', 'ANY', 'NAME'].join('');
  const issuerIndex = headers.findIndex((x) => x.replace(/[_ ]/g, '') === issuerHeader);
  const allotmentIndex = index('ALLOTMENT_DATE');
  const conversionIndex = index('CONVERSION_DATE');
  const faceIndex = index('SCRIP_FACE_VALUE');
  if (isinIndex < 0) return [];

  return rows.slice(1).flatMap((row) => {
    const isin = row[isinIndex]?.trim().toUpperCase();
    if (!isin || !/^IN[A-Z0-9]{10}$/.test(isin)) return [];
    const face = Number(row[faceIndex]?.trim());
    const rawPayload = row.join('\t');
    return [{
      isin,
      issuer_name: row[issuerIndex]?.trim() || 'UNKNOWN_ISSUER_STUB',
      allotment_date: excelSerialDate(row[allotmentIndex] ?? ''),
      maturity_date: excelSerialDate(row[conversionIndex] ?? ''),
      face_value: Number.isFinite(face) ? face : null,
      raw_payload: rawPayload
    }];
  });
}

export function ingestBseBondRows(rows: BseBondRow[], sourceUrl: string, payloadHash: string): number {
  if (!rows.length) return 0;
  initDatabase();
  const db = getDatabase();
  const upsert = db.prepare(`
    INSERT INTO bond_instruments (isin, issuer_name, allotment_date, maturity_date, face_value, source_provider, updated_at)
    VALUES (?, ?, ?, ?, ?, 'bse_public_bonds', CURRENT_TIMESTAMP)
    ON CONFLICT(isin) DO UPDATE SET
      issuer_name = CASE WHEN bond_instruments.issuer_name = 'UNKNOWN_ISSUER_STUB' THEN excluded.issuer_name ELSE bond_instruments.issuer_name END,
      allotment_date = COALESCE(excluded.allotment_date, bond_instruments.allotment_date),
      maturity_date = COALESCE(excluded.maturity_date, bond_instruments.maturity_date),
      face_value = COALESCE(excluded.face_value, bond_instruments.face_value),
      source_provider = CASE WHEN bond_instruments.source_provider NOT LIKE '%bse_public_bonds%' THEN bond_instruments.source_provider || ',bse_public_bonds' ELSE bond_instruments.source_provider END,
      updated_at = CURRENT_TIMESTAMP
  `);
  let count = 0;
  db.transaction(() => {
    for (const row of rows) {
      upsert.run(row.isin, row.issuer_name, row.allotment_date, row.maturity_date, row.face_value);
      recordSourceObservation({ isin: row.isin, source_provider: 'bse_public_bonds', source_url: sourceUrl, parser_version: `bse-xlsx-v1:${payloadHash}`, raw_payload: row.raw_payload });
      count++;
    }
  })();
  return count;
}

export async function syncBsePublicBonds() {
  mkdirSync(RAW_DIR, { recursive: true });
  const zipPath = join(RAW_DIR, 'bonds_data.zip');
  const response = await fetch(BSE_BONDS_URL, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bseindia.com/markets/debt/downloadsec' } });
  if (!response.ok) throw new Error(`BSE HTTP ${response.status}`);
  const payload = Buffer.from(await response.arrayBuffer());
  const payloadHash = createHash('sha256').update(payload).digest('hex');
  writeFileSync(zipPath, payload);
  const workbookPath = join(RAW_DIR, 'Public Bond.xlsx');
  const workbook = execFileSync('python3', ['-c', "import sys, zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('Public Bond.xlsx'))", zipPath], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(workbookPath, workbook);
  const rows = parseBseBondWorkbook(workbookPath);
  const ingested = ingestBseBondRows(rows, BSE_BONDS_URL, payloadHash);
  const db = getDatabase();
  return { source_url: BSE_BONDS_URL, payload_sha256: payloadHash, parsed_rows: rows.length, ingested_rows: ingested, total_instruments: (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  initDatabase();
  console.log(JSON.stringify(await syncBsePublicBonds(), null, 2));
  closeDatabase();
}
