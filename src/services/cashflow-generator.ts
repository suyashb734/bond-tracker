import { getDatabase, initDatabase } from '../db/index.js';

export type UnitizedCashflow = {
  isin: string;
  due_date: string;
  gross_coupon_per_unit: number;
  principal_redemption_per_unit: number;
  unit_face_value: number;
  day_count_convention: string;
  evidence_doc_id?: string | null;
};

export function generateUnitizedCashflows(input: {
  isin: string;
  face_value: number;
  coupon_rate: number;
  frequency: 'monthly' | 'quarterly' | 'semi_annually' | 'annually' | 'cumulative' | 'unknown';
  day_count_convention: string;
  redemption_events: Array<{ due_date: string; principal_amount: number | null }>;
  evidence_doc_id?: string | null;
  unit_face_value?: number;
}): UnitizedCashflow[] {
  const unitFaceValue = input.unit_face_value ?? 10000;
  if (!Number.isFinite(input.face_value) || input.face_value <= 0) throw new Error('face_value must be positive');
  if (!Number.isFinite(input.coupon_rate) || input.coupon_rate < 0) throw new Error('coupon_rate must be non-negative');
  if (!Number.isFinite(unitFaceValue) || unitFaceValue <= 0) throw new Error('unit_face_value must be positive');

  const periodsPerYear: Record<string, number> = {
    monthly: 12,
    quarterly: 4,
    semi_annually: 2,
    annually: 1,
    cumulative: 0,
    unknown: 0
  };
  const periods = periodsPerYear[input.frequency];
  const couponPerUnit = periods > 0 ? (unitFaceValue * (input.coupon_rate / 100)) / periods : 0;
  const events = input.redemption_events.length > 0 ? input.redemption_events : [];

  return events.map((event) => ({
    isin: input.isin.trim().toUpperCase(),
    due_date: event.due_date,
    gross_coupon_per_unit: couponPerUnit,
    principal_redemption_per_unit: event.principal_amount === null ? 0 : (event.principal_amount * unitFaceValue) / input.face_value,
    unit_face_value: unitFaceValue,
    day_count_convention: input.day_count_convention,
    evidence_doc_id: input.evidence_doc_id ?? null
  }));
}

export function persistUnitizedCashflows(cashflows: UnitizedCashflow[]): number {
  if (cashflows.length === 0) return 0;
  initDatabase();
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO bond_unitized_cashflows
      (isin, due_date, gross_coupon_per_unit, principal_redemption_per_unit, unit_face_value, day_count_convention, evidence_doc_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const flow of cashflows) {
      stmt.run(flow.isin, flow.due_date, flow.gross_coupon_per_unit, flow.principal_redemption_per_unit, flow.unit_face_value, flow.day_count_convention, flow.evidence_doc_id ?? null);
    }
  });
  tx();
  return cashflows.length;
}
