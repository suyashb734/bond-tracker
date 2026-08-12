import { fileURLToPath } from 'node:url';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { ingestNsdlMasterRows, parseNsdlMasterText } from '../src/sources/depositories/nsdl-master-parser.js';

export const NSDL_DEBT_MASTER_URL =
  'https://nsdl.com/nsdl/2026-08/Download_the_entire_list_of_Debt_Instruments_%28including_Redeemed%29_as_on_06.08.2026.xls';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

export async function syncNsdlMaster(): Promise<{
  sync_status: string;
  fetched_rows: number;
  ingested_rows: number;
  total_instruments: number;
  error?: string;
}> {
  initDatabase();
  const db = getDatabase();

  let rawPayload: string;
  try {
    const response = await fetch(NSDL_DEBT_MASTER_URL, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    rawPayload = await response.text();
  } catch (error) {
    const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    return {
      sync_status: 'live_fetch_failed',
      fetched_rows: 0,
      ingested_rows: 0,
      total_instruments: total,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const rows = parseNsdlMasterText(rawPayload);
  const ingested = ingestNsdlMasterRows(rows, rawPayload, NSDL_DEBT_MASTER_URL);
  const total = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;

  return {
    sync_status: rows.length > 0 ? 'ok' : 'ok_zero_results',
    fetched_rows: rows.length,
    ingested_rows: ingested,
    total_instruments: total
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await syncNsdlMaster();
  console.log(JSON.stringify(result, null, 2));
  closeDatabase();
}
