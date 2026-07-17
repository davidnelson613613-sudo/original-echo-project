import type { ScanRow } from "./market.functions";
import type { LadderRung } from "./speed-mode";
import type { AnalogEvidence } from "./analog-search.functions";
import { probabilityPriceReaches } from "./analog-probabilities";

export type MomentumState = "NONE" | "APPROACHING" | "BREAKOUT";

export type Augmentation = {
  isShallowDip: boolean;
  momentum: MomentumState;
  conviction: number; // 0-100
  convictionLabel: "LOW" | "MEDIUM" | "MED-HIGH" | "HIGH";
  convictionMult: number; // 0.5-1.5 sizing multiplier
};

export function augment(row: ScanRow): Augmentation {
  const dd = row.drawdown20Pct;
  const isShallowDip =
    dd < 0 &&
    dd >= -2.5 &&
    (row.regime === "SLOW_BLEED" ||
      row.regime === "FAKE_OUT" ||
      row.regime === "NO_DIP");

  const highRatio = row.high20 > 0 ? row.price / row.high20 : 0;
  const momentum: MomentumState =
    highRatio >= 1 ? "BREAKOUT" : highRatio >= 0.985 ? "APPROACHING" : "NONE";

  const conviction = Math.round(
    row.confidence * 0.5 + row.setupQuality * 0.3 + row.executionConfidence * 0.2,
  );
  const convictionLabel: Augmentation["convictionLabel"] =
    conviction >= 80
      ? "HIGH"
      : conviction >= 60
        ? "MED-HIGH"
        : conviction >= 40
          ? "MEDIUM"
          : "LOW";
  const convictionMult =
    conviction >= 80 ? 1.5 : conviction >= 60 ? 1.15 : conviction >= 40 ? 1.0 : 0.6;

  return { isShallowDip, momentum, conviction, convictionLabel, convictionMult };
}

// Alternative shallow-dip ladder (3 tight rungs) — used when Speed Mode is
// not conservative and drawdown is only 1–2.5%. ATR-heuristic version;
// prefer analogLadder() when historical evidence is available.
export function shallowDipLadder(row: ScanRow): LadderRung[] {
  const p = row.price;
  const a = Math.max(0.5, row.atr14);
  const r = (n: number) => Math.round(n * 100) / 100;
  return [
    {
      pct: 0.5,
      price: r(p),
      label: "Shallow Dip · Starter",
      reason: "Small dip — deploy half now near current price.",
      source: "atr_heuristic",
    },
    {
      pct: 0.3,
      price: r(p - 0.3 * a),
      label: "Shallow Dip · Add 1",
      reason: "Modest further weakness (0.3·ATR below current).",
      source: "atr_heuristic",
    },
    {
      pct: 0.2,
      price: r(p - 0.7 * a),
      label: "Shallow Dip · Add 2",
      reason: "Deeper flush (0.7·ATR) — final rung.",
      source: "atr_heuristic",
    },
  ];
}

// Momentum add-into-strength ladder (used for breakout mode). ATR-heuristic;
// prefer analogLadder() when historical evidence is available.
export function momentumLadder(row: ScanRow): LadderRung[] {
  const p = row.price;
  const a = Math.max(0.5, row.atr14);
  const r = (n: number) => Math.round(n * 100) / 100;
  return [
    {
      pct: 0.35,
      price: r(p),
      label: "Momentum · Starter",
      reason: "Breakout confirmed — enter on strength at current.",
      source: "atr_heuristic",
    },
    {
      pct: 0.4,
      price: r(p + 0.3 * a),
      label: "Momentum · Add on Strength",
      reason: "Buy stop / add as breakout extends 0.3·ATR higher.",
      source: "atr_heuristic",
    },
    {
      pct: 0.25,
      price: r(p - 0.4 * a),
      label: "Momentum · Pullback Catch",
      reason: "Small pullback add — don't chase, wait for retest.",
      source: "atr_heuristic",
    },
  ];
}

// Analog-derived ladder. Rungs are placed at depth levels where historical
// matches actually retraced to (depth-curve percentiles), and each rung
// carries the empirical probability that price reached it within 90 days.
// Returns null when the analog sample is too small to trust — callers
// should degrade to the ATR ladders above.
export function analogLadder(row: ScanRow, analog: AnalogEvidence | null): LadderRung[] | null {
  const report = analog?.probabilityReport;
  if (!report || report.sampleSize < 3) return null;

  const p = row.price;
  const r = (n: number) => Math.round(n * 100) / 100;

  // Pick depth targets adaptively from the historical distribution.
  // Starter = at market. Add-1 = ~40th-percentile dip. Add-2 = ~70th-pct dip.
  // "Percentile of dip" means: the depth level that this many analogs at
  // least reached, so the probReached values fall in a legible band.
  const curve = [...report.depthCurve].sort((a, b) => b.dropPct - a.dropPct);
  const pickDepth = (targetProb: number): number => {
    // find shallowest depth whose probReached <= targetProb (i.e. dip that
    // meaningfully filters analogs). curve is ordered -1, -2, -3, -5, -8, -12.
    for (const point of curve) {
      if (point.probReached <= targetProb) return point.dropPct;
    }
    return curve[curve.length - 1].dropPct;
  };

  const d1 = pickDepth(0.6); // rung 2: reached by ~60% of matches
  const d2 = pickDepth(0.3); // rung 3: reached by ~30% of matches (deep flush)
  // If distribution is very shallow (all thresholds > 0.6), widen d2.
  const dip1 = Math.min(-0.5, d1);
  const dip2 = Math.min(dip1 - 1, d2);

  const price1 = p;
  const price2 = r(p * (1 + dip1 / 100));
  const price3 = r(p * (1 + dip2 / 100));

  const prob1 = 1;
  const prob2 = probabilityPriceReaches(report.depthCurve, dip1);
  const prob3 = probabilityPriceReaches(report.depthCurve, dip2);

  const conf = report.confidenceOverall;
  const n = report.sampleSize;

  // Weight allocation toward the rung with the strongest historical hit
  // rate. Never fully abandon the starter — historical bottom-in probability
  // still means "buy some now".
  const bottomIn = report.direction.bottomAlreadyIn;
  const starterPct = Math.max(0.25, Math.min(0.6, 0.3 + bottomIn * 0.4));
  const remaining = 1 - starterPct;
  const add1Pct = remaining * (prob2 >= 0.35 ? 0.6 : 0.5);
  const add2Pct = remaining - add1Pct;

  return [
    {
      pct: starterPct,
      price: r(price1),
      label: "Analog · Starter",
      reason: `Deploy at market. ${Math.round(bottomIn * 100)}% of ${n} matches had the bottom already in.`,
      source: "analog",
      probReached: prob1,
      sample: n,
      confidence: conf,
    },
    {
      pct: add1Pct,
      price: price2,
      label: "Analog · Add 1",
      reason: `Add if price revisits ${dip1.toFixed(1)}% below — ${Math.round(prob2 * 100)}% of matches reached this depth within 90d.`,
      source: "analog",
      probReached: prob2,
      sample: n,
      confidence: conf,
    },
    {
      pct: add2Pct,
      price: price3,
      label: "Analog · Deep Add",
      reason: `Deep flush add at ${dip2.toFixed(1)}% below — ${Math.round(prob3 * 100)}% of matches got this low before recovering.`,
      source: "analog",
      probReached: prob3,
      sample: n,
      confidence: conf,
    },
  ];
}