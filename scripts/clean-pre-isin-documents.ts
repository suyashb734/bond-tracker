import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { getDatabase, initDatabase } from '../src/db/index.js';

export function cleanPreIsinDocuments() {
  initDatabase();
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT doc_id, file_path FROM ncd_public_issue_documents
  `).all() as Array<{ doc_id: string; file_path: string }>;

  let deletedCount = 0;

  for (const row of rows) {
    if (existsSync(row.file_path)) {
      try {
        const buf = readFileSync(row.file_path);
        if (!buf.toString('utf8', 0, 10).startsWith('%PDF')) {
          unlinkSync(row.file_path);
          db.prepare('DELETE FROM ncd_public_issue_documents WHERE doc_id = ?').run(row.doc_id);
          deletedCount += 1;
        }
      } catch {
        // Skip read errors
      }
    } else {
      db.prepare('DELETE FROM ncd_public_issue_documents WHERE doc_id = ?').run(row.doc_id);
      deletedCount += 1;
    }
  }

  return deletedCount;
}

if (process.argv[1] && process.argv[1].endsWith('clean-pre-isin-documents.ts')) {
  const count = cleanPreIsinDocuments();
  console.log(`[Evidence Cleanup] Purged ${count} non-PDF stale records and files.`);
}
