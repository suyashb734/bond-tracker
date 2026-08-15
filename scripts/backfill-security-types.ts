import { getDatabase, initDatabase } from '../src/db/index.js';

export function backfillSecurityTypes(): { total_updated: number; breakdown: Record<string, number> } {
  initDatabase();
  const db = getDatabase();

  // Exact ISIN position matching (1-indexed in SQLite SUBSTR):
  // Characters 1-3: Country/Type (e.g. INE = Company, INF = MF, IN0/IN1/IN2/IN3/IN4 = Govt)
  // Characters 4-7: Issuer Code (e.g. 002A, 413U)
  // Characters 8-9: Security Type Code (01 = Equity, 07 = NCD/Bond, 14 = CP, 16 = CD, 15/18 = PTC)

  const updateGSecStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'GOVERNMENT_SECURITY'
    WHERE (SUBSTR(isin, 1, 3) = 'IN0' OR SUBSTR(isin, 1, 4) IN ('IN10', 'IN20', 'IN30', 'IN40'))
      AND source_provider != 'manual_curation'
  `);

  const updateCpStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'COMMERCIAL_PAPER'
    WHERE SUBSTR(isin, 8, 2) = '14'
      AND source_provider != 'manual_curation'
      AND (security_type IS NULL OR security_type = 'CORPORATE_BOND' OR security_type = 'UNKNOWN')
  `);

  const updateCdStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'CERTIFICATE_OF_DEPOSIT'
    WHERE SUBSTR(isin, 8, 2) = '16'
      AND source_provider != 'manual_curation'
      AND (security_type IS NULL OR security_type = 'CORPORATE_BOND' OR security_type = 'UNKNOWN')
  `);

  const updateSecuritisedStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'SECURITISED_DEBT'
    WHERE SUBSTR(isin, 8, 2) IN ('15', '18')
      AND source_provider != 'manual_curation'
      AND (security_type IS NULL OR security_type = 'CORPORATE_BOND' OR security_type = 'UNKNOWN')
  `);

  // Reset misclassified Equity/Corporate ISINs where position is 07 (Bond)
  const resetBondsStmt = db.prepare(`
    UPDATE bond_instruments
    SET security_type = 'CORPORATE_BOND'
    WHERE SUBSTR(isin, 8, 2) = '07'
      AND source_provider != 'manual_curation'
  `);

  let updated = 0;
  const tx = db.transaction(() => {
    updated += resetBondsStmt.run().changes;
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
