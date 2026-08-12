import { describe, expect, it } from 'vitest';
import { calculateCashflowYtm } from '../src/services/ytm-calculator.js';

describe('Newton-Raphson YTM Calculator', () => {
  it('calculates YTM accurately for a 1-year 10% annual coupon bond at par', () => {
    const settlement = '2026-08-12';
    const cashflows = [
      {
        isin: 'INE002A07809',
        due_date: '2027-08-12',
        gross_coupon_per_unit: 1000,
        principal_redemption_per_unit: 10000,
        unit_face_value: 10000,
        day_count_convention: 'Actual/365'
      }
    ];

    const result = calculateCashflowYtm({
      settlement_date: settlement,
      dirty_price: 10000,
      cashflows,
      day_count_convention: 'Actual/365'
    });

    expect(result.converged).toBe(true);
    expect(result.ytm_annual_percentage).toBeCloseTo(10.0, 1);
  });

  it('calculates higher YTM when dirty price is at a discount', () => {
    const settlement = '2026-08-12';
    const cashflows = [
      {
        isin: 'INE002A07809',
        due_date: '2027-08-12',
        gross_coupon_per_unit: 1000,
        principal_redemption_per_unit: 10000,
        unit_face_value: 10000,
        day_count_convention: 'Actual/365'
      }
    ];

    const result = calculateCashflowYtm({
      settlement_date: settlement,
      dirty_price: 9500, // Discounted price
      cashflows,
      day_count_convention: 'Actual/365'
    });

    expect(result.converged).toBe(true);
    expect(result.ytm_annual_percentage!).toBeGreaterThan(10.0);
  });

  it('returns null YTM when cashflows array is empty or past settlement', () => {
    const result = calculateCashflowYtm({
      settlement_date: '2026-08-12',
      dirty_price: 10000,
      cashflows: [],
      day_count_convention: 'Actual/365'
    });

    expect(result.converged).toBe(false);
    expect(result.ytm_annual_percentage).toBeNull();
  });
});
