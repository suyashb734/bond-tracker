-- Standalone Bond Tracker Initial Migration
-- Version: 0001
-- Scope: Public bond market reference data only

CREATE TABLE IF NOT EXISTS bond_instruments (
    isin TEXT PRIMARY KEY,
    issuer_name TEXT NOT NULL,
    face_value REAL,
    coupon_rate REAL,
    payout_frequency TEXT,
    allotment_date TEXT,
    maturity_date TEXT,
    seniority TEXT,
    secured_unsecured TEXT,
    credit_rating_agency TEXT,
    cra_rating TEXT,
    debenture_trustee TEXT,
    day_count_convention TEXT,
    document_link TEXT,
    raw_json TEXT,
    source_provider TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bond_source_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    isin TEXT NOT NULL,
    source_provider TEXT NOT NULL,
    source_url TEXT,
    http_status INTEGER,
    raw_payload_hash TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    raw_payload TEXT,
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(isin) REFERENCES bond_instruments(isin) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ncd_public_issues (
    issue_id TEXT PRIMARY KEY,
    issuer_name TEXT NOT NULL,
    open_date TEXT,
    close_date TEXT,
    proposed_amount_cr REAL,
    prospectus_url TEXT,
    lifecycle_stage TEXT NOT NULL DEFAULT 'draft_prospectus',
    assigned_isins TEXT,
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broker_quote_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    isin TEXT NOT NULL,
    broker_name TEXT NOT NULL,
    clean_price REAL,
    dirty_price REAL,
    accrued_interest REAL,
    minimum_lot INTEGER,
    quoted_ytm REAL,
    calculated_ytm REAL,
    day_count_convention TEXT,
    source_url TEXT,
    raw_payload TEXT,
    quoted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(isin) REFERENCES bond_instruments(isin) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bond_instruments_issuer ON bond_instruments(issuer_name);
CREATE INDEX IF NOT EXISTS idx_ncd_public_issues_stage ON ncd_public_issues(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_broker_quote_isin ON broker_quote_observations(isin);
