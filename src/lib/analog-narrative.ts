// Plain-English probability narratives derived from Historical Analog Scanner
// evidence. These are attached alongside recommendations/ladder rungs so the
// user sees WHY the app suggests "buy now" vs "wait for a lower entry" — with
// the disclaimer that these are historical outcomes, not predictions.

import type { AnalogEvidence } from "./analog-search.functions";
import type { LadderRung } from "./speed-mode";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export type AnalogNarrative = {
  headline: string;               // one-line summary
  bullets: string[];              // 2–4 supporting sentences
  bias: "buy_now" | "wait" | "mixed";
  disclaimer: string;
};

export function narrativeFrom(
  a: AnalogEvidence,
  price: number,
): AnalogNarrative | null {
  if (a.sampleSize <= 0) return null;

  const declineProb = a.probContinuedDecline;
  const reversalProb = a.probReversal;
  const bottomInProb = a.probBottomIn;
  const bias: AnalogNarrative["bias"] =
    declineProb >= 0.55 && a.expectedRemainingDownsidePct <= -1.5
      ? "wait"
      : bottomInProb >= 0.55 || reversalProb >= 0.55
        ? "buy_now"
        : "mixed";

  const expDownPrice =
    a.expectedRemainingDownsidePct < 0
      ? price * (1 + a.expectedRemainingDownsidePct / 100)
      : null;

  const headline =
    bias === "wait"
      ? `Based on ${a.sampleSize} closest historical analog${a.sampleSize === 1 ? "" : "s"}, waiting for a lower entry has a probability edge.`
      : bias === "buy_now"
        ? `Based on ${a.sampleSize} closest historical analog${a.sampleSize === 1 ? "" : "s"}, buying now has a probability edge.`
        : `Based on ${a.sampleSize} closest historical analog${a.sampleSize === 1 ? "" : "s"}, the outcome is mixed — neither side has a clear edge.`;

  const bullets: string[] = [];
  bullets.push(
    `Historically, ${pct(declineProb)} of similar setups continued lower before recovering, and ${pct(reversalProb)} reversed upward from here.`,
  );
  if (a.expectedRemainingDownsidePct < -0.25 && expDownPrice) {
    bullets.push(
      `Average further downside in matching cases was ${signed(a.expectedRemainingDownsidePct)} — roughly $${expDownPrice.toFixed(2)} before a bounce.`,
    );
  }
  if (a.meanFwd30 !== null) {
    bullets.push(
      `~30 trading days after similar setups, the average move was ${signed(a.meanFwd30)}${a.meanFwd90 !== null ? `; ~90 days: ${signed(a.meanFwd90)}` : ""}.`,
    );
  }
  bullets.push(
    `Recovery rate in matches: ${pct(a.recoveryRate)}. Best analog similarity: ${Math.round(a.similarity)}% (${a.bestSymbol} · ${a.bestDate}).`,
  );

  return {
    headline,
    bullets,
    bias,
    disclaimer:
      "Historical probabilities from the closest analog matches — not a guarantee or a prediction of future returns.",
  };
}

// Per-rung tag: does buying at this rung align with the historical bias?
export function rungProbabilityNote(
  rung: LadderRung,
  a: AnalogEvidence,
  price: number,
): string | null {
  if (a.sampleSize <= 0) return null;
  const rel = (rung.price - price) / Math.max(price, 0.01);
  const isBelow = rel < -0.001;
  const expDown = a.expectedRemainingDownsidePct / 100; // negative

  if (isBelow) {
    // Waiting-for-dip rung.
    if (expDown <= rel + 0.002) {
      return `Historically favored — matches sat ~${signed(a.expectedRemainingDownsidePct)} below here on average (${pct(a.probContinuedDecline)} continued lower).`;
    }
    return `Deeper than the historical average dip (${signed(a.expectedRemainingDownsidePct)}). ${pct(a.probContinuedDecline)} of matches got this low before recovering.`;
  }
  // At or above current price.
  if (a.probBottomIn >= 0.55 || a.probReversal >= 0.55) {
    return `Historical edge for buying near current: ${pct(Math.max(a.probBottomIn, a.probReversal))} of matches reversed / bottomed from here.`;
  }
  return `${pct(a.probContinuedDecline)} of matches continued lower first — starter here trades certainty for slippage risk.`;
}

// Structured per-rung probability chip. Uses the enriched probability
// report when present (buildProbabilityReport) for historically-grounded
// reach/recover/stop probabilities; returns null when unavailable.
export function rungProbabilityChip(
  rung: LadderRung,
  a: AnalogEvidence,
  price: number,
): { reachedPct: number; recoverPct: number; stopPct: number; sample: number } | null {
  if (!a.probabilityReport) return null;
  const dist = ((rung.price - price) / Math.max(price, 0.01)) * 100;
  const report = a.probabilityReport;
  // Inline the depth-curve interpolation to avoid a cross-file import cycle.
  let reached = 1;
  if (dist < 0) {
    const sorted = [...report.depthCurve].sort((x, y) => y.dropPct - x.dropPct);
    if (dist >= sorted[0].dropPct) reached = sorted[0].probReached;
    else {
      reached = sorted[sorted.length - 1].probReached;
      for (let i = 0; i < sorted.length - 1; i++) {
        const hi = sorted[i], lo = sorted[i + 1];
        if (dist <= hi.dropPct && dist >= lo.dropPct) {
          const t = (dist - hi.dropPct) / (lo.dropPct - hi.dropPct);
          reached = hi.probReached + t * (lo.probReached - hi.probReached);
          break;
        }
      }
    }
  }
  const h = report.horizons.find((x) => x.days === 20) ?? report.horizons[0];
  const nearBottom = dist <= -3;
  return {
    reachedPct: Math.round(reached * 100),
    recoverPct: Math.round(Math.min(1, h.probUp3 + (nearBottom ? 0.15 : 0)) * 100),
    stopPct: Math.round(Math.max(0, h.failureRate - (nearBottom ? 0.1 : 0)) * 100),
    sample: h.sample,
  };
}

