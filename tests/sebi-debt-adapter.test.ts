import { describe, expect, it } from 'vitest';
import { parseSebiDebtCategoryHtml, sebiItemToNcdPublicIssue } from '../src/sources/sebi/sebi-debt-adapter.js';
import { upsertNcdPublicIssue } from '../src/services/ncd-ipo-sync.js';
import { initDatabase, getDatabase } from '../src/db/index.js';

initDatabase();
const db = getDatabase();

describe('SEBI Debt Offerings Adapter (ssid=17)', () => {
  it('parses real SEBI debt offering disclosures correctly', () => {
    const html = `
      <a href="/filings/debt-offer-document/jul-2026/indel-money-ltd-draft-prospectus_103065.html">Indel Money Ltd – Draft Prospectus</a>
      <a href="/filings/debt-offer-document/may-2026/edelweiss-financial-services-limited-draft-prospectus_101762.html">Edelweiss Financial Services Limited – Draft Prospectus</a>
      <a href="/filings/debt-offer-document/may-2026/kosamattam-finance-limited-prospectus_101482.html">Kosamattam Finance Limited – Prospectus</a>
    `;

    const items = parseSebiDebtCategoryHtml(html);
    expect(items).toHaveLength(3);
    expect(items[0].issuer_name).toBe('Indel Money Ltd');
    expect(items[0].lifecycle_stage).toBe('draft_prospectus');
    expect(items[1].issuer_name).toBe('Edelweiss Financial Services Limited');
    expect(items[2].issuer_name).toBe('Kosamattam Finance Limited');
    expect(items[2].lifecycle_stage).toBe('open_subscription');
  });

  it('converts item and upserts into ncd_public_issues in SQLite', () => {
    const html = `<a href="/filings/debt-offer-document/jul-2026/test-indel-money-draft_1.html">Test Indel Money Ltd – Draft Prospectus</a>`;
    const items = parseSebiDebtCategoryHtml(html);
    expect(items).toHaveLength(1);

    const record = sebiItemToNcdPublicIssue(items[0]);
    upsertNcdPublicIssue(record);

    const row = db.prepare('SELECT * FROM ncd_public_issues WHERE issue_id = ?').get(record.issue_id) as any;
    expect(row).toBeDefined();
    expect(row.issuer_name).toBe('Test Indel Money Ltd');
    expect(row.lifecycle_stage).toBe('draft_prospectus');

    // Clean up test row
    db.prepare('DELETE FROM ncd_public_issues WHERE issue_id = ?').run(record.issue_id);
  });
});
