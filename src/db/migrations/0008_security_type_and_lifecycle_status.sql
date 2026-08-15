-- Migration 0008: Add security_type and lifecycle_status to bond_instruments
ALTER TABLE bond_instruments ADD COLUMN security_type TEXT CHECK (security_type IN ('CORPORATE_BOND', 'COMMERCIAL_PAPER', 'CERTIFICATE_OF_DEPOSIT', 'SECURITISED_DEBT', 'GOVERNMENT_SECURITY', 'SOVEREIGN_GOLD_BOND', 'MUNICIPAL_BOND', 'UNKNOWN'));
ALTER TABLE bond_instruments ADD COLUMN lifecycle_status TEXT CHECK (lifecycle_status IN ('ACTIVE', 'REDEEMED', 'DEFAULTED', 'SUSPENDED', 'UNKNOWN'));

CREATE INDEX IF NOT EXISTS idx_bond_instruments_security_type ON bond_instruments(security_type);
CREATE INDEX IF NOT EXISTS idx_bond_instruments_lifecycle_status ON bond_instruments(lifecycle_status);
