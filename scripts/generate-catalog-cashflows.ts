import { getDatabase, initDatabase } from '../src/db/index.js';
import { generateUnitizedCashflows, persistUnitizedCashflows } from '../src/services/cashflow-generator.js';

export function generateCatalogCashflows(): { total_generated: number; isins_processed: number } {
  initDatabase();
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT isin, face_value, coupon_rate, maturity_date
    FROM bond_instruments
    WHERE face_value IS NOT NULL
      AND coupon_rate IS NOT NULL
      AND maturity_date IS NOT NULL
  `).all() as Array<{ isin: string; face_value: number; coupon_rate: number; maturity_date: string }>;

  let totalGenerated = 0;
  let isinsProcessed = 0;

  const deleteStmt = db.prepare('DELETE FROM bond_unitized_cashflows WHERE isin = ?');

  for (const row of rows) {
    if (!row.maturity_date || !row.face_value || !row.coupon_rate) continue;

    // Build annual/monthly/quarterly redemption event at maturity
    const redemptionEvents = [{
      due_date: row.maturity_date.slice(0, 10),
      principal_amount: row.face_value
    }];

    try {
      const flows = generateUnitizedCashflows({
        isin: row.isin,
        face_value: row.face_value,
        coupon_rate: row.coupon_rate,
        frequency: 'annually', // Default conservative frequency for depository master records
        day_count_convention: 'ACT/365',
        redemption_events: redemptionEvents,
        unit_face_value: 10000
      });

      deleteStmt.run(row.isin);
      persistUnitizedCashflows(flows);

      totalGenerated += flows.length;
      isinsProcessed += 1;
    } catch (e) {
      // Skip invalid parameters
    }
  }

  return { total_generated: totalGenerated, isins_processed: isinsProcessed };
}
