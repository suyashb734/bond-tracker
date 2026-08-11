import { createHash } from 'node:crypto';
import { getDatabase, initDatabase } from '../db/index.js';

export type SourceObservationRecord = {
  isin: string;
  source_provider: string;
  source_url?: string | null;
  http_status?: number | null;
  parser_version: string;
  raw_payload: string;
};

export function createPayloadHash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

export function recordSourceObservation(record: SourceObservationRecord): number {
  if (!record.isin || typeof record.isin !== 'string' || record.isin.trim() === '') {
    throw new Error('[Source Observation Error] isin is required and must be a non-empty string.');
  }
  if (!record.source_provider || typeof record.source_provider !== 'string' || record.source_provider.trim() === '') {
    throw new Error('[Source Observation Error] source_provider is required and must be a non-empty string.');
  }
  if (!record.raw_payload || typeof record.raw_payload !== 'string') {
    throw new Error('[Source Observation Error] raw_payload is required.');
  }

  initDatabase();
  const db = getDatabase();

  const rawHash = createPayloadHash(record.raw_payload);

  const stmt = db.prepare(`
    INSERT INTO bond_source_observations (
      isin, source_provider, source_url, http_status,
      raw_payload_hash, parser_version, raw_payload, observed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
    ) ON CONFLICT(isin, source_provider, raw_payload_hash) DO NOTHING
  `);

  const result = stmt.run(
    record.isin.trim(),
    record.source_provider.trim(),
    record.source_url ?? null,
    record.http_status ?? 200,
    rawHash,
    record.parser_version,
    record.raw_payload
  );

  if (result.changes === 0) {
    const existing = db.prepare(`
      SELECT id FROM bond_source_observations
      WHERE isin = ? AND source_provider = ? AND raw_payload_hash = ?
    `).get(record.isin.trim(), record.source_provider.trim(), rawHash) as { id: number };
    return existing.id;
  }

  return Number(result.lastInsertRowid);
}

export function getObservationsForIsin(isin: string): Array<Record<string, unknown>> {
  initDatabase();
  const db = getDatabase();
  return db.prepare('SELECT * FROM bond_source_observations WHERE isin = ? ORDER BY observed_at DESC').all(isin) as Array<Record<string, unknown>>;
}
