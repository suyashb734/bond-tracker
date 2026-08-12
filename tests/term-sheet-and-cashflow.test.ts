import { describe, expect, it } from 'vitest';
import { generateUnitizedCashflows } from '../src/services/cashflow-generator.js';
import { parseTermSheetPdf } from '../src/services/pdf-term-sheet-parser.js';

describe('Phase D deterministic term-sheet parser', () => {
  it('extracts terms from a plain-text fixture without fabricating unknown fields', async () => {
    const fixture = Buffer.from('Face Value: INR 10,000\nCoupon Rate: 9.25%\nPayment Frequency: Monthly\nDay Count Convention: Actual/365\nMaturity Date: 13 January 2028\nRedemption: 13/01/2028 - 100% INR 10,000');
    const parsed = await parseTermSheetPdf(fixture);

    expect(parsed.face_value).toBe(10000);
    expect(parsed.coupon_rate).toBe(9.25);
    expect(parsed.payout_frequency).toBe('monthly');
    expect(parsed.day_count_convention).toBe('Actual/365');
    expect(parsed.maturity_date).toBe('2028-01-13');
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses labeled line context so preceding marketing mentions do not override real payment frequency', async () => {
    const fixture = Buffer.from('We provide monthly updates and annual reporting.\nPayment Frequency: Quarterly\nFace Value: 10,000');
    const parsed = await parseTermSheetPdf(fixture);

    expect(parsed.payout_frequency).toBe('quarterly');
  });

  it('preserves unknown values when terms are absent', async () => {
    const parsed = await parseTermSheetPdf(Buffer.from('unrelated document content'));
    expect(parsed.face_value).toBeNull();
    expect(parsed.coupon_rate).toBeNull();
    expect(parsed.maturity_date).toBeNull();
    expect(parsed.redemption_events).toEqual([]);
  });
});

describe('Phase D unitized cashflow generator', () => {
  it('generates unitized coupons and principal without personal fields', () => {
    const flows = generateUnitizedCashflows({
      isin: 'ine101q07bu7',
      face_value: 10000,
      coupon_rate: 9.25,
      frequency: 'monthly',
      day_count_convention: 'Actual/365',
      redemption_events: [{ due_date: '2028-01-13', principal_amount: 10000 }]
    });

    expect(flows).toHaveLength(1);
    expect(flows[0].isin).toBe('INE101Q07BU7');
    expect(flows[0].gross_coupon_per_unit).toBeCloseTo(77.0833, 3);
    expect(flows[0].principal_redemption_per_unit).toBe(10000);
    expect(JSON.stringify(flows)).not.toMatch(/owner|quantity|account|portfolio/i);
  });
});
