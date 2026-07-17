// ── Historical Analog Scanner — Walk-Forward Validation Harness ─────────
//
// For each historical trading day t in a test window, we:
//   1) Slice bars/features to only data ≤ t (no look-ahead)
//   2) Run searchAnalogs, which naturally restricts matches to bars ≤ t
//      and forward-walks from each match using ONLY historical bars
//   3) Compare the analog's predicted mean fwd30 / fwd90 to the ACTUAL
//      forward returns realized by the symbol from bar t
//
// Metrics computed:
//   • MAE / MdAE of fwd30, fwd90
//   • Directional hit rate (sign match)
//   • Calibration coverage — % of actuals inside p25/p75 band
//   • Median match count and mean similarity
//
// The harness is intentionally single-symbol at the primary level; the
// caller composes across a universe and aggregates. No admin/service
// clients are imported here — this module is safe to load from a server
// function handler.

import type { AnalogSearchResult, WindowFeatures } from "./analog-search.server";
import type { Bar } from "./market.server";

export type SymbolValidationInput = {
  symbol: string;
  bars: Bar[];
  features: (WindowFeatures | null)[];
};

export type PredictionRecord = {
  date: string;
  tIdx: number;
  matchCount: number;
  meanSim: number;
  predFwd30: number | null;
  p25Fwd30: number | null;
  p75Fwd30: number | null;
  predFwd90: number | null;
  p25Fwd90: number | null;
  p75Fwd90: number | null;
  actualFwd30: number | null;
  actualFwd90: number | null;
};

export type SymbolMetrics = {
  symbol: string;
  predictions: number;
  matchCountMedian: number;
  meanSim: number;
  fwd30: HorizonMetrics;
  fwd90: HorizonMetrics;
};

export type HorizonMetrics = {
  n: number;
  mae: number;             // mean abs error, percentage points
  mdae: number;            // median abs error
  hitRate: number;         // 0..1 directional agreement
  bias: number;            // mean(pred - actual)
  coverageP25P75: number;  // 0..1 fraction inside band
};

export type WalkForwardOptions = {
  // How many test dates per symbol; evenly spaced over `windowYears`
  testDatesPerSymbol?: number;
  // Look back this many years for test dates (ending at most-recent bar - 90d)
  windowYears?: number;
  // Only test dates whose index is >= this cutoff (need history to compute analogs)
  minHistoryBars?: number;
};

export function walkForwardSymbol(
  input: SymbolValidationInput,
  searchAnalogs: (
    symbol: string,
    primary: { bars: SymbolValidationInput["bars"]; features: (WindowFeatures | null)[] },
    extras: never[],
    opts: { topK?: number; excludeRecentDays?: number },
  ) => AnalogSearchResult | null,
  opts: WalkForwardOptions = {},
): { predictions: PredictionRecord[]; metrics: SymbolMetrics } {
  const testDates = opts.testDatesPerSymbol ?? 40;
  const windowYears = opts.windowYears ?? 8;
  const minHistoryBars = opts.minHistoryBars ?? 500;

  const { bars, features, symbol } = input;
  const n = bars.length;
  if (n < minHistoryBars + 120) {
    return {
      predictions: [],
      metrics: emptyMetrics(symbol),
    };
  }

  // Test range: must have at least 90 forward bars of ground truth.
  const lastTestIdx = n - 91;
  const windowBars = Math.min(252 * windowYears, lastTestIdx - minHistoryBars);
  const firstTestIdx = Math.max(minHistoryBars, lastTestIdx - windowBars);
  if (firstTestIdx >= lastTestIdx) {
    return { predictions: [], metrics: emptyMetrics(symbol) };
  }

  const step = Math.max(5, Math.floor((lastTestIdx - firstTestIdx) / testDates));
  const predictions: PredictionRecord[] = [];

  for (let t = firstTestIdx; t <= lastTestIdx; t += step) {
    const curF = features[t];
    if (!curF) continue;

    // Slice — searchAnalogs treats the last bar as "current"
    const slicedBars = bars.slice(0, t + 1);
    const slicedFeatures = features.slice(0, t + 1);

    const result = searchAnalogs(symbol, { bars: slicedBars, features: slicedFeatures }, [], {
      topK: 8,
      excludeRecentDays: 120,
    });

    // Ground truth: real forward returns of the symbol from t
    const p0 = bars[t].close;
    const p30 = t + 30 < n ? bars[t + 30].close : null;
    const p90 = t + 90 < n ? bars[t + 90].close : null;
    const actualFwd30 = p30 !== null ? ((p30 - p0) / p0) * 100 : null;
    const actualFwd90 = p90 !== null ? ((p90 - p0) / p0) * 100 : null;

    if (!result || result.aggregate.count < 4) {
      predictions.push({
        date: bars[t].datetime,
        tIdx: t,
        matchCount: result?.aggregate.count ?? 0,
        meanSim: result?.aggregate.meanSimilarity ?? 0,
        predFwd30: null,
        p25Fwd30: null,
        p75Fwd30: null,
        predFwd90: null,
        p25Fwd90: null,
        p75Fwd90: null,
        actualFwd30,
        actualFwd90,
      });
      continue;
    }

    const a = result.aggregate;
    predictions.push({
      date: bars[t].datetime,
      tIdx: t,
      matchCount: a.count,
      meanSim: a.meanSimilarity,
      predFwd30: a.meanFwd30,
      p25Fwd30: a.p25Fwd30,
      p75Fwd30: a.p75Fwd30,
      predFwd90: a.meanFwd90,
      p25Fwd90: a.p25Fwd90,
      p75Fwd90: a.p75Fwd90,
      actualFwd30,
      actualFwd90,
    });
  }

  return { predictions, metrics: aggregateMetrics(symbol, predictions) };
}

