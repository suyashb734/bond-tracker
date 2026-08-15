import { getDatabase, initDatabase } from '../src/db/index.js';

export function backfillSecurityTypes(): { total_updated: number; breakdown: Record<string, number> } {
  initDatabase();
  const db = getDatabase();

  const updateGSecStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'GOVERNMENT_SECURITY'
    WHERE isin LIKE 'IN00%' OR isin LIKE 'IN1%' OR isin LIKE 'IN2%' OR isin LIKE 'IN3%' OR isin LIKE 'IN4%'
  `);

  const updateCpStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'COMMERCIAL_PAPER'
    WHERE isin LIKE 'INE%14%' AND (security_type IS NULL OR security_type = 'CORPORATE_BOND' OR security_type = 'UNKNOWN')
  `);

  const updateCdStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'CERTIFICATE_OF_DEPOSIT'
    WHERE isin LIKE 'INE%16%' AND (security_type IS NULL OR security_type = 'CORPORATE_BOND' OR security_type = 'UNKNOWN')
  `);

  const updateSecuritisedStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'SECURITISED_DEBT'
    WHERE (isin LIKE 'INE%15%' OR isin LIKE 'INE%18%') AND (security_type IS NULL OR security_type = 'CORPORATE_BOND' OR security_type = 'UNKNOWN')
  `);

  let updated = 0;
  const tx = db.transaction(() => {
    updated += updateGSecStmt.run().changes;
    updated += updateCpStmt.run().changes;
    updated += updateCdStmt.run().changes;
    updated += updateSecuritisedStmt.run().changes;
  });

  tx();

  const counts = db.prepare(`
    SELECT security_type, COUNT(*) as c
    FROM bond_instruments
    GROUP BY security_type
  `).all() as Array<{ security_type: string; c: number }>;

  const breakdown: Record<string, number> = {};
  for (const row of counts) {
    breakdown[row.security_type ?? 'UNKNOWN'] = row.c;
  }

  return { total_updated: updated, breakdown };
}

if (process.argv[1] && process.argv[1].includes('backfill-security-types')) {
  const res = backfillSecurityTypes();
  console.log('Backfill Complete!', JSON.stringify(res, null, 2));
}
