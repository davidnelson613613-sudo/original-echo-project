// Momentum Rockets scoring: 5 components tuned for SHORT-HORIZON, small-cap,
// momentum-with-breakout setups. Very different weighting from Future
// Leaders — no multi-year CAGR, no long-horizon fingerprints. This model
// answers "does this thing look like it's launching right now?".

import type { FeatureVector } from "../future-leaders/features.server";
import type { RocketExtras } from "./features-extra.server";

export type RocketComponent = {
  score: number; // 0..100
  reasons: string[];
  dataComplete: boolean;
};

export type RocketComponents = {
  breakout: RocketComponent;
  momentum: RocketComponent;
  volumeSurge: RocketComponent;
  volatilityFuel: RocketComponent;
  risk: RocketComponent; // higher = safer (i.e. less-blown-out)
};

export type RocketComposite = {
  composite: number;
  confidence: number;
  weights: Record<string, number>;
  agreement: number;
  dataCompleteness: number;
  components: RocketComponents;
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
function scaleLinear(x: number | null | undefined, lo: number, hi: number): number {
  if (x == null || !Number.isFinite(x)) return 50;
  if (hi === lo) return 50;
  return clamp(((x - lo) / (hi - lo)) * 100);
}

// -------- 1. Breakout: proximity + recency of a new 20/50d high --------
export function scoreBreakout(x: RocketExtras): RocketComponent {
  const reasons: string[] = [];
  let score = 50;
  let complete = true;

  if (x.distFrom20dHighPct != null) {
    // 0% (at high) = 100 score, -12% or worse = 0 score
    const s = scaleLinear(x.distFrom20dHighPct, -12, 0);
    score += (s - 50) * 0.5;
    if (x.distFrom20dHighPct > -1.5) reasons.push(`At/near 20-day high (${x.distFrom20dHighPct.toFixed(1)}%)`);
    else if (x.distFrom20dHighPct < -8) reasons.push(`${Math.abs(x.distFrom20dHighPct).toFixed(0)}% off 20-day high`);
  } else complete = false;

  if (x.distFrom50dHighPct != null) {
    const s = scaleLinear(x.distFrom50dHighPct, -20, 0);
    score += (s - 50) * 0.3;
    if (x.distFrom50dHighPct > -3) reasons.push(`Testing 50-day high`);
  } else complete = false;

  if (x.barsSince20dHigh != null) {
    // Fresh highs (0-2 bars) score highest
    if (x.barsSince20dHigh <= 1) { score += 8; reasons.push("New 20-day high in last 2 sessions"); }
    else if (x.barsSince20dHigh <= 5) { score += 3; }
    else if (x.barsSince20dHigh >= 15) { score -= 5; }
  }

  return { score: clamp(score), reasons, dataComplete: complete };
}

// -------- 2. Momentum: 1m/3m returns + short up-day persistence --------
export function scoreMomentum(f: FeatureVector, x: RocketExtras): RocketComponent {
  const reasons: string[] = [];
  let score = 50;
  let complete = true;

  if (f.ret1m != null) {
    const s = scaleLinear(f.ret1m, -10, 40);
    score += (s - 50) * 0.4;
    if (f.ret1m > 25) reasons.push(`1m return +${f.ret1m.toFixed(0)}% (explosive)`);
    else if (f.ret1m > 12) reasons.push(`1m return +${f.ret1m.toFixed(0)}%`);
    else if (f.ret1m < -5) reasons.push(`1m return ${f.ret1m.toFixed(1)}% (weak)`);
  } else { complete = false; }

  const ret3m = x.ret3mPct ?? f.ret3m;
  if (ret3m != null) {
    const s = scaleLinear(ret3m, -15, 80);
    score += (s - 50) * 0.3;
    if (ret3m > 50) reasons.push(`3m return +${ret3m.toFixed(0)}%`);
    if (ret3m < -15) reasons.push(`3m return ${ret3m.toFixed(0)}%`);
  }

  if (x.upDayRatio20 != null) {
    const s = scaleLinear(x.upDayRatio20 * 100, 45, 70);
    score += (s - 50) * 0.15;
    if (x.upDayRatio20 > 0.65) reasons.push(`${(x.upDayRatio20 * 100).toFixed(0)}% up-days last month`);
  }

  if (x.upDayRatio60 != null) {
    const s = scaleLinear(x.upDayRatio60 * 100, 45, 65);
    score += (s - 50) * 0.15;
  }

  return { score: clamp(score), reasons, dataComplete: complete };
}

// -------- 3. Volume Surge: recent $-volume vs baseline --------
export function scoreVolumeSurge(f: FeatureVector, x: RocketExtras): RocketComponent {
  const reasons: string[] = [];
  let score = 50;
  let complete = true;

  if (x.dollarVolThrust5v60 != null) {
    const s = scaleLinear(x.dollarVolThrust5v60, 0.7, 3.0);
    score += (s - 50) * 0.55;
    if (x.dollarVolThrust5v60 > 2) reasons.push(`5d volume ${x.dollarVolThrust5v60.toFixed(1)}× 60d baseline`);
    else if (x.dollarVolThrust5v60 > 1.4) reasons.push(`Volume expanding (${x.dollarVolThrust5v60.toFixed(2)}× baseline)`);
    else if (x.dollarVolThrust5v60 < 0.8) reasons.push(`Volume drying up (${x.dollarVolThrust5v60.toFixed(2)}× baseline)`);
  } else { complete = false; }

  if (f.volumeTrendRatio != null) {
    // 20d / 250d — captures the medium-term expansion
    const s = scaleLinear(f.volumeTrendRatio, 0.8, 2.5);
    score += (s - 50) * 0.35;
    if (f.volumeTrendRatio > 1.6) reasons.push(`20d/1y volume ${f.volumeTrendRatio.toFixed(2)}×`);
  }

  if (f.avgDollarVol20 != null) {
    // Small kicker for actually tradeable liquidity ($5M+/day)
    if (f.avgDollarVol20 > 5_000_000) score += 3;
  }

  return { score: clamp(score), reasons, dataComplete: complete };
}

// -------- 4. Volatility Fuel: elevated but not blown-out realized vol --------
// Rockets need fuel. Ultra-quiet names don't launch; already-blown-out names
// are usually past the move. Sweet spot: annualized 20d vol between 40-90%.
export function scoreVolatilityFuel(x: RocketExtras): RocketComponent {
  const reasons: string[] = [];
  let score = 50;
  let complete = true;

  if (x.volAnn20 != null) {
    const v = x.volAnn20;
    if (v < 20) { score -= 20; reasons.push(`Quiet chart (${v.toFixed(0)}% ann vol) — no fuel`); }
    else if (v < 35) { score -= 5; }
    else if (v >= 40 && v <= 90) {
      score += 20;
      reasons.push(`Active range (${v.toFixed(0)}% ann vol) — fuel present`);
    } else if (v > 90 && v <= 130) {
      score += 5;
      reasons.push(`Very active (${v.toFixed(0)}% ann vol) — late-stage risk`);
    } else if (v > 130) {
      score -= 15;
      reasons.push(`Extreme vol (${v.toFixed(0)}% ann) — likely blown out`);
    }
  } else { complete = false; }

  return { score: clamp(score), reasons, dataComplete: complete };
}

// -------- 5. Risk (higher = SAFER): guardrails against dead / illiquid --------
export function scoreRisk(f: FeatureVector): RocketComponent {
  const reasons: string[] = [];
  let score = 65;

  if (f.avgDollarVol20 != null) {
    if (f.avgDollarVol20 < 500_000) { score -= 30; reasons.push(`Very thin ($${(f.avgDollarVol20 / 1e3).toFixed(0)}k/day)`); }
    else if (f.avgDollarVol20 < 2_000_000) { score -= 12; reasons.push(`Thin liquidity ($${(f.avgDollarVol20 / 1e6).toFixed(1)}M/day)`); }
    else if (f.avgDollarVol20 > 50_000_000) { score += 4; }
  }

  if (f.maxDrawdown1y != null) {
    const dd = Math.abs(f.maxDrawdown1y);
    if (dd > 70) { score -= 20; reasons.push(`Catastrophic 1y drawdown (-${dd.toFixed(0)}%)`); }
    else if (dd > 50) { score -= 10; reasons.push(`Severe 1y drawdown (-${dd.toFixed(0)}%)`); }
  }

  if (f.distFromHigh52wPct != null && f.distFromHigh52wPct < -60) {
    score -= 12; reasons.push(`${Math.abs(f.distFromHigh52wPct).toFixed(0)}% off 52w high (broken)`);
  }

  if (f.price != null && f.price < 2) {
    score -= 8; reasons.push(`Sub-$2 price (elevated blowup risk)`);
  }

  return { score: clamp(score), reasons, dataComplete: true };
}

const DEFAULT_WEIGHTS = {
  breakout: 0.25,
  momentum: 0.30,
  volumeSurge: 0.20,
  volatilityFuel: 0.10,
  risk: 0.15,
} as const;

export function computeRocketComposite(
  f: FeatureVector,
  x: RocketExtras,
): RocketComposite {
  const components: RocketComponents = {
    breakout: scoreBreakout(x),
    momentum: scoreMomentum(f, x),
    volumeSurge: scoreVolumeSurge(f, x),
    volatilityFuel: scoreVolatilityFuel(x),
    risk: scoreRisk(f),
  };

  const composite =
    components.breakout.score * DEFAULT_WEIGHTS.breakout +
    components.momentum.score * DEFAULT_WEIGHTS.momentum +
    components.volumeSurge.score * DEFAULT_WEIGHTS.volumeSurge +
    components.volatilityFuel.score * DEFAULT_WEIGHTS.volatilityFuel +
    components.risk.score * DEFAULT_WEIGHTS.risk;

  const arr = [
    components.breakout.score,
    components.momentum.score,
    components.volumeSurge.score,
    components.volatilityFuel.score,
    components.risk.score,
  ];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  const agreement = clamp(100 - sd * 2, 0, 100);

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

// -------- Eligibility filter: keep only small-cap / low-liq / non-dead --------
// Applied BEFORE ranking so blue chips (AAPL, NVDA…) never appear here.
export function isRocketEligible(f: FeatureVector): boolean {
  // Must have a real price and enough liquidity to actually trade
  if (f.price == null || f.price < 1) return false;
  if (f.avgDollarVol20 == null || f.avgDollarVol20 < 500_000) return false;
  // Skip mega-caps: either the price is low OR the $-volume is modest.
  // A blue-chip like AAPL trades $10B+/day at $200 → excluded.
  const smallCap = f.price < 20 || f.avgDollarVol20 < 30_000_000;
  if (!smallCap) return false;
  // Skip left-for-dead names
  if (f.distFromHigh52wPct != null && f.distFromHigh52wPct < -85) return false;
  return true;
}