function emptyMetrics(symbol: string): SymbolMetrics {
  const zero: HorizonMetrics = { n: 0, mae: 0, mdae: 0, hitRate: 0, bias: 0, coverageP25P75: 0 };
  return {
    symbol,
    predictions: 0,
    matchCountMedian: 0,
    meanSim: 0,
    fwd30: zero,
    fwd90: zero,
  };
}

function aggregateMetrics(symbol: string, preds: PredictionRecord[]): SymbolMetrics {
  const withPred = preds.filter((p) => p.predFwd30 !== null || p.predFwd90 !== null);
  const matchCounts = withPred.map((p) => p.matchCount).sort((a, b) => a - b);
  const matchCountMedian = matchCounts.length ? matchCounts[Math.floor(matchCounts.length / 2)] : 0;
  const meanSim = withPred.length ? withPred.reduce((s, p) => s + p.meanSim, 0) / withPred.length : 0;
  return {
    symbol,
    predictions: withPred.length,
    matchCountMedian,
    meanSim: Math.round(meanSim * 10) / 10,
    fwd30: horizonMetrics(preds, "predFwd30", "actualFwd30", "p25Fwd30", "p75Fwd30"),
    fwd90: horizonMetrics(preds, "predFwd90", "actualFwd90", "p25Fwd90", "p75Fwd90"),
  };
}

function horizonMetrics(
  preds: PredictionRecord[],
  predKey: "predFwd30" | "predFwd90",
  actKey: "actualFwd30" | "actualFwd90",
  p25Key: "p25Fwd30" | "p25Fwd90",
  p75Key: "p75Fwd30" | "p75Fwd90",
): HorizonMetrics {
  const rows = preds.filter((p) => p[predKey] !== null && p[actKey] !== null) as Array<
    PredictionRecord & Record<typeof predKey | typeof actKey, number>
  >;
  if (!rows.length) return { n: 0, mae: 0, mdae: 0, hitRate: 0, bias: 0, coverageP25P75: 0 };
  const errs = rows.map((r) => Math.abs(r[predKey] - r[actKey]));
  const mae = errs.reduce((s, e) => s + e, 0) / errs.length;
  const sortedErrs = [...errs].sort((a, b) => a - b);
  const mdae = sortedErrs[Math.floor(sortedErrs.length / 2)];
  const hits = rows.filter((r) => Math.sign(r[predKey]) === Math.sign(r[actKey])).length;
  const hitRate = hits / rows.length;
  const bias = rows.reduce((s, r) => s + (r[predKey] - r[actKey]), 0) / rows.length;
  const inBand = rows.filter((r) => {
    const p25 = r[p25Key];
    const p75 = r[p75Key];
    if (p25 === null || p75 === null) return false;
    return r[actKey] >= p25 && r[actKey] <= p75;
  }).length;
  const coverage = inBand / rows.length;
  return {
    n: rows.length,
    mae: round2(mae),
    mdae: round2(mdae),
    hitRate: round3(hitRate),
    bias: round2(bias),
    coverageP25P75: round3(coverage),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Fold multiple per-symbol metrics into a suite-level roll-up.
export function rollupMetrics(perSymbol: SymbolMetrics[]): {
  fwd30: HorizonMetrics;
  fwd90: HorizonMetrics;
  meanSim: number;
  totalPredictions: number;
} {
  const wSum = (key: keyof HorizonMetrics, horizon: "fwd30" | "fwd90") => {
    let num = 0;
    let den = 0;
    for (const s of perSymbol) {
      const h = s[horizon];
      const w = h.n;
      if (w <= 0) continue;
      num += (h[key] as number) * w;
      den += w;
    }
    return den > 0 ? num / den : 0;
  };
  const rollup = (horizon: "fwd30" | "fwd90"): HorizonMetrics => {
    const n = perSymbol.reduce((s, x) => s + x[horizon].n, 0);
    return {
      n,
      mae: round2(wSum("mae", horizon)),
      mdae: round2(wSum("mdae", horizon)),
      hitRate: round3(wSum("hitRate", horizon)),
      bias: round2(wSum("bias", horizon)),
      coverageP25P75: round3(wSum("coverageP25P75", horizon)),
    };
  };
  const totalPredictions = perSymbol.reduce((s, x) => s + x.predictions, 0);
  const meanSim =
    totalPredictions > 0
      ? perSymbol.reduce((s, x) => s + x.meanSim * x.predictions, 0) / totalPredictions
      : 0;
  return {
    fwd30: rollup("fwd30"),
    fwd90: rollup("fwd90"),
    meanSim: round2(meanSim),
    totalPredictions,
  };
}
