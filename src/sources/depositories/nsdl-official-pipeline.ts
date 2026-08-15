import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDatabase, initDatabase } from '../../db/index.js';
import { recordSourceObservation } from '../../services/source-observations.js';
import { parseNsdlMasterText } from './nsdl-master-parser.js';

export type NsdlPipelineResult = {
  sync_status: 'ok' | 'failed' | 'error';
  debt_instruments_parsed: number;
  cp_parsed: number;
  cd_parsed: number;
  defaulted_parsed: number;
  total_ingested: number;
  source_urls: string[];
  error?: string;
};

export async function runOfficialNsdlPipeline(): Promise<NsdlPipelineResult> {
  initDatabase();
  const rawDir = '/data/bond-tracker-data/raw/nsdl';
  mkdirSync(rawDir, { recursive: true });

  const pageUrl = 'https://nsdl.com/resources/data/detailed-list-debt-instruments';

  try {
    const html = fetchUrlWithCurl(pageUrl);
    if (!html || html.length < 500) {
      return {
        sync_status: 'failed',
        debt_instruments_parsed: 0,
        cp_parsed: 0,
        cd_parsed: 0,
        defaulted_parsed: 0,
        total_ingested: 0,
        source_urls: [pageUrl],
        error: 'Failed to fetch NSDL debt instruments resource page'
      };
    }

    const links = extractNsdlAssetLinksFromNextJs(html);

    let debtParsed = 0;
    let cpParsed = 0;
    let cdParsed = 0;
    let defaultedParsed = 0;
    let totalIngested = 0;
    const fetchedUrls: string[] = [pageUrl];

    for (const link of links) {
      const assetRes = downloadAndIngestNsdlAsset(link, rawDir);
      if (assetRes) {
        fetchedUrls.push(link.url);
        if (link.type === 'debt') debtParsed += assetRes.parsed;
        if (link.type === 'cp') cpParsed += assetRes.parsed;
        if (link.type === 'cd') cdParsed += assetRes.parsed;
        if (link.type === 'defaulted') defaultedParsed += assetRes.parsed;
        totalIngested += assetRes.ingested;
      }
    }

    return {
      sync_status: 'ok',
      debt_instruments_parsed: debtParsed,
      cp_parsed: cpParsed,
      cd_parsed: cdParsed,
      defaulted_parsed: defaultedParsed,
      total_ingested: totalIngested,
      source_urls: fetchedUrls
    };
  } catch (err: any) {
    return {
      sync_status: 'error',
      debt_instruments_parsed: 0,
      cp_parsed: 0,
      cd_parsed: 0,
      defaulted_parsed: 0,
      total_ingested: 0,
      source_urls: [pageUrl],
      error: err?.message || String(err)
    };
  }
}

export type NsdlAssetLink = {
  url: string;
  type: 'debt' | 'cp' | 'cd' | 'defaulted' | 'other';
  label: string;
};

export function extractNsdlAssetLinksFromNextJs(html: string): NsdlAssetLink[] {
  const links: NsdlAssetLink[] = [];

  const keys: Array<{ key: string; type: NsdlAssetLink['type'] }> = [
    { key: 'debtInstrumentDataSet', type: 'debt' },
    { key: 'commercialDetailDataSet', type: 'cp' },
    { key: 'certificateOfDepositDataSet', type: 'cd' },
    { key: 'activeSecuritiesDataSet', type: 'debt' },
    { key: 'debtListInstrumentDataSet', type: 'defaulted' }
  ];

  for (const item of keys) {
    const keyPos = html.indexOf(item.key);
    if (keyPos !== -1) {
      const bracketPos = html.indexOf('[', keyPos);
      if (bracketPos !== -1 && bracketPos - keyPos <= 30) {
        const closeBracketPos = html.indexOf(']', bracketPos);
        if (closeBracketPos !== -1) {
          const rawArrayStr = html.slice(bracketPos, closeBracketPos + 1);
          try {
            const cleanJson = rawArrayStr.replace(/\\"/g, '"');
            const items = JSON.parse(cleanJson);
            for (const it of items) {
              const path = it.field_file;
              if (path && typeof path === 'string' && (/^https?:\/\//i.test(path) || /^\/(?!\/)/.test(path))) {
                let fullUrl = path;
                if (path.startsWith('/')) {
                  fullUrl = 'https://nsdl.com' + path;
                } else if (path.includes('nsdl.co.in/nsdl/')) {
                  fullUrl = path.replace('nsdl.co.in/nsdl/', 'nsdl.com/nsdl/');
                }
                if (!links.some((l) => l.url === fullUrl)) {
                  links.push({
                    url: fullUrl,
                    type: item.type,
                    label: it.file_name || item.key
                  });
                }
              }
            }
          } catch {
            // Continue parsing remaining keys if JSON parse fails
          }
        }
      }
    }
  }

  return links;
}

function fetchUrlWithCurl(url: string): string | null {
  try {
    const out = execFileSync('curl', [
      '-s', '-L', '-k',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      url
    ], { encoding: 'utf-8', timeout: 30000 });
    return out;
  } catch {
    return null;
  }
}

function isHtmlPayload(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<html');
}

function downloadAndIngestNsdlAsset(
  link: NsdlAssetLink,
  rawDir: string
): { parsed: number; ingested: number } | null {
  try {
    const ext = link.url.endsWith('.xlsx') ? 'xlsx' : 'tsv';
    const tempFile = join(rawDir, `temp_download.${ext}`);

    execFileSync('curl', [
      '-s', '-L', '-k',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      '-o', tempFile,
      link.url
    ], { timeout: 120000 });

    if (!existsSync(tempFile)) return null;

    const buffer = readFileSync(tempFile);
    if (buffer.length < 100 || isHtmlPayload(buffer)) return null;

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const finalPath = join(rawDir, `nsdl_${link.type}_${sha256.slice(0, 12)}.${ext}`);
    writeFileSync(finalPath, buffer);

    if (link.type === 'debt' || link.type === 'cp') {
      const text = buffer.toString('utf-8');
      const rows = parseNsdlMasterText(text);

      if (rows.length > 0) {
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
              source_url: link.url,
              parser_version: 'nsdl-official-pipeline-v1',
              raw_payload: row.raw_payload ?? text
            });
            ingested += 1;
          }
        });

        tx();
        return { parsed: rows.length, ingested };
      }
    }

    return null;
  } catch {
    return null;
  }
}
