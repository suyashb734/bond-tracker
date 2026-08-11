-- Source observation dedupe semantics
-- Version: 0003
-- A status change is a distinct observation even when the response body hash is identical.

DROP INDEX IF EXISTS idx_source_observation_dedupe;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_observation_dedupe
ON bond_source_observations(isin, source_provider, raw_payload_hash, http_status);
