import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { recordSourceObservation } from '../src/services/source-observations.js';

const NEMO_RELEASE_API = 'https://api.github.com/repos/captn3m0/india-isin-data/releases/latest';
const RAW_DIR = '/data/bond-tracker-data/raw/nemo';

export type NemoSyncResult = {
  sync_status: string;
  fetched_active_debt_rows: number;
  ingested_rows: number;
  total_instruments: number;
  release_tag?: string;
  error?: string;
};

export async function syncNemoIsinData(): Promise<NemoSyncResult> {
  initDatabase();
  const db = getDatabase();

  mkdirSync(RAW_DIR, { recursive: true });

  let releaseTag = 'v2026.8.12';
  let downloadUrl = 'https://github.com/captn3m0/india-isin-data/releases/download/v2026.8.12/isin.db';

  try {
    const apiResp = await fetch(NEMO_RELEASE_API, {
      headers: { 'User-Agent': 'Bond-Tracker-Sync/1.0' }
    });
    if (apiResp.ok) {
      const data = (await apiResp.json()) as any;
      releaseTag = data.tag_name ?? releaseTag;
      const asset = data.assets?.find((a: any) => a.name === 'isin.db');
      if (asset?.browser_download_url) {
        downloadUrl = asset.browser_download_url;
      }
    }
  } catch (e: any) {
    console.warn(`[Nemo Sync] Release API fetch failed, falling back to ${releaseTag}: ${e.message}`);
  }

  const localDbPath = join(RAW_DIR, `nemo_isin_${releaseTag}.db`);
  if (!existsSync(localDbPath)) {
    console.log(`[Nemo Sync] Downloading release DB from ${downloadUrl}...`);
    try {
      const dbResp = await fetch(downloadUrl, {
        headers: { 'User-Agent': 'Bond-Tracker-Sync/1.0' }
      });
      if (!dbResp.ok) throw new Error(`HTTP ${dbResp.status}`);
      const arrayBuf = await dbResp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      execFileSync('python3', ['-c', 'import sys; open(sys.argv[1], "wb").write(sys.stdin.buffer.read())', localDbPath], {
        input: buffer
      });
    } catch (err: any) {
      const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
      return { sync_status: 'live_fetch_failed', fetched_active_debt_rows: 0, ingested_rows: 0, total_instruments: total, error: err.message };
    }
  }

  console.log(`[Nemo Sync] Extracting active debt ISINs from ${localDbPath}...`);

  const pythonQuery = `
import sqlite3, json, sys

db_path = sys.argv[1]
c = sqlite3.connect(db_path)

query = """
    SELECT isin, issuer_name, description, security_type_name, interest_rate, maturity_date
    FROM isin
    WHERE status = 'ACTIVE'
      AND (security_type_name LIKE '%DEBT%'
        OR security_type_name LIKE '%BOND%'
        OR security_type_name LIKE '%DEBENTURE%'
        OR security_type_name LIKE '%COMMERCIAL PAPER%'
        OR security_type_name LIKE '%GOVERNMENT SECURITIES%'
        OR security_type_name LIKE '%SECURITISED%'
        OR security_type_name LIKE '%CERTIFICATE OF DEPOSIT%'
        OR security_type_name LIKE '%TREASURY BILLS%'
        OR security_type_name LIKE '%SOVEREIGN GOLD BOND%'
        OR isin LIKE 'INE%05%' OR isin LIKE 'INE%07%' OR isin LIKE 'INE%08%' OR isin LIKE 'INE%14%' OR isin LIKE 'INE%15%' OR isin LIKE 'INE%16%' OR isin LIKE 'INE%18%'
        OR isin LIKE 'INS%' OR isin LIKE 'IN00%' OR isin LIKE 'IN10%' OR isin LIKE 'IN20%' OR isin LIKE 'IN30%')
"""

rows = c.execute(query).fetchall()
result = []
for r in rows:
    result.append({
        "isin": r[0],
        "issuer_name": r[1] or "UNKNOWN_ISSUER_STUB",
        "description": r[2],
        "security_type": r[3],
        "interest_rate": r[4],
        "maturity_date": r[5]
    })

print(json.dumps(result))
c.close()
`;

  let extractedJson = '[]';
  try {
    extractedJson = execFileSync('python3', ['-c', pythonQuery, localDbPath], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  } catch (err: any) {
    const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    return { sync_status: 'extraction_failed', fetched_active_debt_rows: 0, ingested_rows: 0, total_instruments: total, error: err.message };
  }

  const extractedRows = JSON.parse(extractedJson) as Array<{
    isin: string;
    issuer_name: string;
    description: string | null;
    security_type: string | null;
    interest_rate: number | null;
    maturity_date: string | null;
  }>;

  if (extractedRows.length === 0) {
    const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    return { sync_status: 'ok_zero_results', fetched_active_debt_rows: 0, ingested_rows: 0, total_instruments: total, release_tag: releaseTag };
  }

  const upsertStmt = db.prepare(`
    INSERT INTO bond_instruments (isin, issuer_name, maturity_date, source_provider, updated_at)
    VALUES (?, ?, ?, 'nemo_isin_github', CURRENT_TIMESTAMP)
    ON CONFLICT(isin) DO UPDATE SET
      issuer_name = CASE
        WHEN bond_instruments.issuer_name = 'UNKNOWN_ISSUER_STUB' OR bond_instruments.issuer_name IS NULL
        THEN excluded.issuer_name
        ELSE bond_instruments.issuer_name
      END,
      maturity_date = COALESCE(bond_instruments.maturity_date, excluded.maturity_date),
      source_provider = CASE
        WHEN bond_instruments.source_provider NOT LIKE '%nemo_isin_github%'
        THEN bond_instruments.source_provider || ',nemo_isin_github'
        ELSE bond_instruments.source_provider
      END,
      updated_at = CURRENT_TIMESTAMP
  `);

  let ingested = 0;
  const tx = db.transaction(() => {
    for (const r of extractedRows) {
      if (!/^IN[A-Z0-9]{10}$/i.test(r.isin)) continue;
      const cleanIsin = r.isin.trim().toUpperCase();
      const rawLine = JSON.stringify(r);

      upsertStmt.run(cleanIsin, r.issuer_name, r.maturity_date ?? null);

      recordSourceObservation({
        isin: cleanIsin,
        source_provider: 'nemo_isin_github',
        source_url: downloadUrl,
        parser_version: 'nemo-sqlite-v1',
        raw_payload: rawLine
      });

      ingested++;
    }
  });

  tx();

  const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
  console.log(`[Nemo Sync] Complete! Ingested ${ingested} active debt ISINs from ${releaseTag}. Total catalog: ${total}`);

  return {
    sync_status: 'ok',
    fetched_active_debt_rows: extractedRows.length,
    ingested_rows: ingested,
    total_instruments: total,
    release_tag: releaseTag
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = await syncNemoIsinData();
  console.log(JSON.stringify(res, null, 2));
  closeDatabase();
}
