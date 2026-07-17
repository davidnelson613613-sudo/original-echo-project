// Historical Probability Engine
//
// Reads the raw AnalogSearchResult (which already contains the top-K matches
// with their forward outcomes) and produces a richer, structured probability
// report used by the recommendation UI, per-rung tags, and the wait-vs-buy
// engine. Everything here is derived from the analog set — no forecasting,
// no external calls, no new data.

import type {
  AnalogHit,
  AnalogSearchResult,
  ForwardOutcome,
} from "./analog-search.server";

// ── Types ──────────────────────────────────────────────────────────────────

export type HorizonKey = 1 | 5 | 10 | 20 | 30 | 60;

export type HorizonStat = {
  days: HorizonKey;
  sample: number;
  meanPct: number;
  medianPct: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  probUp: number;
  probDown3: number;   // P(fwd close <= -3%)
  probUp3: number;     // P(fwd close >= +3%)
  maxGainPct: number;
  maxLossPct: number;
  winRate: number;     // probUp (alias, kept for readability)
  failureRate: number; // P(fwd close <= -5%)
  avgMaxDrawdownPct: number;
  avgMaxRallyPct: number;
  confidence: number;  // 0..100
};

export type DirectionProbabilities = {
  continuedDecline: number;
  reversalHigher: number;
  bottomAlreadyIn: number;
  falseBreakdown: number;   // dipped further then recovered 60d high
  recoveredWithin90d: number;
  choppyRange: number;
};

// Prob price reaches a given drop-from-here % (drop in percent, negative).
// Discrete lookup at these thresholds; consumers can interpolate.
export type DepthProbability = {
  dropPct: number;    // e.g. -1, -2, -3, -5, -8, -12
  probReached: number; // 0..1
};

export type RungProbability = {
  price: number;
  distancePct: number;         // (rungPrice - price)/price * 100
  probReached: number;         // 0..1 — likelihood price touched this level (from current) within 90d
  probRecoverAfterFill: number;// P(bounce ≥ +3% within 30d after being filled)
  probStopAfterFill: number;   // P(further -5% loss within 30d after fill)
  expectedFillReturn30d: number; // avg 30d return of analogs conditional on price reaching this depth
  sample: number;
  confidence: number;
};

export type ProbabilityReport = {
  sampleSize: number;
  meanSimilarity: number;
  confidenceOverall: number;      // 0..100 — sample × similarity × agreement × regime
  direction: DirectionProbabilities;
  horizons: HorizonStat[];        // T+1, T+3, T+5, T+10, T+20, T+60
  depthCurve: DepthProbability[]; // probability price drops at least X% within 90d
  matchQuality: "very_strong" | "strong" | "moderate" | "weak";
  // Compact evidence for the top 5 matches (date, symbol, similarity, fwd30/90)
  topEvidence: Array<{
    date: string;
    symbol: string;
    isSameSymbol: boolean;
    similarity: number;
    minLowPct: number;
    fwd30: number | null;
    fwd90: number | null;
    recovered: boolean;
  }>;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(v: number, p: number): number {
  if (!v || !isFinite(p)) return 0;
  return p;
}
void pct;

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[i];
}

function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  let v = 0;
  for (const x of a) v += (x - m) * (x - m);
  return Math.sqrt(v / (a.length - 1));
}

function fwdAt(f: ForwardOutcome, d: HorizonKey): number | null {
  switch (d) {
    case 1: return f.fwd1;
    case 5: return f.fwd5;
    case 10: return f.fwd10;
    case 20: return f.fwd20;
    case 30: return f.fwd30;
    case 60: return f.fwd60;
  }
}

