import { fileURLToPath } from 'node:url';
import { parseSebiDebtCategoryHtml, sebiItemToNcdPublicIssue } from '../src/sources/sebi/sebi-debt-adapter.js';
import { upsertNcdPublicIssue } from '../src/services/ncd-ipo-sync.js';
import { initDatabase, getDatabase, closeDatabase } from '../src/db/index.js';

initDatabase();
const db = getDatabase();

const SEBI_DEBT_OFFERINGS_URL = 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=17&smid=38';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

export async function syncSebiPublicIssues(): Promise<{ sync_status: string; synced_count: number; total_rows: number; error?: string }> {
  console.log('[SEBI Debt Sync] Ingesting official public debt offer documents from SEBI (ssid=17)...');

  let html = '';
  try {
    const resp = await fetch(SEBI_DEBT_OFFERINGS_URL, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch (err: any) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM ncd_public_issues').get() as { c: number }).c;
    console.warn(`[SEBI Debt Sync] live_fetch_failed: ${err.message}`);
    return { sync_status: 'live_fetch_failed', synced_count: 0, total_rows: count, error: err.message };
  }

  const items = parseSebiDebtCategoryHtml(html);
  if (items.length === 0) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM ncd_public_issues').get() as { c: number }).c;
    return { sync_status: 'ok_zero_results', synced_count: 0, total_rows: count };
  }

  let syncedCount = 0;
  for (const item of items) {
    try {
      const record = sebiItemToNcdPublicIssue(item);
      upsertNcdPublicIssue(record);
      syncedCount += 1;
    } catch (e: any) {
      console.warn(`[SEBI Debt Sync] Skipping issue ${item.title}: ${e.message}`);
    }
  }

  const totalRows = (db.prepare('SELECT COUNT(*) AS c FROM ncd_public_issues').get() as { c: number }).c;
  console.log(`[SEBI Debt Sync] Complete! Synced ${syncedCount} verified public debt disclosures into ncd_public_issues. Total in DB: ${totalRows}`);
  return { sync_status: 'ok', synced_count: syncedCount, total_rows: totalRows };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await syncSebiPublicIssues();
  closeDatabase();
}
