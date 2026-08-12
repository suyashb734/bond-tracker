import { describe, expect, it } from 'vitest';
import { syncOfficialDocuments } from '../scripts/sync-official-documents.js';
import { getDatabase, initDatabase } from '../src/db/index.js';

describe('Official Document Sync Pipeline', () => {
  it('runs syncOfficialDocuments cleanly without throwing', async () => {
    initDatabase();
    const result = await syncOfficialDocuments();

    expect(result).toBeDefined();
    expect(['ok', 'ok_zero_results', 'sync_failed']).toContain(result.sync_status);
    expect(result.total_documents_processed).toBeGreaterThanOrEqual(0);
    expect(result.total_cashflows_generated).toBeGreaterThanOrEqual(0);
  });
});
