-- Migration 0005: Pre-ISIN Public Issue Documents
-- Version: 0005

CREATE TABLE IF NOT EXISTS ncd_public_issue_documents (
    doc_id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'DRAFT_PROSPECTUS', -- 'DRAFT_PROSPECTUS' | 'SHELF_PROSPECTUS' | 'TRANCH_PROSPECTUS'
    sha256 TEXT NOT NULL,
    file_path TEXT NOT NULL,
    source_url TEXT,
    page_count INTEGER,
    extracted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(issue_id) REFERENCES ncd_public_issues(issue_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_issue_docs_issue_id ON ncd_public_issue_documents(issue_id);
