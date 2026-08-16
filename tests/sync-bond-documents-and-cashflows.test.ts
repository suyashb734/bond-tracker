import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase } from '../src/db/index.js';
import { syncBondDocumentsAndCashflows } from '../scripts/sync-bond-documents-and-cashflows.js';

describe('Document Ingestion & Cashflow Resolution Engine', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doc-cf-test-'));
    dbPath = join(tmpDir, 'test_doc_cf.db');
    process.env.BOND_TRACKER_DB_PATH = dbPath;
    process.env.BOND_TRACKER_EVIDENCE_DIR = join(tmpDir, 'evidence');
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.BOND_TRACKER_DB_PATH;
    delete process.env.BOND_TRACKER_EVIDENCE_DIR;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('archives documents and generates unitized cashflows in isolated DB', () => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO bond_instruments (isin, issuer_name, security_type, face_value, coupon_rate, maturity_date, source_provider)
      VALUES ('INE123A07010', 'TEST ISSUER', 'CORPORATE_BOND', 100000, 11.5, '2028-12-31', 'test_provider')
    `).run();

    const res = syncBondDocumentsAndCashflows();
    expect(res.documents_archived).toBe(1);
    expect(res.cashflows_generated).toBe(1);

    const doc = db.prepare('SELECT * FROM bond_documents WHERE isin = ?').get('INE123A07010') as any;
    expect(doc).toBeDefined();
    expect(doc.document_type).toBe('TERM_SHEET');
    expect(doc.sha256).toBeDefined();

    const cf = db.prepare('SELECT * FROM bond_unitized_cashflows WHERE isin = ?').get('INE123A07010') as any;
    expect(cf).toBeDefined();
    expect(cf.gross_coupon_per_unit).toBe(1150);
    expect(cf.principal_redemption_per_unit).toBe(10000);
  });
});
