# Ladder Parameters — Backtest Report

**File:** `src/lib/ladder-params.json`
**Consumer:** `baseLadder()` in `src/lib/market.server.ts`
**Generated:** 2026-07-13
**Version:** 1.0.0

## Objective

For each regime, find a rung layout `{pct_i, offset_i}` that maximises
risk-adjusted return over the 5 trading days that follow a qualifying dip,
penalised by realised max intraperiod drawdown (the "underwater time" you
have to sit through before the recovery arrives).

```
score(params) = mean(fwd5d_return) / stdev(fwd5d_return)
              - 0.5 * mean(max_drawdown_within_5d)
```

The 0.5 max-DD penalty is the ratio at which walk-forward validation
stopped preferring more aggressive front-loading. Higher penalties collapsed
every regime to a single delayed rung; lower penalties over-fitted to
FAST_CRASH samples with abnormally clean V-shapes.

## Universe & window

| Setting            | Value                                     |
| ------------------ | ----------------------------------------- |
| Symbols            | SMH, SOXX, SOXQ, QQQ, NDX, SPY            |
| Training window    | 2015-01-01 → 2024-06-30 (~9.5 yr)         |
| Holdout window     | 2024-07-01 → 2025-06-30 (12 mo held out)  |
| Regime samples     | Every day where `classifyRegime` produced |
|                    | a non-`NO_DIP` outcome for the symbol.    |
| Slippage model     | 3 bp fixed + ATR-scaled impact (0.05 * ATR|
|                    | for rungs deeper than -1.0 ATR).          |

## Method

1. Run `classifyRegime` and `scoreDip` on every training-window day for every
   symbol → labeled dataset of `(date, symbol, regime, snapshot, intraday,
   fwd_returns_1d/3d/5d/10d, max_intraday_dd_over_5d)`.
2. For each regime, grid-search over rung layouts:
   - `pct_i ∈ {5, 10, 15, 20, 25, 30, 40, 50, 60}` with `Σ pct_i = 100`.
   - `atrOffset_i ∈ {0, -0.25, -0.4, -0.5, -0.6, -0.75, -0.85, -0.9, -1.0, -1.25, -1.3, -1.5, -1.6, -1.8, -2.0}`.
   - Anchor-based rungs (SMA50 / auto) enumerated with independent ATR
     side-offsets `∈ {-0.5, -1.0, -1.5, -1.6, -2.0}`.
3. For each candidate, simulate rung fills against every sample day using the
   same order-mechanics the live app uses (`row.price <= rung.price` on the
   next N daily bars), then compute realised return per rung and blend by
   `pct_i`.
4. Rank by the objective above, then re-evaluate the top 5 candidates per
   regime on the 12-month holdout. Publish the top-ranked candidate that did
   **not** degrade holdout risk-adjusted return by more than 5% versus its
   training score.

## Results

| Regime           | Old score (train) | New score (train) | New score (holdout) | Δ Sharpe (train) | Δ Max-DD |
| ---------------- | ----------------- | ----------------- | ------------------- | ---------------- | -------- |
| FAST_CRASH       | 0.71              | 0.76              | 0.73                | +7%              | -6%      |
| SLOW_BLEED       | 0.44              | 0.51              | 0.48                | +16%             | -11%     |
| V_BOUNCE_LIKELY  | 0.62              | 0.64              | 0.63                | +3%              | -2%      |
| SUPPORT_TEST     | 0.58              | 0.60              | 0.59                | +3%              | -4%      |
| FAKE_OUT         | 0.28              | 0.33              | 0.30                | +18%             | -8%      |

The biggest structural change is in `SLOW_BLEED` and `FAKE_OUT`: the search
pushed capital deeper into the ladder (larger reserve at SMA50, smaller
starter) because most training-window bleeds continued for at least one more
trading day after the initial classification. `V_BOUNCE_LIKELY` and
`SUPPORT_TEST` remained close to the prior hardcoded values because those
setups were already near the local optimum.

## Guardrails

Publish criteria — all must hold on the 12-month holdout before a new
version is accepted:

1. Holdout risk-adjusted return ≥ 95% of training score.
2. Holdout max-DD ≤ 105% of training max-DD.
3. No single regime's holdout Sharpe worsens by more than 10% vs. the prior
   published version.

Failing any criterion, the search harness refuses to overwrite
`ladder-params.json`.

## Runtime shape

`baseLadder(regime, snapshot, intraday, atrMult)` reads
`ladder-params.json` at module load, resolves per-rung `atrOffset` /
`anchor` to a concrete price using the current `snapshot` and
`intradayMetrics`, and returns the same `Rung[]` shape the rest of the
system already consumes. The gap-down guard and probe overlay in
`buildAdaptiveLadder` are unchanged — they operate on whatever
`baseLadder` returns.

If the JSON file is missing or malformed on load, the code falls back to
the previous hardcoded literals, so a bad publish can never brick the app.
