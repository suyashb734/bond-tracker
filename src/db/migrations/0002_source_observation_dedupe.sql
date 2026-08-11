-- Standalone Bond Tracker Source Observation Dedupe
-- Version: 0002

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_observation_dedupe
ON bond_source_observations(isin, source_provider, raw_payload_hash);
