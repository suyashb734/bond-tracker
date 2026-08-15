-- Migration 0008: Add security_type and lifecycle_status to bond_instruments
ALTER TABLE bond_instruments ADD COLUMN security_type TEXT DEFAULT 'CORPORATE_BOND';
ALTER TABLE bond_instruments ADD COLUMN lifecycle_status TEXT DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_bond_instruments_security_type ON bond_instruments(security_type);
CREATE INDEX IF NOT EXISTS idx_bond_instruments_lifecycle_status ON bond_instruments(lifecycle_status);
