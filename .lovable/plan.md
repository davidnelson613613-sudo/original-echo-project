# Systemic Market Risk Intelligence Engine — Build Plan

This is a large, multi-week build. To keep it shippable and evidence-driven, I'll deliver it in **6 phases**, each independently valuable and verifiable. Nothing is a black box — every score traces back to raw data + a reproducible calculation.

## Guiding principles
- **Evidence over rules.** Every threshold is calibrated from historical data, not hand-picked.
- **Explainability is a first-class output**, not an afterthought — each score carries per-indicator contributions.
- **Data honesty.** Missing data is tracked and surfaced; pre-1970 features are flagged low-confidence.
- **Modular.** New data sources / features / models plug in without rewrites.

---

## Phase 1 — Data foundation & historical event library
**Goal:** durable, normalized daily/monthly time series from 1929→today + a curated event catalog.

- New tables:
  - `market_series` (source, series_id, date, value, revision_date) — long-format store for FRED, Yahoo, Treasury, BLS, BEA.
  - `market_events` (name, category, start_date, trough_date, end_date, severity, notes, sources[]) — bear markets, recessions, credit/banking/liquidity crises, inflation regimes, tightening/easing cycles, commodity shocks, vol spikes.
  - `data_ingest_runs` (source, status, rows, error, ran_at) — observability.
- Ingestion server functions (one per source), all idempotent, all cached:
  - FRED (macro), Yahoo (equities/sectors/vol/FX/commodities), Treasury (yield curve), BLS (CPI/employment), BEA (GDP), FINRA (margin debt), EDGAR (already wired).
- Nightly cron via `pg_cron` → `/api/public/hooks/ingest-daily`.
- Seed `market_events` from a curated JSON of ~60 well-documented events with citations.

**Deliverable:** all raw data queryable + event catalog visible in a new "Event Library" admin view.

---

## Phase 2 — Feature engineering ("market fingerprint")
**Goal:** ~80–120 normalized daily features grouped into 6 blocks.

- `market_features` table: (date, feature_key, value, zscore, percentile, window) — all features stored **both raw and normalized** (rolling z-score + long-history percentile) so comparisons are regime-aware.
- Feature blocks:
  1. **Market structure** — trend, drawdown, momentum (1/3/6/12m), realized vol, breadth proxies, dispersion.
  2. **Sector rotation** — offense/defense ratio, leadership shifts, cross-sector correlation.
  3. **Fixed income** — 2s10s, 3m10y, credit spreads (HY/IG proxies via ETFs pre-1997 gap flagged), real yields.
  4. **Macro** — CPI YoY & momentum, unemployment change, GDP nowcast, IP, housing starts, retail sales, M2, consumer confidence.
  5. **Cross-asset** — gold, oil, DXY, EM vs DM, copper/gold.
  6. **Stress** — VIX regime, term structure, correlation spikes, liquidity proxies.
- Each feature has metadata: `available_from`, `source`, `formula`, `confidence_tier`.

**Deliverable:** `/features` explorer page — pick any feature, see time series + regime overlays.

---

## Phase 3 — Ensemble scoring models
**Goal:** 6 independent models → one composite Systemic Risk Score with per-model contributions.

Each model outputs a 0–100 risk contribution + reasoning payload:
1. **Historical analog matcher** — cosine/Mahalanobis distance between today's fingerprint and every historical date; returns top-K matches with dates, event labels, and forward outcomes.
2. **Regime classifier** — HMM/Gaussian mixture on stress + macro features → probability of "late-cycle / crisis / recovery / expansion".
3. **Statistical anomaly detector** — Mahalanobis distance vs. rolling covariance; flags multivariate outliers.
4. **Breadth deterioration** — % of features in bottom decile vs. history.
5. **Credit stress composite** — spreads + curve + financials relative performance.
6. **Cross-asset divergence** — equity/bond/FX/commodity coherence breakdown.

Composite = evidence-weighted blend (weights learned via logistic regression on historical drawdown labels, not hand-tuned). Levels: Healthy / Improving / Neutral / Elevated / High / Severe — thresholds set at historical percentiles of the composite conditional on forward 6m drawdown.

**Deliverable:** `systemic_risk_snapshots` extended with `model_contributions JSONB` and `analog_matches JSONB`.

---

## Phase 4 — Explainability & UI
- Redesigned `/systemic-risk` page:
  - Headline gauge + regime label + confidence band.
  - "Why did this change?" — top ↑ / ↓ contributing features vs. yesterday & vs. last week.
  - "Closest historical analogs" — ranked list with similarity %, per-feature agreement/disagreement table, and forward outcome charts (1m/3m/6m/12m after that date).
  - "Missing data" panel — every feature currently unavailable, and how it affects confidence.
  - Timeline chart of composite score with event overlays.

---

## Phase 5 — Validation framework
- New page `/systemic-risk/validation` fed by a nightly backtest job:
  - Lead time distribution before each historical bear market.
  - Precision / recall / F1 for "elevated+" preceding 15%+ drawdowns within 6/12m.
  - Reliability diagram (predicted vs. realized drawdown frequency).
  - Score stability (day-over-day change distribution).
  - Regime-conditional accuracy (does it work in inflationary vs. deflationary regimes?).
- Results stored in `systemic_risk_backtest_runs` (already exists) — extended schema.

---

## Phase 6 — Ops, performance, docs
- Incremental daily updates (only recompute changed dates).
- Redis-less caching via `*_cache` tables (pattern already in project).
- `/systemic-risk/methodology` page: architecture diagram, every data source, every feature, every model, known limitations, roadmap.

---

## Technical details (for engineers)

**Stack fit:** all ingestion + scoring in `createServerFn` (`.functions.ts`) using `supabaseAdmin` inside handlers; cron via `/api/public/hooks/*`. Heavy math in TypeScript (ml-matrix, simple-statistics) — no Python runtime needed. No Node-only packages.

**Data volume:** ~24k trading days × 120 features ≈ 2.9M rows in `market_features` — well within Postgres. Partitioning not needed initially.

**API budgets:** FRED (unlimited free), Yahoo (via existing cache), Twelve Data (5 keys already rotating) — reserved for equities. EDGAR daily. No new paid keys required.

**Pre-1970 caveat:** limited to price + rates + CPI; credit spreads and VIX-equivalents synthesized from realized vol. Confidence tier surfaced on every analog.

---

## What I'll ship first if you approve

**Phase 1 in the next turn**, in this order:
1. Migration: `market_series`, `market_events`, `data_ingest_runs` + grants + RLS + updated_at trigger.
2. FRED ingest server fn + backfill for a starter set of ~15 key series (DGS10, DGS2, DGS3MO, UNRATE, CPIAUCSL, INDPRO, T10Y2Y, BAMLH0A0HYM2, VIXCLS, DTWEXBGS, GDPC1, PAYEMS, HOUST, UMCSENT, M2SL).
3. Seed `market_events` with the curated JSON (~60 events, 1929→2024).
4. Admin route `/systemic-risk/events` to view the catalog.

Then Phases 2–6 across subsequent turns, each landing a visible upgrade.

**Confirm to proceed with Phase 1**, or tell me to reorder / drop / add anything.
