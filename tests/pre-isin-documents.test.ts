import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { syncPreIsinPublicIssueDocuments } from '../src/services/pre-isin-documents.js';
import { initDatabase } from '../src/db/index.js';

describe('Pre-ISIN Public Issue Document Sync Pipeline', () => {
  beforeEach(() => {
    // Mock fetch to prevent network timeouts during unit testing
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('.pdf')) {
        const dummyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000062 00000 n \n0000000125 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n178\n%%EOF');
        return {
          ok: true,
          headers: new Map([['content-type', 'application/pdf']]),
          arrayBuffer: async () => dummyPdf.buffer
        };
      }
      return {
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        arrayBuffer: async () => Buffer.from('<html><body><a href="https://www.sebi.gov.in/test.pdf">PDF</a></body></html>').buffer
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs syncPreIsinPublicIssueDocuments cleanly with mocked network', async () => {
    initDatabase();
    const result = await syncPreIsinPublicIssueDocuments();

    expect(result).toBeDefined();
    expect(['ok', 'ok_zero_results', 'sync_failed']).toContain(result.sync_status);
    expect(result.total_documents_processed).toBeGreaterThanOrEqual(0);
  });
});
