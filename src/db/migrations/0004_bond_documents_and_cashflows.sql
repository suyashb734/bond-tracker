-- Phase D Schema Migration: Official Documents & Unitized Cashflows
-- Version: 0004

CREATE TABLE IF NOT EXISTS bond_documents (
    doc_id TEXT PRIMARY KEY,
    isin TEXT NOT NULL,
    document_type TEXT NOT NULL, -- 'IM' | 'KID' | 'TERM_SHEET' | 'PROSPECTUS' | 'LISTING_CIRCULAR'
    sha256 TEXT NOT NULL,
    file_path TEXT NOT NULL,
    source_url TEXT,
    page_count INTEGER,
    extracted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(isin) REFERENCES bond_instruments(isin) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bond_unitized_cashflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    isin TEXT NOT NULL,
    due_date TEXT NOT NULL,
    gross_coupon_per_unit REAL NOT NULL DEFAULT 0.0,
    principal_redemption_per_unit REAL NOT NULL DEFAULT 0.0,
    unit_face_value REAL NOT NULL DEFAULT 10000.0,
    day_count_convention TEXT NOT NULL DEFAULT 'Actual/365',
    evidence_doc_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(isin) REFERENCES bond_instruments(isin) ON DELETE CASCADE,
    FOREIGN KEY(evidence_doc_id) REFERENCES bond_documents(doc_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bond_documents_isin ON bond_documents(isin);
CREATE INDEX IF NOT EXISTS idx_unitized_cashflows_isin_date ON bond_unitized_cashflows(isin, due_date);
