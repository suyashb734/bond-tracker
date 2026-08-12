import { fileURLToPath } from 'node:url';
import { ingestUdiffIsinRows, parseUdiffIsinCsv } from '../src/sources/depositories/udiff-isin-parser.js';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';

initDatabase();
const db = getDatabase();

const CDSL_UDIFF_URL = 'https://www.cdslindia.com/downloads/DP/Harmonization/ISIN_MSTR_041400_00002_I_202512310000_2.csv';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

export async function syncDepositoryMaster(): Promise<{ sync_status: string; synced_count: number; total_rows: number; source_scope: 'full' | 'sample'; error?: string }> {
  console.log('[Depository Master Sync] Fetching official CDSL UDiFF ISIN master file...');

  let csvContent = '';
  try {
    const resp = await fetch(CDSL_UDIFF_URL, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    csvContent = await resp.text();
  } catch (err: any) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    console.warn(`[Depository Master Sync] live_fetch_failed: ${err.message}`);
    return { sync_status: 'live_fetch_failed', synced_count: 0, total_rows: count, source_scope: 'sample', error: err.message };
  }

  const rows = parseUdiffIsinCsv(csvContent, 'cdsl_udiff');
  if (rows.length === 0) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    return { sync_status: 'ok_zero_results', synced_count: 0, total_rows: count, source_scope: 'sample' };
  }

  const ingestedCount = ingestUdiffIsinRows(rows, csvContent);
  const totalRows = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
  const observationCount = (db.prepare('SELECT COUNT(*) AS c FROM bond_source_observations WHERE source_provider = ?').get('cdsl_udiff') as { c: number }).c;

  console.log(`[Depository Master Sync] Complete! Ingested ${ingestedCount} debt securities from CDSL UDiFF master. Total instruments: ${totalRows}, CDSL observations logged: ${observationCount}`);
  return { sync_status: 'ok', synced_count: ingestedCount, total_rows: totalRows, source_scope: 'sample' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await syncDepositoryMaster();
  closeDatabase();
}
