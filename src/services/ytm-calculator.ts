import { UnitizedCashflow } from './cashflow-generator.js';

export type YtmCalculationInput = {
  settlement_date: string; // ISO YYYY-MM-DD
  dirty_price: number;     // Dirty consideration per unit
  cashflows: UnitizedCashflow[];
  day_count_convention?: string;
};

export type YtmResult = {
  ytm_annual_percentage: number | null;
  converged: boolean;
  iterations: number;
  total_future_cashflows: number;
  day_count_used: string;
};

export function calculateCashflowYtm(input: YtmCalculationInput): YtmResult {
  const convention = input.day_count_convention || 'Actual/365';

  if (!Number.isFinite(input.dirty_price) || input.dirty_price <= 0 || !input.cashflows || input.cashflows.length === 0) {
    return { ytm_annual_percentage: null, converged: false, iterations: 0, total_future_cashflows: 0, day_count_used: convention };
  }

  const settlementMs = new Date(input.settlement_date).getTime();
  if (isNaN(settlementMs)) {
    return { ytm_annual_percentage: null, converged: false, iterations: 0, total_future_cashflows: 0, day_count_used: convention };
  }

  // Filter future cashflows occurring strictly after settlement date
  const futureFlows = input.cashflows
    .map((cf) => {
      const dueMs = new Date(cf.due_date).getTime();
      const yearFraction = calculateYearFraction(settlementMs, dueMs, convention);
      const totalAmount = cf.gross_coupon_per_unit + cf.principal_redemption_per_unit;
      return { dueMs, yearFraction, totalAmount };
    })
    .filter((cf) => !isNaN(cf.dueMs) && cf.dueMs > settlementMs && cf.totalAmount > 0)
    .sort((a, b) => a.yearFraction - b.yearFraction);

  if (futureFlows.length === 0) {
    return { ytm_annual_percentage: null, converged: false, iterations: 0, total_future_cashflows: 0, day_count_used: convention };
  }

  // Newton-Raphson YTM Solver
  let y = 0.10; // Initial guess: 10% annual yield
  const tolerance = 0.0001; // 0.0001 = 0.01% = 1 basis point convergence threshold
  const maxIterations = 100;
  let iterations = 0;
  let converged = false;

  for (let i = 0; i < maxIterations; i++) {
    iterations += 1;
    let npv = -input.dirty_price;
    let dNpv = 0;

    for (const flow of futureFlows) {
      const df = Math.pow(1 + y, -flow.yearFraction);
      npv += flow.totalAmount * df;
      dNpv -= flow.yearFraction * flow.totalAmount * Math.pow(1 + y, -flow.yearFraction - 1);
    }

    if (Math.abs(npv) < tolerance) {
      converged = true;
      break;
    }

    if (Math.abs(dNpv) < 1e-12) break; // Avoid division by near-zero derivative

    const nextY = y - npv / dNpv;
    if (!Number.isFinite(nextY) || nextY <= -0.99 || nextY > 5.0) break; // Unrealistic bounds guard

    if (Math.abs(nextY - y) < 1e-6) {
      y = nextY;
      converged = true;
      break;
    }

    y = nextY;
  }

  return {
    ytm_annual_percentage: converged ? Math.round(y * 100000) / 1000 : null,
    converged,
    iterations,
    total_future_cashflows: futureFlows.length,
    day_count_used: convention
  };
}

function calculateYearFraction(startMs: number, endMs: number, convention: string): number {
  const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
  if (/30\s*\/\s*360/i.test(convention)) {
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    const d1 = Math.min(30, startDate.getDate());
    const d2 = endDate.getDate() === 31 && d1 >= 30 ? 30 : endDate.getDate();
    const days = (endDate.getFullYear() - startDate.getFullYear()) * 360 + (endDate.getMonth() - startDate.getMonth()) * 30 + (d2 - d1);
    return days / 360;
  }
  if (/actual\s*\/\s*360/i.test(convention)) {
    return diffDays / 360;
  }
  return diffDays / 365;
}
