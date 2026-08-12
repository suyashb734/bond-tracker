import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDatabase, initDatabase, closeDatabase } from '../src/db/index.js';
import { parseTermSheetPdf, type ParsedTermSheet } from '../src/services/pdf-term-sheet-parser.js';
import { generateUnitizedCashflows } from '../src/services/cashflow-generator.js';

export type PreIsinExtractionResult = {
  issue_id: string;
  doc_id: string;
  status: 'parsed' | 'needs_review' | 'failed';
  terms: ParsedTermSheet | null;
  draft_cashflows: Array<Omit<ReturnType<typeof generateUnitizedCashflows>[number], 'isin'>>;
  error?: string;
};

export async function extractPreIsinContractualTerms(): Promise<PreIsinExtractionResult[]> {
  initDatabase();
  const db = getDatabase();
  const documents = db.prepare(`
    SELECT d.doc_id, d.issue_id, d.sha256, d.file_path
    FROM ncd_public_issue_documents d
    WHERE d.doc_id = (
      SELECT d2.doc_id FROM ncd_public_issue_documents d2
      WHERE d2.issue_id = d.issue_id ORDER BY d2.page_count DESC, d2.doc_id LIMIT 1
    )
    ORDER BY d.issue_id
  `).all() as Array<{ doc_id: string; issue_id: string; sha256: string; file_path: string }>;

  const results: PreIsinExtractionResult[] = [];
  const upsert = db.prepare(`
    INSERT INTO ncd_public_issue_contractual_terms
      (issue_id, doc_id, pdf_sha256, face_value, coupon_rate, payout_frequency,
       day_count_convention, maturity_date, redemption_schedule_json,
       draft_unitized_cashflows_json, parser_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(issue_id) DO UPDATE SET
      doc_id = excluded.doc_id,
      pdf_sha256 = excluded.pdf_sha256,
      face_value = excluded.face_value,
      coupon_rate = excluded.coupon_rate,
      payout_frequency = excluded.payout_frequency,
      day_count_convention = excluded.day_count_convention,
      maturity_date = excluded.maturity_date,
      redemption_schedule_json = excluded.redemption_schedule_json,
      draft_unitized_cashflows_json = excluded.draft_unitized_cashflows_json,
      parser_version = excluded.parser_version,
      extracted_at = CURRENT_TIMESTAMP
  `);

  for (const document of documents) {
    try {
      const pdf = await readFile(document.file_path);
      const terms = await parseTermSheetPdf(pdf);
      const complete = terms.face_value !== null && terms.coupon_rate !== null && terms.payout_frequency !== 'unknown';
      const draftCashflows = complete
        ? generateUnitizedCashflows({
            isin: 'UNASSIGNED',
            face_value: terms.face_value!,
            coupon_rate: terms.coupon_rate!,
            frequency: terms.payout_frequency,
            day_count_convention: terms.day_count_convention,
            redemption_events: terms.redemption_events
          }).map((cashflow: ReturnType<typeof generateUnitizedCashflows>[number]) => {
            const { isin: _unassigned, ...withoutIsin } = cashflow;
            return withoutIsin;
          })
        : [];

      upsert.run(
        document.issue_id,
        document.doc_id,
        terms.sha256,
        terms.face_value,
        terms.coupon_rate,
        terms.payout_frequency,
        terms.day_count_convention,
        terms.maturity_date,
        JSON.stringify(terms.redemption_events),
        JSON.stringify(draftCashflows),
        'pre-isin-pdf-terms-v1'
      );
      results.push({ issue_id: document.issue_id, doc_id: document.doc_id, status: complete ? 'parsed' : 'needs_review', terms, draft_cashflows: draftCashflows });
    } catch (error) {
      results.push({ issue_id: document.issue_id, doc_id: document.doc_id, status: 'failed', terms: null, draft_cashflows: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await extractPreIsinContractualTerms();
  console.log(JSON.stringify({ documents_processed: result.length, parsed: result.filter((x) => x.status === 'parsed').length, needs_review: result.filter((x) => x.status === 'needs_review').length, failed: result.filter((x) => x.status === 'failed').length }, null, 2));
  closeDatabase();
}
