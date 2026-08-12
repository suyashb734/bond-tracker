import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../src/db/index.js';
import { ingestUdiffIsinRows, parseUdiffIsinCsv } from '../src/sources/depositories/udiff-isin-parser.js';
import { getObservationsForIsin } from '../src/services/source-observations.js';

const TEST_DB_PATH = join(tmpdir(), `bond_tracker_udiff_test_${Date.now()}.db`);

beforeAll(() => {
  process.env.BOND_TRACKER_DB_PATH = TEST_DB_PATH;
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  delete process.env.BOND_TRACKER_DB_PATH;
  for (const suffix of ['', '-shm', '-wal']) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
});

describe('SEBI UDiFF ISIN Master Parser & Ingestion', () => {
  it('parses official UDiFF CSV columns correctly', () => {
    const csv = `Src,CntrlSctiesDpstryPtcpt,LineNb,ISIN,ISINShrtNm,ISINDesc,IssrOrgId,IssrOrgNm,FinInstrmTp,SctySts,BookgBsis,IsseDt,Regar,RegarNm,SEBIRgnFrDt,SEBIRgnToDt,CntctNm,CntctDesg,ISINShrNm,ISINScndNm,ISINLastNm,ISINPstlAdr1,ISINPstlAdr2,ISINPstlAdr3,ISINCity,ISINCtrySubDvsn,ISINCtry,ISINPstCd,ISINPhneNb1,ISINPhneNb2,ISINFaxNb,ISINEmailAdr,MtrtyDt,ConvsDt,DcmlAllwd,DmtrlsdRegdScties,RmtrlsdRegdScties,ClssfctnFinInstrm,ParVal,PdAmt
CDSL,000001,1,INE002A07809,RELIANCE DEBT 28,RELIANCE NCD 2028,1001,RELIANCE INDUSTRIES LIMITED,DEBT,ACT,DFT,2020-06-15,101,LINK INTIME INDIA PRIVATE LIMITED,,,MR. X,CS,LINK INTIME,,,ADDR1,ADDR2,ADDR3,MUMBAI,MAHARASHTRA,INDIA,400001,022-1234,022-1234,022-1234,info@example.com,2028-06-15,,NA,NO,NO,LST,100000.000,100000.000
CDSL,000001,2,INE002A01018,RELIANCE EQ,RELIANCE EQUITY,1001,RELIANCE INDUSTRIES LIMITED,EQTY,ACT,DFT,2000-01-01,101,LINK INTIME INDIA PRIVATE LIMITED,,,MR. X,CS,LINK INTIME,,,ADDR1,ADDR2,ADDR3,MUMBAI,MAHARASHTRA,INDIA,400001,022-1234,022-1234,022-1234,info@example.com,,,NA,NO,NO,LST,10.000,10.000`;

    const rows = parseUdiffIsinCsv(csv, 'cdsl_udiff');
    expect(rows).toHaveLength(1); // Equity row filtered out, debt row kept
    expect(rows[0].isin).toBe('INE002A07809');
    expect(rows[0].issuer_name).toBe('RELIANCE INDUSTRIES LIMITED');
    expect(rows[0].allotment_date).toBe('2020-06-15');
    expect(rows[0].maturity_date).toBe('2028-06-15');
    expect(rows[0].face_value).toBe(100000);
    expect(rows[0].rta_name).toBe('LINK INTIME INDIA PRIVATE LIMITED');
  });

  it('accepts State Development Loans (IN1 prefix) and excludes preference shares (PREF)', () => {
    const csv = `Src,CntrlSctiesDpstryPtcpt,LineNb,ISIN,ISINShrtNm,ISINDesc,IssrOrgId,IssrOrgNm,FinInstrmTp,SctySts,BookgBsis,IsseDt,Regar,RegarNm,SEBIRgnFrDt,SEBIRgnToDt,CntctNm,CntctDesg,ISINShrNm,ISINScndNm,ISINLastNm,ISINPstlAdr1,ISINPstlAdr2,ISINPstlAdr3,ISINCity,ISINCtrySubDvsn,ISINCtry,ISINPstCd,ISINPhneNb1,ISINPhneNb2,ISINFaxNb,ISINEmailAdr,MtrtyDt,ConvsDt,DcmlAllwd,DmtrlsdRegdScties,RmtrlsdRegdScties,ClssfctnFinInstrm,ParVal,PdAmt
CDSL,000001,1,IN1220200012,GOVT MAHARASHTRA,MAHARASHTRA SDL 2030,1001,GOVERNMENT OF MAHARASHTRA,DEBT,ACT,DFT,2020-01-01,101,RBI,,,MR. X,CS,RBI,,,ADDR1,ADDR2,ADDR3,MUMBAI,MAHARASHTRA,INDIA,400001,022-1234,022-1234,022-1234,info@rbi.org,2030-01-01,,NA,NO,NO,LST,100.000,100.000
CDSL,000001,2,INE999A04010,COMPANY PREF,REDEEMABLE PREFERENCE SHARES,1001,SOME COMPANY LIMITED,PREF,ACT,DFT,2020-01-01,101,LINK INTIME,,,MR. X,CS,LINK INTIME,,,ADDR1,ADDR2,ADDR3,MUMBAI,MAHARASHTRA,INDIA,400001,022-1234,022-1234,022-1234,info@example.com,2025-01-01,,NA,NO,NO,LST,100.000,100.000`;

    const rows = parseUdiffIsinCsv(csv, 'cdsl_udiff');
    expect(rows).toHaveLength(1);
    expect(rows[0].isin).toBe('IN1220200012');
    expect(rows[0].issuer_name).toBe('GOVERNMENT OF MAHARASHTRA');
  });

  it('ingests UDiFF rows into bond_instruments and logs source observations', () => {
    const csv = `Src,CntrlSctiesDpstryPtcpt,LineNb,ISIN,ISINShrtNm,ISINDesc,IssrOrgId,IssrOrgNm,FinInstrmTp,SctySts,BookgBsis,IsseDt,Regar,RegarNm,SEBIRgnFrDt,SEBIRgnToDt,CntctNm,CntctDesg,ISINShrNm,ISINScndNm,ISINLastNm,ISINPstlAdr1,ISINPstlAdr2,ISINPstlAdr3,ISINCity,ISINCtrySubDvsn,ISINCtry,ISINPstCd,ISINPhneNb1,ISINPhneNb2,ISINFaxNb,ISINEmailAdr,MtrtyDt,ConvsDt,DcmlAllwd,DmtrlsdRegdScties,RmtrlsdRegdScties,ClssfctnFinInstrm,ParVal,PdAmt
NSDL,000001,1,INE101Q07BU7,MUTHOOT DEBT 28,MUTHOOT NCD 2028,1002,MUTHOOT FINANCE LIMITED,DEBT,ACT,DFT,2021-01-13,101,LINK INTIME INDIA PRIVATE LIMITED,,,MR. Y,CS,LINK INTIME,,,ADDR1,ADDR2,ADDR3,KOCHI,KERALA,INDIA,682018,0484-1234,0484-1234,0484-1234,info@muthoot.com,2028-01-13,,NA,NO,NO,LST,10000.000,10000.000`;

    const rows = parseUdiffIsinCsv(csv, 'nsdl_udiff');
    const ingested = ingestUdiffIsinRows(rows, csv);

    expect(ingested).toBe(1);

    const db = getDatabase();
    const inst = db.prepare('SELECT * FROM bond_instruments WHERE isin = ?').get('INE101Q07BU7') as any;
    expect(inst).toBeDefined();
    expect(inst.issuer_name).toBe('MUTHOOT FINANCE LIMITED');

    const obs = getObservationsForIsin('INE101Q07BU7');
    expect(obs.some((o) => o.source_provider === 'nsdl_udiff')).toBe(true);
  });
});
