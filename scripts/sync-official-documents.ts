import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getDatabase, initDatabase } from '../src/db/index.js';
import { parseTermSheetPdf } from '../src/services/pdf-term-sheet-parser.js';
import { generateUnitizedCashflows, persistUnitizedCashflows } from '../src/services/cashflow-generator.js';

export type SyncDocumentResult = {
  total_documents_processed: number;
  total_cashflows_generated: number;
  skipped_pre_isin_documents: number;
  sync_status: 'ok' | 'ok_zero_results' | 'sync_failed';
};

export async function syncOfficialDocuments(): Promise<SyncDocumentResult> {
  initDatabase();
  const db = getDatabase();

  const evidenceDir = process.env.BOND_TRACKER_EVIDENCE_DIR || join(homedir(), '.bond-tracker', 'evidence', 'pdfs');
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  // Fetch verified SEBI debt issues with prospectus URLs
  const sebiIssues = db.prepare(`
    SELECT issue_id, assigned_isins AS isin, issuer_name, prospectus_url
    FROM ncd_public_issues
    WHERE prospectus_url IS NOT NULL AND prospectus_url LIKE 'http%'
  `).all() as Array<{ issue_id: string; isin: string | null; issuer_name: string; prospectus_url: string }>;

  if (sebiIssues.length === 0) {
    return { total_documents_processed: 0, total_cashflows_generated: 0, skipped_pre_isin_documents: 0, sync_status: 'ok_zero_results' };
  }

  const insertDocStmt = db.prepare(`
    INSERT INTO bond_documents (doc_id, isin, document_type, sha256, file_path, source_url, page_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(doc_id) DO UPDATE SET
      isin = excluded.isin,
      source_url = excluded.source_url
  `);

  let docsProcessed = 0;
  let cashflowsGenerated = 0;
  let skippedPreIsin = 0;

  for (const issue of sebiIssues) {
    try {
      const assignedIsin = issue.isin?.split(/[,|\s]+/).map((v) => v.trim().toUpperCase()).find((v) => /^IN[A-Z0-9]{10}$/.test(v));
      if (!assignedIsin) {
        skippedPreIsin += 1;
        continue;
      }
      const isin = assignedIsin;

      const url = issue.prospectus_url;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BondTracker/1.0)' } });

      if (!res.ok) continue;

      const arrayBuf = await res.arrayBuffer();
      const pdfBuf = Buffer.from(arrayBuf);
      if (pdfBuf.length < 100) continue;

      const hash = createHash('sha256').update(pdfBuf).digest('hex');
      const docId = `DOC-${hash.substring(0, 16).toUpperCase()}`;
      const filePath = join(evidenceDir, `${hash}.pdf`);

      if (!existsSync(filePath)) {
        writeFileSync(filePath, pdfBuf);
      }

      const parsedTerms = await parseTermSheetPdf(pdfBuf);

      insertDocStmt.run(
        docId,
        isin,
        'PROSPECTUS',
        hash,
        filePath,
        url,
        parsedTerms.page_count ?? null
      );

      docsProcessed += 1;

      // Generate unitized cashflows if terms were extracted
      if (parsedTerms.face_value && parsedTerms.coupon_rate && parsedTerms.redemption_events.length > 0) {
        const flows = generateUnitizedCashflows({
          isin,
          face_value: parsedTerms.face_value,
          coupon_rate: parsedTerms.coupon_rate,
          frequency: parsedTerms.payout_frequency,
          day_count_convention: parsedTerms.day_count_convention,
          redemption_events: parsedTerms.redemption_events,
          evidence_doc_id: docId
        });

        cashflowsGenerated += persistUnitizedCashflows(flows);
      }
    } catch {
      // Individual document failures do not halt batch synchronization
      continue;
    }
  }

  return {
    total_documents_processed: docsProcessed,
    total_cashflows_generated: cashflowsGenerated,
    skipped_pre_isin_documents: skippedPreIsin,
    sync_status: docsProcessed > 0 ? 'ok' : 'ok_zero_results'
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await syncOfficialDocuments();
  console.log(`[Official Documents Sync] Status: ${result.sync_status}, Processed: ${result.total_documents_processed}, Cashflows: ${result.total_cashflows_generated}`);
}
