import { getDatabase, initDatabase } from '../src/db/index.js';
import { runOfficialNsdlPipeline } from '../src/sources/depositories/nsdl-official-pipeline.js';
import { checkCdslFiledropSync } from './watch-cdsl-filedrop.js';
import { syncNsdlMaster } from './sync-nsdl-master.js';
import { syncNseSecurityMasters } from './sync-nse-security-masters.js';
import { syncBsePublicBonds } from './sync-bse-public-bonds.js';
import { syncNemoIsinData } from './sync-nemo-isin-data.js';
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
  let lastSourceFailures = 0;
  let lastCdslScope: 'full' | 'sample' = 'sample';
  const maxPasses = 5;

  while (pass <= maxPasses) {
    console.log(`[Pass ${pass}/${maxPasses}] Executing multi-source ingestion pass...`);
    const initialCount = (db.prepare('SELECT count(*) as c FROM bond_instruments').get() as { c: number }).c;

    let sourceFailures = 0;

    // 1. Prefer a locally delivered full CDSL master. The public CDSL page
    // currently exposes only a one-row/sample URL; it must not be treated as
    // national coverage. Fall back to it only to keep the rest of the pass
    // useful while preserving sourceFailures for the completeness gate.
    try {
      const dropRes = await checkCdslFiledropSync();
      const cdslRes = dropRes.source_scope === 'full' ? dropRes : await syncDepositoryMaster();
      lastCdslScope = cdslRes.source_scope;
      console.log(`  - CDSL Sync: ${cdslRes.sync_status}, ${cdslRes.synced_count} items, scope=${cdslRes.source_scope}.`);
      if (cdslRes.source_scope !== 'full' || cdslRes.sync_status !== 'ok' || cdslRes.synced_count === 0) sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - CDSL Sync Error: ${e.message}`);
    }

    // 2. NSDL Native Multi-Asset Pipeline Sync (expected >0 rows)
    try {
      const nsdlPipeRes = await runOfficialNsdlPipeline();
      console.log(`  - Native NSDL Sync: ${nsdlPipeRes.sync_status}, ingested ${nsdlPipeRes.total_ingested} rows.`);
      if (nsdlPipeRes.sync_status !== 'ok' || nsdlPipeRes.total_ingested === 0) sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - Native NSDL Sync Error: ${e.message}`);
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

    // 5. Nemo Open-Source ISIN Release Sync (expected >0 rows)
    try {
      const nemoRes = await syncNemoIsinData();
      console.log(`  - Nemo Sync: ${nemoRes.sync_status}, ingested ${nemoRes.ingested_rows} rows from ${nemoRes.release_tag}.`);
      if (nemoRes.sync_status !== 'ok' || nemoRes.ingested_rows === 0) sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - Nemo Sync Error: ${e.message}`);
    }

    // 6. SEBI Draft Debt Offerings Sync
    try {
      const sebiRes = await syncSebiPublicIssues();
      console.log(`  - SEBI Sync: ${sebiRes.sync_status}, ${sebiRes.synced_count} draft issues.`);
      if (sebiRes.sync_status !== 'ok' || sebiRes.synced_count === 0) sourceFailures++;
    } catch (e: any) {
      sourceFailures++;
      console.error(`  - SEBI Sync Error: ${e.message}`);
    }

    const currentCount = (db.prepare('SELECT count(*) as c FROM bond_instruments').get() as { c: number }).c;
    const newInPass = currentCount - initialCount;
    totalNewInSession += newInPass;
    lastSourceFailures = sourceFailures;

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
  console.log(`National Completeness: ${lastSourceFailures === 0 ? 'PROVEN BY RUN' : 'NOT PROVEN (source failures remain)'}`);
  console.log(`CDSL Scope: ${lastCdslScope}`);

  return {
    passes_completed: pass,
    total_new_isins: totalNewInSession,
    source_failures: lastSourceFailures,
    national_completeness_proven: lastSourceFailures === 0 && lastCdslScope === 'full',
    cdsl_scope: lastCdslScope,
    final_report: report
  };
}

if (process.argv[1] && process.argv[1].endsWith('sync-complete-bond-master.ts')) {
  runLoopingBondMasterSync().catch(console.error);
}
