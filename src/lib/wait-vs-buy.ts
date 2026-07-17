// Wait-vs-Buy decision engine.
//
// Uses the ProbabilityReport (built from the closest historical analogs) to
// answer the single question users ask most: "Should I buy now, or wait for
// a lower entry?" Everything is historical evidence — never a prediction.

import type { ProbabilityReport } from "./analog-probabilities";

export type WaitVsBuyVerdict = "BUY_NOW" | "WAIT" | "SPLIT";

export type WaitVsBuyReport = {
  verdict: WaitVsBuyVerdict;
  confidence: number; // 0..100
  buyNow: {
    probImmediateRecovery: number; // P(next-5d close positive)
    probDrawdownFirst3pct: number; // P(any -3% dip within 20d)
    avgForwardReturn30d: number;
    expectedMaxAdversePct: number; // avg maxDD across matches (negative)
  };
  wait: {
    // Uses -2% below current as the "better entry" threshold.
    probBetterEntryAppears: number; // within 20d
    avgEntryImprovementPct: number; // avg dip depth conditional on reaching -2%
    probMissTheMove: number;        // P(price never revisits current within 20d AND +5% up)
    suggestedLimitPct: number;      // recommended limit-order distance %
  };
  rationale: string;
};

export function buildWaitVsBuy(
  report: ProbabilityReport,
): WaitVsBuyReport {
  const h5 = report.horizons.find((h) => h.days === 5)!;
  const h20 = report.horizons.find((h) => h.days === 20)!;
  const h30 = report.horizons.find((h) => h.days === 30) ?? h20;
  const curve = report.depthCurve;
  const probDip2 = curve.find((d) => d.dropPct === -2)?.probReached ?? 0;
  const probDip3 = curve.find((d) => d.dropPct === -3)?.probReached ?? 0;
  const probDip5 = curve.find((d) => d.dropPct === -5)?.probReached ?? 0;

  const avgMaxAdverse = h20.avgMaxDrawdownPct;

  // Buy-now side
  const buyNow = {
    probImmediateRecovery: h5.probUp,
    probDrawdownFirst3pct: probDip3,
    avgForwardReturn30d: h30.meanPct,
    expectedMaxAdversePct: avgMaxAdverse,
  };

  // Wait side — "better entry" = -2% below current.
  const probMiss = Math.max(0, (1 - probDip2) * Math.max(0, h20.probUp3));
  // Historical entry improvement: the actual average max adverse move in the matched paths.
  const avgImprovement = avgMaxAdverse;
  // Limit zone uses the nearest real depth threshold that at least ~50% of analogs touched.
  const suggestedLimitPct =
    curve.find((d) => d.probReached <= 0.55)?.dropPct ??
    curve[curve.length - 1]?.dropPct ??
    Math.min(-1, avgMaxAdverse);

  const wait = {
    probBetterEntryAppears: probDip2,
    avgEntryImprovementPct: avgImprovement,
    probMissTheMove: probMiss,
    suggestedLimitPct,
  };

  // Verdict logic — weighted, honest, never certain.
  let score = 0; // >0 → buy now, <0 → wait
  score += (h5.probUp - 0.5) * 30;              // immediate recovery bias
  score += (report.direction.reversalHigher - report.direction.continuedDecline) * 40;
  score -= (probDip3 - 0.35) * 35;              // stronger dip probability → wait
  score -= (probDip5 - 0.2) * 25;               // deep dip risk → wait
  score += (report.direction.bottomAlreadyIn - 0.5) * 30;
  score -= probMiss * 15;                       // miss risk pushes back toward buying

  let verdict: WaitVsBuyVerdict;
  if (score > 12) verdict = "BUY_NOW";
  else if (score < -12) verdict = "WAIT";
  else verdict = "SPLIT";

  const confidence = Math.round(
    Math.min(100, Math.max(0,
      report.confidenceOverall * 0.6 + Math.min(40, Math.abs(score)),
    )),
  );

  const rationale = buildRationale(verdict, buyNow, wait, report, {
    probDip2, probDip3, probDip5,
  });

  return { verdict, confidence, buyNow, wait, rationale };
}

function pctS(v: number, d = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}
function pRound(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function buildRationale(
  verdict: WaitVsBuyVerdict,
  buyNow: WaitVsBuyReport["buyNow"],
  wait: WaitVsBuyReport["wait"],
  report: ProbabilityReport,
  dips: { probDip2: number; probDip3: number; probDip5: number },
): string {
  const dir = report.direction;
  const parts: string[] = [];

  if (verdict === "BUY_NOW") {
    parts.push(
      `Historical analogs favor entering now: ${pRound(dir.reversalHigher)} reversed higher and ${pRound(dir.bottomAlreadyIn)} had the bottom already in.`,
    );
    parts.push(
      `Next 5 sessions closed positive in ${pRound(buyNow.probImmediateRecovery)} of matches; average 30d return was ${pctS(buyNow.avgForwardReturn30d)}.`,
    );
    if (dips.probDip3 > 0.35) {
      parts.push(
        `Note: ${pRound(dips.probDip3)} of matches still dipped ~3% first, so an averaging-in ladder remains reasonable.`,
      );
    }
  } else if (verdict === "WAIT") {
    parts.push(
      `Historical analogs favor patience: ${pRound(dips.probDip2)} of matches offered a better entry ~2% below here, and ${pRound(dir.continuedDecline)} continued lower before reversing.`,
    );
    parts.push(
      `Average further adverse move was ${pctS(buyNow.expectedMaxAdversePct)}. A limit near ${pctS(wait.suggestedLimitPct)} would have filled in most analogs.`,
    );
    parts.push(
      `Miss-the-move risk is ~${pRound(wait.probMissTheMove)} — small but real.`,
    );
  } else {
    parts.push(
      `Historical evidence is split: ${pRound(dir.reversalHigher)} reversed higher, ${pRound(dir.continuedDecline)} kept declining, ${pRound(dir.choppyRange)} chopped.`,
    );
    parts.push(
      `Splitting the entry (starter now + limit near ${pctS(wait.suggestedLimitPct)}) captured most analog outcomes historically.`,
    );
  }
  parts.push(
    `Confidence in this comparison: ${report.confidenceOverall}% (match quality ${report.matchQuality.replace("_", " ")}, n=${report.sampleSize}).`,
  );
  return parts.join(" ");
}
