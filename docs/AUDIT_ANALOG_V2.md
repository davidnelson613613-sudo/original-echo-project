# Historical Analog Scanner — v2 Audit

_Last updated: Phase 6 (validation UI + transparency)_

## What the scanner does

Given a target ticker, the scanner searches its own price history (and, in
mixed-universe mode, other tickers') for windows whose feature vector is
similar to the current window. It aggregates the forward 30/90-day returns of
those historical matches to produce a distribution — mean, p25/p75 band,
directional lean — plus an evidence label reflecting sample size and
similarity.

The scanner is a **descriptive analog engine**, not a directional trade
signal. It answers: _"When this feature pattern has appeared before, what
happened next, on average?"_

## Data provenance

- **Primary daily bars**: Yahoo Finance (`query1.finance.yahoo.com/v8`).
  Keyless, free.
- **Fallback daily bars**: Stooq (`stooq.com`). Keyless, free.
- **Cache**: bars are cached per symbol in `yahoo_summary_cache`; source is
  recorded and surfaced as a badge in the UI (`yahoo` / `stooq` / `cache`).
- **TwelveData is no longer used for the daily path.** It remains for
  intraday only.

## Feature vector

Each window is summarised as:

- Log-return path (z-scored)
- Realised volatility (20d, 60d)
- Distance from 50d / 200d MA
- ADX / trend strength
- RSI(14) and 60d slope of RSI
- Volume z-score (20d)
- Drawdown from 60d high

Similarity = cosine similarity of z-scored feature vectors, with a
regime-conditioned floor (see below).

## Guardrails against overfitting & look-ahead

1. **No look-ahead in search.** For any test date `t`, only bars ≤ `t` are
   visible; candidate matches must be ≥120 trading days before `t`.
2. **Forward returns of matches** are computed strictly from bars after the
   matched window's end, still ≤ `t`.
3. **Dynamic similarity floor.** In high-volatility / trend-broken regimes the
   floor is raised so weak analogs are excluded, and the panel emits
   `insufficient_evidence` rather than a spurious forecast.
4. **RSI regime gate.** Matches whose RSI regime disagrees with the current
   RSI regime (overbought vs oversold vs neutral) are down-weighted.
5. **Runner-up transparency.** The UI exposes runner-up matches with their
   own feature snapshots and real forward outcomes so a user can audit which
   historical windows are driving the aggregate.

## Walk-forward validation

Route: `/analog-validation` (auth-only, `noindex`).

For each symbol in a universe, and each of _N_ evenly-spaced test dates
across a rolling window (default 8y):

1. Slice bars and features to `≤ t`.
2. Run the scanner with `excludeRecentDays=120`, `topK=8`.
3. Compare the aggregate `meanFwd30 / meanFwd90` and `p25/p75` band to the
   **actual** forward 30- and 90-day returns of the symbol from `t`.
4. Record MAE, MdAE, directional hit rate, bias, and calibration coverage
   (fraction of actuals inside the p25–p75 band).

Runs are persisted in `analog_validation_runs` with per-symbol metrics,
rollup, universe, notes, and configuration.

### Metrics reported

| Metric | Meaning | Good / Bad |
| --- | --- | --- |
| MAE | Mean abs error in %-points of forward return | Lower better |
| MdAE | Median abs error | Lower better |
| Hit rate | % of predictions where sign(pred) == sign(actual) | > 55% good, < 45% inverted |
| Bias | Mean(pred − actual) | Near 0 preferred |
| Coverage p25–p75 | % of actual returns inside the predicted p25/p75 band | ~50% = well calibrated |

### Transparency views

The validation page renders, in addition to the roll-up cards:

- **Per-symbol table** with source badge and every metric.
- **Distribution charts** — per-symbol MAE (30d / 90d), hit-rate ranking,
  calibration coverage ranking, and signed bias histograms.
- **Confidence breakdown** — symbols bucketed by mean similarity
  (`<70`, `70–80`, `≥80`) and by median match count (`<5`, `5–7`, `≥8`),
  with average MAE, hit rate, and coverage per bucket. This makes visible
  whether accuracy actually improves when the scanner is more "confident".

## Interpreting output

- **High similarity + dense matches + high coverage** → analog aggregate is
  useful context; treat p25/p75 as a plausible range, not a prediction.
- **Low similarity or sparse matches** → panel emits `insufficient_evidence`;
  UI hides the point forecast and shows the guard message.
- **Hit rate near 50% with wide coverage** → scanner is honest about
  uncertainty; use it as a distributional prior, not a signal.
- **Persistent bias in one direction** → recalibrate feature weights or
  investigate regime coverage in the training window.

## Known limits

- Symbols with < ~500 bars of clean history are skipped by the walk-forward
  harness.
- Corporate actions rely on Yahoo/Stooq adjusted closes; delistings and
  ticker changes are not backfilled.
- Cross-symbol matches (mixed universe) are opt-in and not part of the
  default validation universe.
- The scanner is descriptive; it does not size positions, apply stops, or
  factor in transaction costs.
