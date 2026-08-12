import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getDatabase, initDatabase } from '../db/index.js';
import { parseTermSheetPdf } from './pdf-term-sheet-parser.js';

export type SyncPreIsinDocResult = {
  total_documents_processed: number;
  sync_status: 'ok' | 'ok_zero_results' | 'sync_failed';
};

export async function syncPreIsinPublicIssueDocuments(): Promise<SyncPreIsinDocResult> {
  initDatabase();
  const db = getDatabase();

  const evidenceDir = process.env.BOND_TRACKER_EVIDENCE_DIR || join(homedir(), '.bond-tracker', 'evidence', 'pdfs');
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  // Fetch all SEBI debt issues with prospectus URLs
  const sebiIssues = db.prepare(`
    SELECT issue_id, issuer_name, prospectus_url
    FROM ncd_public_issues
    WHERE prospectus_url IS NOT NULL AND prospectus_url LIKE 'http%'
  `).all() as Array<{ issue_id: string; issuer_name: string; prospectus_url: string }>;

  if (sebiIssues.length === 0) {
    return { total_documents_processed: 0, sync_status: 'ok_zero_results' };
  }

  const insertDocStmt = db.prepare(`
    INSERT INTO ncd_public_issue_documents (doc_id, issue_id, document_type, sha256, file_path, source_url, page_count)
    VALUES (?, ?, 'DRAFT_PROSPECTUS', ?, ?, ?, ?)
    ON CONFLICT(doc_id) DO UPDATE SET
      source_url = excluded.source_url
  `);

  let docsProcessed = 0;

  for (const issue of sebiIssues) {
    try {
      const url = issue.prospectus_url;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BondTracker/1.0)' } });

      if (!res.ok) continue;

      let pdfBuf: Buffer;
      let finalDocUrl = url;

      const contentType = res.headers.get('content-type') || '';
      const initialBuf = Buffer.from(await res.arrayBuffer());

      if (contentType.includes('text/html') || initialBuf.toString('utf8', 0, 500).includes('<html')) {
        // Extract real PDF attachment link from SEBI HTML landing page
        const html = initialBuf.toString('utf8');
        const pdfLinkMatch = html.match(/(?:href=["'])(https?:[^\s"']+\.pdf|\/sebi_data\/attachdocs[^\s"']+\.pdf)/i) ||
                             html.match(/(https?:\/\/[^\s"']+\.pdf)/i);

        if (!pdfLinkMatch) continue;

        let pdfUrl = pdfLinkMatch[1];
        if (pdfUrl.startsWith('/')) {
          pdfUrl = `https://www.sebi.gov.in${pdfUrl}`;
        }
        finalDocUrl = pdfUrl;

        const pdfRes = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BondTracker/1.0)' } });
        if (!pdfRes.ok) continue;

        pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
      } else {
        pdfBuf = initialBuf;
      }

      if (pdfBuf.length < 100 || !pdfBuf.toString('utf8', 0, 10).startsWith('%PDF')) continue;

      const hash = createHash('sha256').update(pdfBuf).digest('hex');
      const docId = `ISSUE-DOC-${hash.substring(0, 16).toUpperCase()}`;
      const filePath = join(evidenceDir, `${hash}.pdf`);

      if (!existsSync(filePath)) {
        writeFileSync(filePath, pdfBuf);
      }

      const parsedTerms = await parseTermSheetPdf(pdfBuf);

      insertDocStmt.run(
        docId,
        issue.issue_id,
        hash,
        filePath,
        url,
        parsedTerms.page_count ?? null
      );

      docsProcessed += 1;
    } catch {
      // Individual fetch errors do not halt execution
      continue;
    }
  }

  return {
    total_documents_processed: docsProcessed,
    sync_status: docsProcessed > 0 ? 'ok' : 'ok_zero_results'
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await syncPreIsinPublicIssueDocuments();
  console.log(`[Pre-ISIN Documents Sync] Status: ${result.sync_status}, Processed: ${result.total_documents_processed}`);
}
