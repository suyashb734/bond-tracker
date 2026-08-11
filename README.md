# Bond Tracker

Open-source, local-first, provider-agnostic Indian Corporate Bond & NCD IPO Aggregator and Analytics System.

## Architecture

1. **National ISIN Reference Universe:** Aggregates and normalizes corporate debenture ISINs across CDSL, NSDL, BSE, NSE, and Bond Central.
2. **NCD IPO Lifecycle State Machine:** Tracks public debt issues from draft prospectuses through open subscription, allotment, and listing.
3. **Contractual Terms & Cashflow Generator:** Parses Information Memorandums (IMs) and Key Information Documents (KIDs) into unitized cashflow events ($10,000$ face value basis).
4. **Broker Price & YTM Aggregator:** Standardizes secondary market clean/dirty prices, accrued interest, lot sizes, and Yield to Maturity (YTM) across OBPPs.

## Quick Start

```bash
npm install
npm run test
npm run build
```

## Privacy & Isolation Contract

This project contains **100% public reference and market data only**. It contains zero personal portfolio holdings, bank transactions, PANs, DP/client IDs, account credentials, or user identifiers.
