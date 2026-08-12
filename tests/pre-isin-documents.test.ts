import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { syncPreIsinPublicIssueDocuments } from '../src/services/pre-isin-documents.js';
import { initDatabase, getDatabase } from '../src/db/index.js';

describe('Pre-ISIN Public Issue Document Sync Pipeline', () => {
  let tempDir: string;
  let tempDbPath: string;
  let tempEvidenceDir: string;

  beforeEach(() => {
    // Isolate test database and evidence directory to /tmp
    tempDir = mkdtempSync(join(tmpdir(), 'bond-tracker-test-'));
    tempDbPath = join(tempDir, 'test_bond_tracker.db');
    tempEvidenceDir = join(tempDir, 'evidence', 'pdfs');

    process.env.BOND_TRACKER_DB_PATH = tempDbPath;
    process.env.BOND_TRACKER_EVIDENCE_DIR = tempEvidenceDir;

    initDatabase();
    const db = getDatabase();

    // Populate minimal seed issue for test
    db.prepare(`
      INSERT INTO ncd_public_issues (issue_id, issuer_name, prospectus_url)
      VALUES ('TEST-ISSUE-001', 'TEST ISSUER LTD', 'https://www.sebi.gov.in/test.html')
    `).run();

    // Mock fetch to prevent live network calls during unit tests
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
        arrayBuffer: async () => Buffer.from('<html><body><a href="https://www.sebi.gov.in/test.pdf">PDF Link</a></body></html>').buffer
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BOND_TRACKER_DB_PATH;
    delete process.env.BOND_TRACKER_EVIDENCE_DIR;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs syncPreIsinPublicIssueDocuments cleanly in isolated temporary database', async () => {
    const result = await syncPreIsinPublicIssueDocuments();

    expect(result).toBeDefined();
    expect(['ok', 'ok_zero_results']).toContain(result.sync_status);
  });
});
