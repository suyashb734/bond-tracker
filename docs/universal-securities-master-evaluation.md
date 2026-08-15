# Universal Indian Securities Master — Value, Agent Query Patterns & Architectural Positioning

**Date:** 2026-08-15
**Scope:** Strategic evaluation for expanding `bond-tracker` (59,096 verified fixed-income ISINs, 111,393 provenance observations) into a multi-asset `universal_securities_master` covering all publicly identifiable Indian ISIN-bearing securities.

---

## 1. Why this dataset is uniquely valuable

**The gap it fills:** no verified public/open-source project currently unions NSDL, CDSL, NSE, BSE, SEBI, and AMFI with row-level provenance, conflict resolution, and lifecycle history (confirmed via research in `indian-bond-data-ingestion` skill — see `references/universal-securities-research.md`). Adjacent projects are all single-source or single-purpose:

| Existing source | What it covers | What it lacks |
|---|---|---|
| `captn3m0/india-isin-data` | NSDL-derived daily snapshot | Single source, no CDSL/NSE/BSE cross-validation, no provenance/hashes, no lifecycle status |
| `bhavansh/isin-database` | NSE-oriented list (equity/debt/ETF/SGB/MF) | Not a depository-verified union; no conflict handling |
| `codereverser/casparser-isin` | MF ISIN lookup for CAS parsing | Mutual-fund only, not a registry |
| NSE/BSE trading lists | Exchange-listed scope only | Miss unlisted/OTC debt, defaulted/redeemed history |
| Commercial terminals (Bloomberg, ICE/CRISIL-linked, Bond Central paid tiers) | Broad, high-quality | Paywalled, not programmatically embeddable in agent workflows, India-specific fixed-income depth is thin or bundled at high price points |
| SEBI/NSDL/CDSL official portals | Authoritative | Fragmented, no unified schema, some require manual per-ISIN lookup, no SLA on machine-readability |

**What this project has that none of the above combine:**
1. **Row-level provenance, not just a value.** Every field traces to a `source_provider`, `source_url`, `raw_payload_hash` (SHA-256), and `parser_version` in `bond_source_observations` — 111,393 of them. An agent can ask "why do you believe this coupon rate?" and get an auditable answer, which paywalled terminals and single-source scrapers cannot offer.
2. **Multi-source convergence with fail-closed semantics.** The system explicitly refuses to call a source "complete" on HTTP 200 alone (see convergence loop, CDSL sample-vs-full-master gating). This is the opposite failure mode of most scrapers, which silently report partial data as complete — a critical trust property for anything feeding automated financial decisions.
3. **Explicit lifecycle and conflict modeling** (`security_type`, `lifecycle_status` added in migration 0008) rather than treating "found the ISIN" as the terminal state. Redeemed/defaulted/active distinctions matter enormously for agents doing credit or reinvestment decisions and are usually missing from free scrapers.
4. **Pre-ISIN → post-allotment linkage.** 28 draft SEBI prospectuses mapped to their eventual assigned ISIN series (`ncd_public_issues`) — this closes a temporal gap (issue announced → ISIN live) that most databases only pick up after listing, valuable for agents monitoring primary-market NCD opportunities in real time.
5. **Zero-dependency, zero-credential stack.** Node/TypeScript + SQLite + Python stdlib, no paid API keys, no broker/DP login required. This makes it trivially self-hostable and forkable — a structural moat against "free tier today, paywall tomorrow" commercial data vendors, and it means an AI agent can be handed the repo and a cron job with no credential-provisioning step.
6. **Expansion to ~400K ISINs (all asset classes)** while *keeping* the fixed-income table specialized turns this from "a bond database" into "the identity backbone for anything ISIN-keyed in India" — equities, MFs, ETFs, REITs/InvITs, SGBs — which is what agents actually need: one place to resolve *any* ISIN to issuer/asset-class/status before routing to specialized enrichment.

