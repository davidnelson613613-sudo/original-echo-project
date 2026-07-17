// Bracket exits per rung: take-profit, stop-loss, trail activation.
//
// Preferred source: the ProbabilityReport built from the closest historical
// analog matches (real forward-return distribution — mean max rally, mean
// max drawdown at the 20-day horizon). ATR is only used as a labelled
// fallback when the analog engine has insufficient data. Every bracket
// carries provenance so the UI can show sample size / confidence or a
// clear "insufficient data" warning instead of quietly serving a heuristic
// number as if it were historically grounded.

import type { AnalogEvidence } from "./analog-search.functions";

export type BracketSource = "analog" | "atr_fallback" | "insufficient_data";

export type Bracket = {
  tp1: number;
  tp2: number;
  stop: number;
  trailFrom: number;
  rrRatio: number;
  source: BracketSource;
  sample: number;         // number of historical matches backing tp/stop (0 for fallback)
  confidence: number;     // 0..100 (0 for fallback)
  note: string;           // human-readable provenance line
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Legacy ATR-only bracket. Kept for the fallback path; marked as such via
// `source: "atr_fallback"` so downstream UI can flag it honestly.
export function computeBracket(entry: number, atr: number): Bracket {
  const a = Math.max(0.01, atr);
  return {
    tp1: round2(entry + a),
    tp2: round2(entry + 2 * a),
    stop: round2(entry - 1.5 * a),
    trailFrom: round2(entry + a),
    rrRatio: 2 / 1.5,
    source: "atr_fallback",
    sample: 0,
    confidence: 0,
    note: "Fallback: entry ± ATR multiples. Historical analog data not available for this symbol.",
  };
}

// Analog-derived bracket. TP/SL come from the distribution of forward max
// rally / max drawdown across the closest historical matches (20-day
// horizon), not from an ATR multiple. Returns null when the analog set is
// too small/weak to be trustworthy — callers should fall back to
// `computeBracket(entry, atr)` and the UI should surface the fallback badge.
export function computeAnalogBracket(
  entry: number,
  analog: AnalogEvidence | null,
): Bracket | null {
  const report = analog?.probabilityReport;
  if (!report) return null;
  const h20 = report.horizons.find((h) => h.days === 20);
  if (!h20 || h20.sample < 3) return null;

  // Percent moves at the 20-day horizon. p25 / p75 give an honest asymmetric
  // band grounded in the historical distribution rather than a symmetric ATR
  // spread. Fall back to mean rally / drawdown if percentiles are degenerate.
  const rallyPct = h20.p75 > 0 ? h20.p75 : Math.max(0.5, h20.avgMaxRallyPct);
  const targetPct = h20.p90 > 0 ? h20.p90 : rallyPct * 1.5;
  // Max drawdown across analogs is already negative; clamp so a rare positive
  // slip doesn't produce a stop above entry.
  const stopPct = Math.min(-0.5, h20.avgMaxDrawdownPct);

  const tp1 = entry * (1 + rallyPct / 100);
  const tp2 = entry * (1 + targetPct / 100);
  const stop = entry * (1 + stopPct / 100);
  const reward = Math.max(0.01, tp2 - entry);
  const risk = Math.max(0.01, entry - stop);

  return {
    tp1: round2(tp1),
    tp2: round2(tp2),
    stop: round2(stop),
    trailFrom: round2(tp1),
    rrRatio: reward / risk,
    source: "analog",
    sample: h20.sample,
    confidence: h20.confidence,
    note: `Derived from ${h20.sample} historical matches (20-day horizon). Take-profits at p75/p90 forward move; stop at average max drawdown.`,
  };
}

// Prefer analog-derived; degrade gracefully to ATR fallback with clear marker.
export function computeBracketFor(
  entry: number,
  atr: number,
  analog: AnalogEvidence | null,
): Bracket {
  return computeAnalogBracket(entry, analog) ?? computeBracket(entry, atr);
}