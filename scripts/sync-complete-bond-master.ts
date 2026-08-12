import { getDatabase, initDatabase } from '../src/db/index.js';
import { syncDepositoryMaster } from './sync-depository-master.js';
import { syncNsdlMaster } from './sync-nsdl-master.js';
import { syncNseSecurityMasters } from './sync-nse-security-masters.js';
import { syncBsePublicBonds } from './sync-bse-public-bonds.js';
import { syncSebiPublicIssues } from './sync-sebi-public-issues.js';
import { generateNationalCoverageReport } from '../src/services/coverage-report.js';

export async function runLoopingBondMasterSync() {
  initDatabase();
  const db = getDatabase();

  console.log('================================================================');
  console.log('  STARTING AUTONOMOUS MULTI-SOURCE LOOPING BOND MASTER SYNC     ');
  console.log('================================================================\n');

  let pass = 1;
  let totalNewInSession = 0;
  const maxPasses = 5;

  while (pass <= maxPasses) {
    console.log(`[Pass ${pass}/${maxPasses}] Executing multi-source ingestion pass...`);
    const initialCount = (db.prepare('SELECT count(*) as c FROM bond_instruments').get() as { c: number }).c;

    let sourceFailures = 0;

    // 1. CDSL Depository Sync (expected >0 rows)
    try {
      const cdslRes = await syncDepositoryMaster();
      console.log(`  - CDSL Sync: ${cdslRes.sync_status}, ${cdslRes.synced_count} items.`);
      if (cdslRes.sync_status !== 'ok' || cdslRes.synced_count === 0) sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - CDSL Sync Error: ${e.message}`);
    }

    // 2. NSDL Debt Master Sync (expected >0 rows)
    try {
      const nsdlRes = await syncNsdlMaster();
      console.log(`  - NSDL Sync: ${nsdlRes.sync_status}, ingested ${nsdlRes.ingested_rows} rows.`);
      if (nsdlRes.sync_status !== 'ok' || nsdlRes.ingested_rows === 0) sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - NSDL Sync Error: ${e.message}`);
    }

    // 3. NSE CBM & WDM Security Master Sync (expected >0 rows)
    try {
      const nseRes = await syncNseSecurityMasters();
      console.log(`  - NSE Sync: CBM ${nseRes.cbm_ingested} rows, WDM ${nseRes.wdm_ingested} rows.`);
      if (nseRes.cbm_rows === 0 || nseRes.wdm_rows === 0) sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - NSE Sync Error: ${e.message}`);
    }

    // 4. BSE Public Bonds Workbook Sync (expected >0 rows)
    try {
      const bseRes = await syncBsePublicBonds();
      console.log(`  - BSE Sync: ${bseRes.ingested_rows} rows.`);
      if (bseRes.parsed_rows === 0) sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - BSE Sync Error: ${e.message}`);
    }

    // 5. SEBI Draft Debt Offerings Sync
    try {
      const sebiRes = await syncSebiPublicIssues();
      console.log(`  - SEBI Sync: ${sebiRes.sync_status}, ${sebiRes.synced_count} draft issues.`);
      if (sebiRes.sync_status === 'live_fetch_failed') sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - SEBI Sync Error: ${e.message}`);
    }

    const currentCount = (db.prepare('SELECT count(*) as c FROM bond_instruments').get() as { c: number }).c;
    const newInPass = currentCount - initialCount;
    totalNewInSession += newInPass;

    console.log(`[Pass ${pass}] Initial ISINs: ${initialCount} -> Current ISINs: ${currentCount} (+${newInPass} new), source failures: ${sourceFailures}\n`);

    if (newInPass === 0 && sourceFailures === 0 && pass > 1) {
      console.log(`[Convergence Reached] Complete pass with 0 new ISINs and 0 source failures in Pass ${pass}.\n`);
      break;
    }

    pass += 1;
  }

  const report = generateNationalCoverageReport();
  console.log('================================================================');
  console.log(`  MULTI-SOURCE SYNC COMPLETE: ${totalNewInSession} NEW ISINs ADDED   `);
  console.log('================================================================');
  console.log(`Total ISINs: ${report.total_instruments}`);
  console.log(`Face Value Fill Rate: ${report.face_value_fill_rate_pct}%`);
  console.log(`Maturity Date Fill Rate: ${report.maturity_fill_rate_pct}%`);

  return {
    passes_completed: pass,
    total_new_isins: totalNewInSession,
    final_report: report
  };
}

if (process.argv[1] && process.argv[1].endsWith('sync-complete-bond-master.ts')) {
  runLoopingBondMasterSync().catch(console.error);
}
