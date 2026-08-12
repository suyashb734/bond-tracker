import { fileURLToPath } from 'node:url';
import { generateNationalCoverageReport } from '../src/services/coverage-report.js';
import { syncDepositoryMaster } from './sync-depository-master.js';
import { syncSebiPublicIssues } from './sync-sebi-public-issues.js';
import { closeDatabase, initDatabase } from '../src/db/index.js';

initDatabase();

export async function syncNationalDepositoryUniverse() {
  console.log('================================================================');
  console.log('    NATIONAL BOND MASTER & DEPOSITORY UNIVERSE SYNCHRONIZATION  ');
  console.log('================================================================');

  // 1. Run Depository Master Ingestion (CDSL UDiFF)
  const cdslResult = await syncDepositoryMaster();
  console.log(`[CDSL Sync] Status: ${cdslResult.sync_status}, Synced: ${cdslResult.synced_count}`);

  // 2. Run SEBI Public Debt Offerings Ingestion (ssid=17)
  const sebiResult = await syncSebiPublicIssues();
  console.log(`[SEBI Debt Sync] Status: ${sebiResult.sync_status}, Synced: ${sebiResult.synced_count}`);

  // 3. Generate National Coverage Report
  const report = generateNationalCoverageReport();
  console.log('\n================================================================');
  console.log('               NATIONAL BOND MASTER COVERAGE REPORT              ');
  console.log('================================================================');
  console.log(`Total ISINs in Master:           ${report.total_instruments}`);
  console.log(`Face Value Fill Rate:             ${report.face_value_fill_rate_pct}% (${report.instruments_with_face_value}/${report.total_instruments})`);
  console.log(`Maturity Date Fill Rate:          ${report.maturity_fill_rate_pct}% (${report.instruments_with_maturity_date}/${report.total_instruments})`);
  console.log(`Verified SEBI NCD Filings:        ${report.total_ncd_public_issues}`);
  console.log(`Logged Source Observations:      ${report.total_source_observations}`);
  console.log(`Unitized Cashflow Schedules:      ${report.total_unitized_cashflow_rows}`);
  console.log(`Secondary Broker Quotes:         ${report.total_broker_quotes}`);
  console.log('Source Provider Distribution:');
  for (const [provider, count] of Object.entries(report.source_provider_distribution)) {
    console.log(`  - ${provider.padEnd(25)}: ${count} ISINs`);
  }
  console.log('================================================================\n');

  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await syncNationalDepositoryUniverse();
  closeDatabase();
}