**Where it is honest about limits (and why that's a value, not a weakness):** the project explicitly keeps `national_completeness_proven=false` until CDSL's full UDiFF master is obtained (currently sample-only). This candor is itself a differentiator versus vendors who market "complete" coverage without verification — it's the trust signal that lets an agent calibrate confidence rather than assume ground truth.

---

## 2. Ideal agent query patterns, API, and CLI design

Agents consuming this data have three distinct needs that map to three distinct interfaces. Do not conflate them into one flat table/endpoint.

### 2.1 Identity resolution (universal, cheap, high-volume)
The most common agent call will be "what is ISIN X" across the full 400K-security universe — needs to be fast and asset-class-agnostic.

- **CLI:** `securities-master lookup <ISIN>` → returns `{isin, asset_class, instrument_type, issuer_name, lifecycle_status, first_seen, last_seen, sources: [...]}`
- **API:** `GET /v1/securities/{isin}` — single round trip, sub-50ms on indexed SQLite/Postgres.
- **Batch variant (critical for agents processing portfolios/statements):** `POST /v1/securities/batch {isins: [...]}` — agents parsing CAS/CDSL statements need to resolve 50-500 ISINs at once; a per-ISIN loop is the #1 anti-pattern to design out.

### 2.2 Fixed-income enrichment (specialized, lower-volume, high-value)
- `GET /v1/bonds/{isin}` → coupon, day-count, cashflow schedule, YTM at a given clean price, rating, trustee, document links.
- `GET /v1/bonds/{isin}/cashflows?face_value=100000` — unitized cashflow generator as a first-class endpoint (agents doing reinvestment/tax modeling need this shape, not raw terms).
- `GET /v1/bonds/{isin}/ytm?price=98.5&settlement_date=2026-08-20` — computed, not just stored.
- `GET /v1/ncd-issues?stage=open_subscription` — primary-market NCD scanning, the highest-value real-time use case (agents monitoring "what's open for subscription right now").

### 2.3 Provenance / trust interrogation (agent-specific, rarely needed by humans)
This is the pattern that differentiates *agent* consumption from human/dashboard consumption — agents need to reason about confidence before acting on a value.
- `GET /v1/securities/{isin}/provenance` → list of `bond_source_observations` rows with hash, source, timestamp, parser version.
- `GET /v1/securities/{isin}/conflicts` → any field where sources disagree, with authority ranking exposed (not silently resolved).
- Response envelope should always carry a `confidence` or `source_count` field inline on the primary lookup too, so agents doing routine calls don't need a second round trip just to sanity-check.

### 2.4 Freshness / coverage introspection (for agent self-guarding)
Agents should be able to check dataset health *before* trusting a null result as "doesn't exist" vs. "not yet ingested."
- `GET /v1/meta/coverage` → per-source last-sync timestamp, row counts, `national_completeness_proven: false`, known-gap list (e.g. CDSL full master pending).
- This lets an agent programmatically decide "should I fall back to a live NSDL/CDSL per-ISIN lookup for this specific ISIN because the bulk dataset might be stale/incomplete."

### 2.5 Interface shape recommendations
- **Local-first CLI + SQLite file is the primary interface, not a hosted API.** Given the zero-dependency philosophy, the strongest agent-consumption pattern is: agent clones/pulls the repo (or a published SQLite snapshot artifact), queries it directly with `better-sqlite3`/`sqlite3` — zero network latency, zero rate limits, works offline in sandboxed agent environments. This is a major differentiator from commercial APIs that meter/rate-limit agent traffic.
- **A thin read-only HTTP wrapper (FastAPI/Express) over the same SQLite file** should be offered as optional, for agents that can't mount a filesystem (hosted LLM tool-use contexts) — but it should be a stateless veneer, not a new source of truth, to avoid schema drift.
- **MCP server as the primary agent-native interface.** Given this ecosystem already runs an MCP-based `finance_tracker` server for personal data, exposing `universal_securities_master` as a matching MCP server (`mcp__securities_master__lookup_isin`, `mcp__securities_master__get_bond_terms`, `mcp__securities_master__query_ncd_issues`) is the most natural agent integration — it lets any MCP-capable agent (Hermes, Claude, etc.) query it directly without bespoke HTTP client code, mirroring the pattern users already have for personal finance.
- **Query language:** keep read endpoints filterable by `asset_class`, `security_type`, `lifecycle_status`, `issuer_name` (fuzzy), `maturity_date range`, and `source_provider` — these are the actual filters used in the ingestion pipeline's own reconciliation queries and will map 1:1 to agent needs ("find all AA-rated corporate bonds maturing in the next 12 months").

---

## 3. Packaging as a self-sustaining, zero-maintenance public utility

### 3.1 Distribution model
- **Publish signed, versioned SQLite snapshots** (e.g. `universal-securities-master-2026-08-15.db.zst` + SHA-256 + a `coverage.json` manifest) as GitHub Release artifacts. This is the "zero-maintenance" core: consumers pull a static file, no server to keep alive, no SLA to breach.
- **Keep the ingestion pipeline itself in the public repo** (already the case) so the project is forkable and auditable — the "self-sustaining" property comes from the fact that *anyone* can run `npm run build && npx tsx scripts/sync-complete-bond-master.ts` and regenerate the dataset from public sources with zero credentials, so no single maintainer or paid API key is a single point of failure.

### 3.2 Automation for zero-maintenance operation
- **Scheduled CI job** (GitHub Actions cron, e.g. daily/weekly) runs the convergence orchestrator, publishes a new snapshot release only if the fail-closed gates pass (no source failures, hash deltas recorded), and auto-generates a `CHANGELOG` diff (new ISINs, status transitions, field corrections) — this turns "maintenance" into "a green/red CI badge," not a human toil loop.
- **Fail-closed by default in CI too:** if CDSL (or any source) degrades to sample-only or a schema changes silently, the job should skip publishing a new snapshot rather than publish a regressed one — protects downstream agents from silently ingesting worse data than last week.
- **Community contribution surface:** publish the source-acceptance workflow (already documented in the `indian-bond-data-ingestion` skill) as `CONTRIBUTING.md` so external contributors can add new sources (e.g. AMFI for MF ISINs, RBI for SGBs/SDLs) without needing repo-maintainer hand-holding — the existing invariants (position-based ISIN classification, source-scoped authority, evidence preservation) are already written as enforceable rules, which is exactly what keeps a community-maintained project internally consistent without a benevolent dictator reviewing every PR line-by-line.

### 3.3 Sustainability without a commercial layer
- **MIT license + no paid tier for the core dataset** removes the "will this get shut down/paywalled" risk that haunts adoption of any data-dependent agent tool — this is the single biggest reason agents/developers would choose this over a fragmented free scraper *or* a commercial API with usage-based pricing.
- **Optional sponsored/hosted layer** (e.g. a hosted API + MCP endpoint with rate limits for those who don't want to self-host) can fund infrastructure without threatening the core promise — as long as the underlying SQLite snapshots stay free and independently regenerable, the hosted layer is a convenience, not a lock-in.
- **Coverage transparency as the trust mechanism that sustains adoption long-term:** publishing `national_completeness_proven=false` and an explicit gap list (e.g. "CDSL full master pending") rather than overclaiming keeps the project's reputation intact even while incomplete — this is what lets it become the *default* dependency other open tools build on, since builders can reason about exactly what they're trusting rather than discovering gaps in production.

### 3.4 Concrete near-term packaging steps
1. Add `docs/api-schema.md` documenting the four query pattern classes above as a stable contract before building any HTTP/MCP wrapper — schema stability matters more than server existence for early adopters who'll query the SQLite file directly.
2. Ship a `coverage.json`/`GET /v1/meta/coverage` manifest now (cheap, high trust payoff) even before the full multi-asset expansion lands.
3. Stand up the MCP server as a thin read-only wrapper reusing the same query functions the CLI/tests already exercise — do not fork query logic between interfaces.
4. Defer any hosted/paid layer until after the CI-automated snapshot pipeline is proven stable across several unattended releases.

---

## Summary

The differentiated value is **provenance + multi-source convergence + honest incompleteness signaling**, not raw ISIN count — several fragmented free/paid alternatives already have more ISINs individually but none combine cross-validated, auditable, zero-credential coverage. The right agent interface is a **local-first SQLite/CLI primary path with an MCP server as the agent-native veneer**, split cleanly into identity resolution, fixed-income enrichment, and provenance/coverage introspection as separate query classes. Long-term sustainability comes from **static, signed, freely-regenerable snapshots plus CI-automated fail-closed publishing**, not a hosted commercial layer — the zero-dependency/zero-credential design is the actual moat.
