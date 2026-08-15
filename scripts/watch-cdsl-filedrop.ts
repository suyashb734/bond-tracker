import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { ingestUdiffIsinRows, parseUdiffIsinCsv } from '../src/sources/depositories/udiff-isin-parser.js';


export async function checkCdslFiledropSync(): Promise<{
  sync_status: string;
  synced_count: number;
  total_rows: number;
  source_scope: 'full' | 'sample';
  file_processed?: string | null;
  error?: string;
}> {
  const cdslDropDir = process.env.BOND_TRACKER_CDSL_DROP_DIR ?? '/data/bond-tracker-data/raw/cdsl';
  initDatabase();
  const db = getDatabase();

  let files: string[] = [];
  try {
    files = readdirSync(cdslDropDir);
  } catch {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    return { sync_status: 'no_drop_directory', synced_count: 0, total_rows: count, source_scope: 'sample' };
  }

  // Look for full master files (e.g. ISIN_MSTR_*_F_*.csv or any .csv file with > 1000 lines)
  const csvFiles = files.filter((f) => f.endsWith('.csv') || f.endsWith('.tsv'));
  if (csvFiles.length === 0) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    return { sync_status: 'no_file_dropped', synced_count: 0, total_rows: count, source_scope: 'sample' };
  }

  let selectedFile: string | null = null;
  let fullContent = '';

  for (const file of csvFiles) {
    const fullPath = join(cdslDropDir, file);
    try {
      const stats = statSync(fullPath);
      if (stats.size < 100) continue;
      const content = readFileSync(fullPath, 'utf8');
      const lineCount = content.split(/\r?\n/).length;

      // Full files have _F_ in name or >1000 lines
      if (file.includes('_F_') || lineCount > 1000 || csvFiles.length === 1) {
        selectedFile = file;
        fullContent = content;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!selectedFile || !fullContent) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    return { sync_status: 'no_valid_master_file', synced_count: 0, total_rows: count, source_scope: 'sample' };
  }

  const rows = parseUdiffIsinCsv(fullContent, 'cdsl_udiff');
  if (rows.length === 0) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;
    return { sync_status: 'ok_zero_results', synced_count: 0, total_rows: count, source_scope: 'sample', file_processed: selectedFile };
  }

  const isFullScope = selectedFile.includes('_F_') || rows.length > 1000;
  const scope: 'full' | 'sample' = isFullScope ? 'full' : 'sample';

  const ingestedCount = ingestUdiffIsinRows(rows, fullContent);
  const totalRows = (db.prepare('SELECT COUNT(*) AS c FROM bond_instruments').get() as { c: number }).c;

  console.log(`[CDSL File Drop Watcher] Processed ${selectedFile}: ingested ${ingestedCount} rows, scope=${scope}.`);
  return {
    sync_status: 'ok',
    synced_count: ingestedCount,
    total_rows: totalRows,
    source_scope: scope,
    file_processed: selectedFile
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await checkCdslFiledropSync();
  console.log(JSON.stringify(result, null, 2));
  closeDatabase();
}
