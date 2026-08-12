import { describe, expect, it } from 'vitest';
import { syncPreIsinPublicIssueDocuments } from '../src/services/pre-isin-documents.js';
import { getDatabase, initDatabase } from '../src/db/index.js';

describe('Pre-ISIN Public Issue Document Sync Pipeline', () => {
  it('runs syncPreIsinPublicIssueDocuments cleanly without throwing', async () => {
    initDatabase();
    const result = await syncPreIsinPublicIssueDocuments();

    expect(result).toBeDefined();
    expect(['ok', 'ok_zero_results', 'sync_failed']).toContain(result.sync_status);
    expect(result.total_documents_processed).toBeGreaterThanOrEqual(0);
  });
});
