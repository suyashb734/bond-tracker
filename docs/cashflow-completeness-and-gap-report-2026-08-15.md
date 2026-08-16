# Global Cashflow Completeness & Gap Analysis Report

**Date:** 2026-08-15  
**Repository:** `suyashb734/bond-tracker`  
**Total Catalog Size:** 59,096 verified fixed-income ISINs

---

## 1. Executive Summary

No, we do **not** have 100% generated cashflow schedules for all 59,096 instruments in the catalog. 

Currently:
- **17,675 ISINs** (**29.91%** of total catalog) have 100% complete, mathematically generated unitized cashflow schedules on a standard ₹10,000 unit face value basis.
- **41.1% of Corporate Bonds & NCDs** (16,442 of 40,014) have complete generated cashflows.
- **Fail-Closed Policy:** Bond Tracker **never fabricates** coupon rates, payment frequencies, or maturity dates when official depository files publish `NULL`.

---

## 2. Security Type Breakdown & Cashflow Readiness

| Security Type | Total Catalog Count | Cashflows Generated | Coverage % | Primary Source / Reason for Un-generated Cashflows |
| :--- | ---: | ---: | ---: | :--- |
| **Corporate Bonds & NCDs** | 40,014 | **16,442** | **41.1%** | 23,572 private-placement NCDs have `NULL` coupon rates in NSDL basic file. Enriched via CDSL per-ISIN detail fetcher. |
| **Government Securities & SDLs** | 7,487 | **0** | **0.0%** | Semi-annual RBI auction coupons; requires RBI auction notification scraper. |
| **Securitised Debt (PTCs)** | 7,119 | **531** | **7.5%** | Amortizing monthly pool principal; requires Trustee Monthly Payment Report parser. |
| **Commercial Papers (CPs)** | 3,143 | **362** | **11.5%** | Short-term zero-coupon discounted instruments; single bullet redemption at maturity. |
| **Certificates of Deposit (CDs)** | 1,333 | **340** | **25.5%** | Short-term money market instruments; single bullet redemption at maturity. |
| **Total** | **59,096** | **17,675** | **29.91%** | — |

---

## 3. Resolution Strategy to Reach 100% Coverage

1. **CDSL ASP.NET Per-ISIN Enrichment (`scripts/enrich-missing-bond-terms.ts`):**
   - Automatically queries `https://www.cdslindia.com/CorporateBond/CorpBondDatabase.aspx?ISIN=<ISIN>` for the 23,572 corporate bonds with `NULL` coupon rates.
2. **RBI G-Sec & SDL Auction Scraper:**
   - Scrapes RBI's official G-Sec master directory for semi-annual coupon dates and benchmark yields for all 7,487 central and state government securities.
3. **Prospectus & Term Sheet PDF Parser (`src/services/pdf-term-sheet-parser.ts`):**
   - Parses official Information Memorandums (IMs) and Key Information Documents (KIDs) downloaded to `/data/bond-tracker-data/evidence/pdfs/`.
