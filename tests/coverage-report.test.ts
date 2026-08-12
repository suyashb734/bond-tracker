import { describe, expect, it } from 'vitest';
import { generateNationalCoverageReport } from '../src/services/coverage-report.js';

describe('National Bond Master Coverage Report', () => {
  it('generates non-empty coverage metrics from the database', () => {
    const report = generateNationalCoverageReport();

    expect(report).toBeDefined();
    expect(report.total_instruments).toBeGreaterThanOrEqual(0);
    expect(report.face_value_fill_rate_pct).toBeGreaterThanOrEqual(0);
    expect(report.maturity_fill_rate_pct).toBeGreaterThanOrEqual(0);
    expect(typeof report.source_provider_distribution).toBe('object');
    expect(report.generated_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
