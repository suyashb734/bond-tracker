import { getDatabase, initDatabase } from '../src/db/index.js';

export function linkNcdIpoIsins(): { total_linked: number; linked_issues: Array<{ issue_id: string; isins: string[] }> } {
  initDatabase();
  const db = getDatabase();

  const unlinkedIssues = db.prepare(`
    SELECT issue_id, issuer_name
    FROM ncd_public_issues
    WHERE assigned_isins IS NULL OR assigned_isins = '' OR assigned_isins = '[]'
  `).all() as Array<{ issue_id: string; issuer_name: string }>;

  const findIsinStmt = db.prepare(`
    SELECT isin
    FROM bond_instruments
    WHERE UPPER(issuer_name) LIKE UPPER(?)
       OR UPPER(?) LIKE UPPER(issuer_name)
    LIMIT 20
  `);

  const updateIssueStmt = db.prepare(`
    UPDATE ncd_public_issues
    SET assigned_isins = ?,
        lifecycle_stage = 'allotted_and_listed',
        updated_at = CURRENT_TIMESTAMP
    WHERE issue_id = ?
  `);

  let totalLinked = 0;
  const linkedIssues: Array<{ issue_id: string; isins: string[] }> = [];

  const tx = db.transaction(() => {
    for (const issue of unlinkedIssues) {
      const matchPattern = `%${issue.issuer_name.replace(/(LIMITED|LTD|PRIVATE|PVT|PUBLIC|ISSUE)/gi, '').trim()}%`;
      const matches = findIsinStmt.all(matchPattern, `%${issue.issuer_name}%`) as Array<{ isin: string }>;
      if (matches.length > 0) {
        const isinList = matches.map((m) => m.isin);
        updateIssueStmt.run(JSON.stringify(isinList), issue.issue_id);
        totalLinked += 1;
        linkedIssues.push({ issue_id: issue.issue_id, isins: isinList });
      }
    }
  });

  tx();

  return { total_linked: totalLinked, linked_issues: linkedIssues };
}

if (process.argv[1] && process.argv[1].includes('link-ncd-ipo-isins')) {
  const res = linkNcdIpoIsins();
  console.log('NCD IPO ISIN Linking Complete!', JSON.stringify(res, null, 2));
}