function computeHorizon(matches: AnalogHit[], days: HorizonKey): HorizonStat {
  const vals: number[] = [];
  const rallies: number[] = [];
  const dds: number[] = [];
  for (const m of matches) {
    const v = fwdAt(m.forward, days);
    if (v !== null && isFinite(v)) {
      vals.push(v);
      rallies.push(m.forward.maxRallyPct);
      dds.push(m.forward.minLowPct);
    }
  }
  if (vals.length === 0) {
    return {
      days, sample: 0, meanPct: 0, medianPct: 0,
      p10: 0, p25: 0, p75: 0, p90: 0,
      probUp: 0.5, probDown3: 0, probUp3: 0,
      maxGainPct: 0, maxLossPct: 0,
      winRate: 0.5, failureRate: 0,
      avgMaxDrawdownPct: 0, avgMaxRallyPct: 0,
      confidence: 0,
    };
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spread = stdev(vals);
  const tol = 2 + days * 0.4;
  const agree = Math.max(0, 1 - Math.min(1, spread / tol));
  const confidence = Math.round(100 * (0.4 + 0.35 * agree + 0.25 * Math.min(1, vals.length / 8)));
  return {
    days,
    sample: vals.length,
    meanPct: mean,
    medianPct: median(vals),
    p10: percentile(vals, 10),
    p25: percentile(vals, 25),
    p75: percentile(vals, 75),
    p90: percentile(vals, 90),
    probUp: vals.filter((v) => v > 0).length / vals.length,
    probDown3: vals.filter((v) => v <= -3).length / vals.length,
    probUp3: vals.filter((v) => v >= 3).length / vals.length,
    maxGainPct: Math.max(...vals),
    maxLossPct: Math.min(...vals),
    winRate: vals.filter((v) => v > 0).length / vals.length,
    failureRate: vals.filter((v) => v <= -5).length / vals.length,
    avgMaxDrawdownPct: dds.reduce((a, b) => a + b, 0) / dds.length,
    avgMaxRallyPct: rallies.reduce((a, b) => a + b, 0) / rallies.length,
    confidence: Math.min(100, confidence),
  };
}

function computeDepthCurve(matches: AnalogHit[]): DepthProbability[] {
  const thresholds = [-1, -2, -3, -5, -8, -12];
  const mins = matches.map((m) => m.forward.minLowPct);
  return thresholds.map((t) => ({
    dropPct: t,
    probReached: mins.filter((m) => m <= t).length / Math.max(1, mins.length),
  }));
}

function computeDirection(r: AnalogSearchResult): DirectionProbabilities {
  const a = r.aggregate;
  const matches = r.matches;
  const falseBreakdown = matches.filter(
    (m) => m.forward.minLowPct < -3 && m.forward.recovered,
  ).length / Math.max(1, matches.length);
  return {
    continuedDecline: a.probContinuedDecline,
    reversalHigher: a.probReversal,
    bottomAlreadyIn: a.probBottomIn,
    falseBreakdown,
    recoveredWithin90d: a.recoveryRate,
    choppyRange: a.probChop,
  };
}

// Return only discrete historical depth-threshold evidence. No interpolation.
export function probabilityPriceReaches(
  curve: DepthProbability[],
  dropPct: number,
): number {
  if (dropPct >= 0) return 1;
  if (!curve.length) return 0;
  const exact = curve.find((p) => p.dropPct === dropPct);
  if (exact) return exact.probReached;
  const nearest = [...curve].sort((a, b) => Math.abs(a.dropPct - dropPct) - Math.abs(b.dropPct - dropPct))[0];
  return nearest?.probReached ?? 0;
}

export function buildRungProbability(
  report: ProbabilityReport,
  currentPrice: number,
  rungPrice: number,
): RungProbability {
  const distancePct = ((rungPrice - currentPrice) / currentPrice) * 100;
  const probReached = distancePct >= 0
    ? 1 // at or above current — assume filled at market
    : probabilityPriceReaches(report.depthCurve, distancePct);

  // Conditional post-fill stats: use matches whose minLowPct <= distancePct.
  // We approximate using the 30d horizon distribution restricted to that subset.
  const h30 = report.horizons.find((h) => h.days === 20) ?? report.horizons[0];
  const nearBottom = distancePct <= -3;
  const probRecoverAfterFill = nearBottom
    ? Math.min(1, h30.probUp3 + 0.15) // buying deep dip → bounce more likely
    : h30.probUp3;
  const probStopAfterFill = nearBottom
    ? Math.max(0, h30.failureRate - 0.1) // deep dip → less further downside
    : h30.failureRate;

  return {
    price: rungPrice,
    distancePct,
    probReached,
    probRecoverAfterFill,
    probStopAfterFill,
    expectedFillReturn30d: h30.meanPct,
    sample: h30.sample,
    confidence: h30.confidence,
  };
}

// ── Main entry ─────────────────────────────────────────────────────────────

export function buildProbabilityReport(r: AnalogSearchResult): ProbabilityReport {
  const horizons: HorizonKey[] = [1, 5, 10, 20, 30, 60];
  const horizonStats = horizons.map((d) => computeHorizon(r.matches, d));

  const meanSim = r.aggregate.meanSimilarity;
  const nBoost = Math.min(1, r.matches.length / 10);
  const agree = r.aggregate.agreement;
  const confOverall = Math.round(100 * (0.4 * (meanSim / 100) + 0.35 * agree + 0.25 * nBoost));

  const quality: ProbabilityReport["matchQuality"] =
    meanSim >= 82 && agree >= 0.6 ? "very_strong"
    : meanSim >= 72 && agree >= 0.45 ? "strong"
    : meanSim >= 60 ? "moderate"
    : "weak";

  const topEvidence = r.matches.slice(0, 5).map((m) => ({
    date: m.date,
    symbol: m.symbol,
    isSameSymbol: m.isSameSymbol,
    similarity: m.similarity,
    minLowPct: m.forward.minLowPct,
    fwd30: m.forward.fwd30,
    fwd90: m.forward.fwd90,
    recovered: m.forward.recovered,
  }));

  return {
    sampleSize: r.matches.length,
    meanSimilarity: Math.round(meanSim),
    confidenceOverall: Math.max(0, Math.min(100, confOverall)),
    direction: computeDirection(r),
    horizons: horizonStats,
    depthCurve: computeDepthCurve(r.matches),
    matchQuality: quality,
    topEvidence,
  };
}
