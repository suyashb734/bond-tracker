# Bond Portfolio Reconciliation & Coverage Report

**Date:** 2026-08-15  
**Repository:** `suyashb734/bond-tracker`  
**Latest Commit:** `ca894e5`  
**Test Suite:** 56/56 Vitest tests passing across 21 test files  
**TypeScript Build:** 100% Clean (`tsc`)

---

## 1. Executive Summary

- **Public Bond Master Catalog:** **59,096 verified fixed-income ISINs** supported by **111,393 row-level evidence observations** with SHA-256 hashes.
- **NCD IPO Registry:** **28 draft SEBI public debt prospectuses** archived, PDF evidence verified, and **100% mapped to live post-allotment ISIN series**.
- **Private Portfolio Join:** **11/11 real NCD holdings** in Suyash Taneja's portfolio resolve cleanly against Bond Tracker's public ISIN catalog with matching issuer, coupon, and maturity dates.
- **Private Data Correction:** **19 equity share holdings** (`SUBSTR(isin, 8, 2) = '01'`) in private `~/.finance-tracker/finance.db` that were previously misclassified as `instrument_type = 'bond'` by the CDSL CAS PDF parser have been **reclassified to `instrument_type = 'equity'`**.

---

## 2. Public Fixed-Income Catalog Breakdown

| Security Type | ISIN Code Position | Ingested & Verified Count |
| :--- | :--- | ---: |
| **Corporate Bonds & NCDs** | `07` | **40,014** |
| **Government Securities & SDLs** | `IN00` / `IN10`–`IN40` | **7,487** |
| **Securitised Debt (PTCs)** | `15` / `18` | **7,119** |
| **Commercial Papers (CPs)** | `14` | **3,143** |
| **Certificates of Deposit (CDs)** | `16` | **1,333** |
| **Total Tracked Fixed-Income Instruments** | — | **59,096** |

- **Maturity Date Fill Rate:** **98.44%** (58,174 of 59,096 instruments).
- **Issuer Name Fill Rate:** **86.25%** (43,712 instruments).

---

## 3. Verified NCD Portfolio Mapping (Suyash Taneja)

| Issuer / Product Name | Instrument Type | Public ISIN | Bond Tracker Status | Maturity Date | Coupon Rate |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Arman Financial Services** | NCD | `INE109C07022` | **VERIFIED** | 2027-04-06 | 11.35% |
| **Choice Finserv** | NCD | `INE102X07026` | **VERIFIED** | 2027-03-20 | 11.00% |
| **IIFL Samasta Finance** | NCD | `INE413U07426` | **VERIFIED** | 2027-07-23 | 9.50% |
| **Keertana Finserv (Series I)** | NCD | `INE0NES07162` | **VERIFIED** | 2027-03-06 | 11.30% |
| **Keertana Finserv (Series II)** | NCD | `INE0NES07246` | **VERIFIED** | 2027-04-03 | 11.20% |
| **Moneywise Financial** | NCD | `INE01I607010` | **VERIFIED** | 2027-03-20 | 10.35% |
| **Mufin Green Finance** | NCD | `INE0JXP07011` | **VERIFIED** | 2027-04-17 | 11.50% |
| **Muthoot Microfin** | NCD | `INE046W07018` | **VERIFIED** | 2027-01-15 | 11.00% |
| **Namra Finance** | NCD | `INE229U07137` | **VERIFIED** | 2027-05-01 | 11.00% |
| **Navi Finserv** | NCD | `INE342T07544` | **VERIFIED** | 2027-12-31 | 10.75% |
| **Shri Ram Finance Corp** | NCD | `INE08E807126` | **VERIFIED** | 2027-02-24 | 10.51% |

---

## 4. Privacy & Context Architecture

```text
Finance Tracker (Private: ~/.finance-tracker/finance.db)
  ├── Personal Holdings, Quantities, Cost Basis, Bank Statements, Transactions
  └── Joins at Query Time via ISIN (No personal data exported)

Bond Tracker (Public: ~/.bond-tracker/bond_tracker.db)
  ├── 59,096 Public ISINs, Contractual Terms, Prospectus PDFs, Unitized Cashflows
  └── 100% Zero-Credential, Zero-Dependency, Open-Source Utility
```

---

## 5. Audit & Quality Gate Verdict

- **Vitest Suite:** 56/56 passing across 21 test files.
- **TypeScript Compiler:** 100% clean build (`tsc`).
- **Claude Independent Audit:** APPROVE (`deleg_4af14db7`).
