-- Migration 0006: Pre-ISIN Public Issue Contractual Terms & Draft Cashflows
-- Scope: Store parsed prospectus terms and ₹10,000 unit payout schedules linked to issue_id before ISIN assignment

CREATE TABLE IF NOT EXISTS ncd_public_issue_contractual_terms (
    issue_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    pdf_sha256 TEXT NOT NULL,
    face_value REAL,
    coupon_rate REAL,
    payout_frequency TEXT,
    day_count_convention TEXT,
    maturity_date TEXT,
    redemption_schedule_json TEXT,
    draft_unitized_cashflows_json TEXT,
    parser_version TEXT NOT NULL,
    extracted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(issue_id) REFERENCES ncd_public_issues(issue_id) ON DELETE CASCADE,
    FOREIGN KEY(doc_id) REFERENCES ncd_public_issue_documents(doc_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pre_isin_terms_doc ON ncd_public_issue_contractual_terms(doc_id);
