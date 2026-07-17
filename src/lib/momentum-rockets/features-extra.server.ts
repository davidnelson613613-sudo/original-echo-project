// Extra short-horizon features specific to the Momentum Rockets scanner.
// The main FeatureVector from future-leaders already gives us 1m/3m returns,
// $-vol, 60d realized vol, distance from 52w high/low, etc. What we add
// here are the breakout- and thrust-specific numbers a momentum model
// wants: proximity to the 20d / 50d high, how recently the last new high
// printed, and a short-term up-day ratio.

import type { Bar } from "../market.server";

export type RocketExtras = {
  // Distance from 20-day and 50-day highs (0 = at/above high, negative = below)
  distFrom20dHighPct: number | null;
  distFrom50dHighPct: number | null;
  // Bars since the most recent 20d high (0 = today)
  barsSince20dHigh: number | null;
  // % of last 20 sessions that closed up
  upDayRatio20: number | null;
  // % of last 60 sessions that closed up
  upDayRatio60: number | null;
  // 3-month return anchored to a 63-day window (already on the main vector,
  // repeated here for convenience/clarity)
  ret3mPct: number | null;
  // Short-horizon realized volatility (annualized) — 20d window
  volAnn20: number | null;
  // Volume thrust: last 5d avg vs prior 60d avg (dollar-volume)
  dollarVolThrust5v60: number | null;
};

function pctChange(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - m) * (b - m), 0) / (nums.length - 1);
  return Math.sqrt(v);
}

export function computeRocketExtras(bars: Bar[]): RocketExtras {
  const closes = bars.map((b) => b.close);
  const price = closes[0];

  // 20d high
  let distFrom20dHighPct: number | null = null;
  let barsSince20dHigh: number | null = null;
  if (closes.length >= 20) {
    let hi = closes[0];
    let hiIdx = 0;
    for (let i = 0; i < 20; i++) {
      if (closes[i] > hi) { hi = closes[i]; hiIdx = i; }
    }
    distFrom20dHighPct = pctChange(price, hi);
    barsSince20dHigh = hiIdx;
  }

  // 50d high
  let distFrom50dHighPct: number | null = null;
  if (closes.length >= 50) {
    let hi = closes[0];
    for (let i = 0; i < 50; i++) if (closes[i] > hi) hi = closes[i];
    distFrom50dHighPct = pctChange(price, hi);
  }

  // Up-day ratios (short windows)
  let upDayRatio20: number | null = null;
  if (closes.length >= 21) {
    let up = 0;
    for (let i = 0; i < 20; i++) if (closes[i] > closes[i + 1]) up++;
    upDayRatio20 = up / 20;
  }
  let upDayRatio60: number | null = null;
  if (closes.length >= 61) {
    let up = 0;
    for (let i = 0; i < 60; i++) if (closes[i] > closes[i + 1]) up++;
    upDayRatio60 = up / 60;
  }

  // 3-month return
  const ret3mPct = closes.length > 63 ? pctChange(closes[0], closes[63]) : null;

  // 20d realized vol (annualized, %)
  let volAnn20: number | null = null;
  if (closes.length >= 21) {
    const rets: number[] = [];
    for (let i = 0; i < 20; i++) {
      const c = closes[i], p = closes[i + 1];
      if (!c || !p) { rets.length = 0; break; }
      rets.push(Math.log(c / p));
    }
    if (rets.length === 20) volAnn20 = stdev(rets) * Math.sqrt(252) * 100;
  }

  // Volume thrust: 5d dollar-vol vs prior 60d dollar-vol
  let dollarVolThrust5v60: number | null = null;
  if (bars.length >= 65 && bars[0].volume != null) {
    let s5 = 0, n5 = 0, s60 = 0, n60 = 0;
    for (let i = 0; i < 5; i++) {
      const v = bars[i].volume;
      if (v != null) { s5 += v * bars[i].close; n5++; }
    }
    for (let i = 5; i < 65; i++) {
      const v = bars[i].volume;
      if (v != null) { s60 += v * bars[i].close; n60++; }
    }
    if (n5 > 0 && n60 > 0) {
      const avg5 = s5 / n5, avg60 = s60 / n60;
      if (avg60 > 0) dollarVolThrust5v60 = avg5 / avg60;
    }
  }

  return {
    distFrom20dHighPct,
    distFrom50dHighPct,
    barsSince20dHigh,
    upDayRatio20,
    upDayRatio60,
    ret3mPct,
    volAnn20,
    dollarVolThrust5v60,
  };
}
