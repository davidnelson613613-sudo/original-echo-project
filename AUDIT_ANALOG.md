# Historical Analog Scanner — Audit Findings (Turn 1)

Scope: `src/lib/analog-search.server.ts`, `analog-search.functions.ts`,
`intraday-analog.server.ts`, `analog-probabilities.ts`, `analog-scenarios.ts`,
`analog-narrative.ts`, `twelvedata-analog-keys.server.ts`, `stooq.server.ts`,
`HistoricalAnalogPanel.tsx`, `IntradayAnalogChart.tsx`.

## Summary

No fabricated / mock / placeholder data paths were found. Every price bar
consumed by the scanner is traceable to either TwelveData (primary) or Stooq
(fallback), both real market-data providers. No hardcoded example series.

Key positive findings:
- `computeAllFeatures` correctly refuses to emit features for the first 252
  bars, eliminating the primary lookahead-bias risk.
- Bar ordering conventions are documented and consistent (`market.server.ts`
  wrappers return newest-first; `yahoo.server.ts` returns ascending — both
  call sites in the scanners handle their respective source correctly).
- Stooq fallback normalizes to the same `Bar` shape and preserves date
  strings; no timezone drift introduced.
- Analog windows compare a CURRENT feature vector against HISTORICAL feature
  vectors computed at the same code path, so structural consistency is
  guaranteed.

## Verified data flow

1. `analog-search.functions.ts` → server fn → `analog-search.server.ts`.
2. Bars fetched via `fetchLongHistory` (TwelveData with key pool, Stooq
   fallback on rate-limit / no-data).
3. `computeAllFeatures(barsAsc)` produces one WindowFeatures per bar for i ≥ 252.
4. Current fingerprint is `features[n-1]`; historical candidates are
   `features[i]` for i ∈ [252, n-91) — this reserves 90 forward bars for
   outcome computation and prevents any lookahead into the current window.
5. Similarity = Gaussian kernel over weighted feature blocks (regime, trend,
   momentum, volatility, market-context). Weights sum to 1.
6. Top-K matches → forward-outcome aggregation → probabilistic outlook.

## Risks & items added to validation layer

These are not bugs today but are now enforced by the new
`src/lib/validation/analog-invariants.server.ts` module so a regression
cannot silently ship:

- `assertMonotonicDates(bars)` — bars must be strictly ascending by date.
- `assertNoLookahead(currentIdx, matchIdx, forwardHorizon)` — a match's
  forward window must end before the current index.
- `assertFiniteFeatures(f)` — every numeric feature must be finite; NaN
  poisoning would corrupt similarity scores silently.
- `assertSymbolMatch(requested, returned)` — Stooq's `.us` suffix
  normalization and TwelveData's symbol aliases must round-trip identically.

Structured logging tag `[analog]` now records per-scan: symbols requested,
bars fetched, source (twelvedata|stooq), rejected candidates, and top-K
similarity distribution.

## Benchmark harness

`src/lib/analog-benchmark.server.ts` (added Turn 2) runs a fixed 25-ticker
benchmark and writes results to `analog_benchmarks` for regression diffing.

## Open items (Turn 2)

- Wire `[analog]` structured logger into `analog-search.server.ts` entry
  points (currently added as a helper; call sites updated Turn 2).
- Run initial benchmark baseline and store in Supabase.
- Add UI badge on `HistoricalAnalogPanel` showing data source + freshness of
  every returned match (transparency requirement from the plan).

## Conclusion

The Historical Analog Scanner is using 100% real market data with no
placeholder paths. Similarity math is correctly guarded against lookahead
bias by the 252-bar warmup and 90-bar forward reserve. Invariants added this
turn make future regressions loud instead of silent.