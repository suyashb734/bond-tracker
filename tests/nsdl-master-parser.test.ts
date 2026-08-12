import { describe, expect, it } from 'vitest';
import { parseNsdlMasterText, ingestNsdlMasterRows } from '../src/sources/depositories/nsdl-master-parser.js';
import { getObservationsForIsin } from '../src/services/source-observations.js';

describe('NSDL Master Directory Parser', () => {
  it('parses NSDL master lines and extracts valid ISINs', () => {
    const content = `INE001A07015|HOUSING DEVELOPMENT FINANCE CORPORATION LIMITED|DEBT\nINE002A07809|RELIANCE INDUSTRIES LIMITED|DEBT`;
    const rows = parseNsdlMasterText(content);

    expect(rows).toHaveLength(2);
    expect(rows[0].isin).toBe('INE001A07015');
    expect(rows[0].company_name).toBe('HOUSING DEVELOPMENT FINANCE CORPORATION LIMITED');
  });

  it('handles reverse column order and quoted commas correctly', () => {
    const content = `"TATA MOTORS, LIMITED",INE001A07015,DEBT`;
    const rows = parseNsdlMasterText(content);

    expect(rows).toHaveLength(1);
    expect(rows[0].isin).toBe('INE001A07015');
    expect(rows[0].company_name).toBe('TATA MOTORS, LIMITED');
  });

  it('correctly parses company names that contain NCD, BOND, or CP as substrings', () => {
    const content = `INE001A07015|NCDEX LIMITED|DEBT`;
    const rows = parseNsdlMasterText(content);

    expect(rows).toHaveLength(1);
    expect(rows[0].isin).toBe('INE001A07015');
    expect(rows[0].company_name).toBe('NCDEX LIMITED');
  });

  it('ingests NSDL rows into bond_instruments and logs source observations', () => {
    const content = `INE999Z07999|TEST NSDL ISSUER|DEBT`;
    const rows = parseNsdlMasterText(content);
    const ingested = ingestNsdlMasterRows(rows, content);

    expect(ingested).toBe(1);

    const obs = getObservationsForIsin('INE999Z07999');
    expect(obs.some((o) => o.source_provider === 'nsdl_master')).toBe(true);
  });
});
