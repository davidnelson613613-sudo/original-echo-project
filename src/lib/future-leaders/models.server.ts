// Five independent scoring models + composite. Each returns 0–100 with
// human-readable reasons so the UI can explain every rank.

import type { FeatureVector } from "./features.server";

export type ComponentScore = {
  score: number; // 0..100
  reasons: string[];
  dataComplete: boolean;
};

export type ComponentScores = {
  historical: ComponentScore;
  momentum: ComponentScore;
  quality: ComponentScore;
  relativeStrength: ComponentScore;
  risk: ComponentScore; // higher = SAFER (0=very risky, 100=very safe)
};

export type CompositeResult = {
  composite: number;
  confidence: number;
  weights: Record<string, number>;
  agreement: number;
  dataCompleteness: number;
  components: ComponentScores;
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// Sigmoid-ish mapping helpers so features become 0..100.
function scaleLinear(x: number | null | undefined, lo: number, hi: number): number {
  if (x == null || !Number.isFinite(x)) return 50;
  if (hi === lo) return 50;
  return clamp(((x - lo) / (hi - lo)) * 100);
}

/**
 * Historical similarity: proxy score derived from long-horizon compounding
 * shape. Great long-term winners show:
 *   • strong multi-year CAGR (3y & 5y)
 *   • persistent stage-2 uptrend
 *   • drawdowns that recovered (dist from 52w high modest)
 *   • rising 200SMA
 * This is the price-shape fingerprint the analog engine would confirm on
 * top-N tickers via `analog-search`.
 */
export function scoreHistorical(f: FeatureVector): ComponentScore {
  const reasons: string[] = [];
  let score = 50;
  let complete = true;

  if (f.cagr5y != null) {
    const s = scaleLinear(f.cagr5y, 0, 50);
    score += (s - 50) * 0.35;
    if (f.cagr5y >= 25) reasons.push(`5y CAGR ${f.cagr5y.toFixed(1)}% (elite compounder)`);
    else if (f.cagr5y >= 15) reasons.push(`5y CAGR ${f.cagr5y.toFixed(1)}%`);
    else if (f.cagr5y < 5) reasons.push(`Weak 5y CAGR ${f.cagr5y.toFixed(1)}%`);
  } else { complete = false; reasons.push("No 5y history"); }

  if (f.cagr3y != null) {
    const s = scaleLinear(f.cagr3y, -10, 60);
    score += (s - 50) * 0.25;
  }

  if (f.sma200SlopePct != null) {
    const s = scaleLinear(f.sma200SlopePct, -10, 25);
    score += (s - 50) * 0.15;
    if (f.sma200SlopePct > 5) reasons.push(`Rising 200-day (+${f.sma200SlopePct.toFixed(1)}%)`);
    if (f.sma200SlopePct < -3) reasons.push(`Falling 200-day (${f.sma200SlopePct.toFixed(1)}%)`);
  }

  if (f.stage2) { score += 6; reasons.push("Stage-2 uptrend confirmed"); }
  else reasons.push("Not in stage-2 uptrend");

  return { score: clamp(score), reasons, dataComplete: complete };
}

/** Momentum & Trend */
export function scoreMomentum(f: FeatureVector): ComponentScore {
  const reasons: string[] = [];
  let score = 50;
  let complete = true;

  if (f.ret12m1m != null) {
    const s = scaleLinear(f.ret12m1m, -30, 80);
    score += (s - 50) * 0.4;
    if (f.ret12m1m > 30) reasons.push(`12-1 momentum ${f.ret12m1m.toFixed(0)}%`);
    if (f.ret12m1m < -10) reasons.push(`Weak 12-1 momentum ${f.ret12m1m.toFixed(0)}%`);
  } else { complete = false; }

  if (f.ret6m != null) {
    const s = scaleLinear(f.ret6m, -20, 50);
    score += (s - 50) * 0.2;
  }

  if (f.distSma200Pct != null) {
    // Sweet spot: 5%..40% above 200SMA
    const dist = f.distSma200Pct;
    const s = dist < 0 ? 20 : dist > 60 ? 55 : scaleLinear(dist, 0, 40);
    score += (s - 50) * 0.2;
    if (dist > 0 && dist < 40) reasons.push(`${dist.toFixed(1)}% above 200SMA`);
    if (dist < -5) reasons.push(`Below 200SMA (${dist.toFixed(1)}%)`);
    if (dist > 60) reasons.push(`Extended ${dist.toFixed(0)}% above 200SMA`);
  }

  if (f.sma200SlopePct != null) {
    const s = scaleLinear(f.sma200SlopePct, -8, 20);
    score += (s - 50) * 0.2;
  }

  return { score: clamp(score), reasons, dataComplete: complete };
}

/** Quality proxy (price-derived — labeled as such in UI). */
export function scoreQuality(f: FeatureVector): ComponentScore {
  const reasons: string[] = [];
  let score = 50;
  let complete = true;

  if (f.upDayRatio250 != null) {
    const s = scaleLinear(f.upDayRatio250 * 100, 45, 60);
    score += (s - 50) * 0.3;
    if (f.upDayRatio250 > 0.55) reasons.push(`${(f.upDayRatio250 * 100).toFixed(0)}% up-days (persistent)`);
  } else complete = false;

  if (f.alphaAnn250 != null) {
    const s = scaleLinear(f.alphaAnn250, -15, 30);
    score += (s - 50) * 0.35;
    if (f.alphaAnn250 > 8) reasons.push(`Positive alpha vs SPY (+${f.alphaAnn250.toFixed(1)}%/yr)`);
    if (f.alphaAnn250 < -5) reasons.push(`Negative alpha vs SPY (${f.alphaAnn250.toFixed(1)}%/yr)`);
  }

  if (f.volumeTrendRatio != null) {
    const s = scaleLinear(f.volumeTrendRatio, 0.7, 1.6);
    score += (s - 50) * 0.15;
    if (f.volumeTrendRatio > 1.25) reasons.push(`Volume expanding (${f.volumeTrendRatio.toFixed(2)}× baseline)`);
  }

  // Recovery quality: shallow 1y drawdown given trend
  if (f.maxDrawdown1y != null) {
    const dd = Math.abs(f.maxDrawdown1y);
    const s = scaleLinear(-dd, -35, -5);
    score += (s - 50) * 0.2;
    if (dd < 15) reasons.push(`Shallow 1y drawdown (-${dd.toFixed(0)}%)`);
    if (dd > 40) reasons.push(`Deep 1y drawdown (-${dd.toFixed(0)}%)`);
  }

  return { score: clamp(score), reasons, dataComplete: complete };
}

/** Relative strength vs SPY (Mansfield) + intra-sector rank added later. */
export function scoreRelativeStrength(f: FeatureVector): ComponentScore {
  const reasons: string[] = [];
  let score = 50;
  let complete = true;

  if (f.rsMansfield != null) {
    const s = scaleLinear(f.rsMansfield, -15, 30);
    score += (s - 50) * 0.7;
    if (f.rsMansfield > 10) reasons.push(`Strong Mansfield RS +${f.rsMansfield.toFixed(1)}`);
    else if (f.rsMansfield > 0) reasons.push(`Mansfield RS +${f.rsMansfield.toFixed(1)}`);
    else reasons.push(`Weak Mansfield RS ${f.rsMansfield.toFixed(1)}`);
  } else complete = false;

  if (f.distFromHigh52wPct != null) {
    // Near-high preferred
    const s = scaleLinear(f.distFromHigh52wPct, -50, 0);
    score += (s - 50) * 0.3;
    if (f.distFromHigh52wPct > -5) reasons.push(`Within 5% of 52w high`);
    if (f.distFromHigh52wPct < -30) reasons.push(`${Math.abs(f.distFromHigh52wPct).toFixed(0)}% off 52w high`);
  }

  return { score: clamp(score), reasons, dataComplete: complete };
}

/** Risk / Stability — higher = SAFER. */
export function scoreRisk(f: FeatureVector): ComponentScore {
  const reasons: string[] = [];
  let score = 60;

  if (f.volAnn250 != null) {
    if (f.volAnn250 > 80) { score -= 25; reasons.push(`Very high volatility (${f.volAnn250.toFixed(0)}%)`); }
    else if (f.volAnn250 > 55) { score -= 15; reasons.push(`Elevated volatility (${f.volAnn250.toFixed(0)}%)`); }
    else if (f.volAnn250 < 25) { score += 8; reasons.push(`Low volatility (${f.volAnn250.toFixed(0)}%)`); }
  }

  if (f.maxDrawdown1y != null) {
    const dd = Math.abs(f.maxDrawdown1y);
    if (dd > 50) { score -= 20; reasons.push(`Severe 1y drawdown (-${dd.toFixed(0)}%)`); }
    else if (dd > 30) { score -= 10; reasons.push(`Meaningful 1y drawdown (-${dd.toFixed(0)}%)`); }
  }

  if (f.avgDollarVol20 != null) {
    if (f.avgDollarVol20 < 5_000_000) { score -= 20; reasons.push(`Thin liquidity ($${(f.avgDollarVol20 / 1e6).toFixed(1)}M/day)`); }
    else if (f.avgDollarVol20 < 20_000_000) { score -= 5; }
    else if (f.avgDollarVol20 > 500_000_000) { score += 5; reasons.push(`Deep liquidity ($${(f.avgDollarVol20 / 1e9).toFixed(1)}B/day)`); }
  }

  if (f.beta250 != null) {
    if (f.beta250 > 2) { score -= 10; reasons.push(`High beta (${f.beta250.toFixed(2)})`); }
    else if (f.beta250 > 1.5) { score -= 5; }
    else if (f.beta250 < 0.7 && f.beta250 > 0) { score += 3; }
  }

  if (f.distFromHigh52wPct != null && f.distFromHigh52wPct < -40) {
    score -= 8; reasons.push(`Broken from prior highs`);
  }

  return { score: clamp(score), reasons, dataComplete: true };
}

const DEFAULT_WEIGHTS = {
  historical: 0.30,
  momentum: 0.25,
  quality: 0.15,
  relativeStrength: 0.20,
  risk: 0.10,
} as const;

export function computeComposite(f: FeatureVector): CompositeResult {
  const components: ComponentScores = {
    historical: scoreHistorical(f),
    momentum: scoreMomentum(f),
    quality: scoreQuality(f),
    relativeStrength: scoreRelativeStrength(f),
    risk: scoreRisk(f),
  };

  // Weighted composite (risk contributes safety-inverted at declared weight).
  const composite =
    components.historical.score * DEFAULT_WEIGHTS.historical +
    components.momentum.score * DEFAULT_WEIGHTS.momentum +
    components.quality.score * DEFAULT_WEIGHTS.quality +
    components.relativeStrength.score * DEFAULT_WEIGHTS.relativeStrength +
    components.risk.score * DEFAULT_WEIGHTS.risk;

  // Agreement: 1 - stdev of component scores normalized to 0..1.
  const arr = [
    components.historical.score,
    components.momentum.score,
    components.quality.score,
    components.relativeStrength.score,
    components.risk.score,
  ];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  const agreement = clamp(100 - sd * 2, 0, 100); // sd of ~25 → agreement 50

  const nComplete = Object.values(components).filter((c) => c.dataComplete).length;
  const dataCompleteness = (nComplete / 5) * 100;

  const confidence = Math.min(agreement, dataCompleteness);

  return {
    composite,
    confidence,
    agreement,
    dataCompleteness,
    weights: { ...DEFAULT_WEIGHTS },
    components,
  };
}
