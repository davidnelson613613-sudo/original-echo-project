// AI synthesis for the Momentum Rockets scanner. Same shape as
// future-leaders/ai-thesis but with a SHORT-HORIZON angle — this is not a
// "tomorrow's compounder" note, it's a "is this thing launching right now"
// note. Hedged language only; no predictions or guarantees.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { FeatureVector } from "@/lib/future-leaders/features.server";
import type { RocketComponents } from "./models.server";
import type { RocketExtras } from "./features-extra.server";

export type RocketThesis = {
  thesis: string;
  bullCase: string[];
  bearCase: string[];
  invalidation: string[];
  watchFor: string[];
  notes: string;
};

const SCHEMA = z.object({
  thesis: z.string(),
  bullCase: z.array(z.string()),
  bearCase: z.array(z.string()),
  invalidation: z.array(z.string()),
  watchFor: z.array(z.string()),
  notes: z.string(),
});

function buildPrompt(
  symbol: string,
  name: string,
  sector: string,
  f: FeatureVector,
  x: RocketExtras,
  comp: RocketComponents,
  composite: number,
  confidence: number,
): string {
  return `You are a short-horizon momentum analyst writing an evidence-based note for the "Momentum Rockets Scanner".
This scanner surfaces small-cap and lower-liquidity names whose price-action right now resembles an active launch stage —
fresh breakouts, volume expansion, elevated realized vol, and short-term momentum. It is complementary to a long-term
compounder scanner; it is NOT a bet on multi-year fundamentals.

Rules:
- Never predict returns. Never guarantee anything. Use hedged language ("resembles", "is showing characteristics of").
- Base every claim ONLY on the numeric evidence below. Do not invent fundamentals, news, or catalysts.
- Limit each list to 3-5 items. Keep the thesis under 500 characters. Keep every bullet under 140 characters.
- This is short-horizon: think in days/weeks, not years.

Company: ${name} (${symbol}) — Sector: ${sector}
Composite score: ${composite.toFixed(1)}/100  |  Confidence: ${confidence.toFixed(0)}/100

Short-horizon price-action:
  Price: ${f.price?.toFixed(2)}  |  As of: ${f.asOf}
  1m return: ${f.ret1m?.toFixed(1) ?? "n/a"}%   3m return: ${(x.ret3mPct ?? f.ret3m)?.toFixed(1) ?? "n/a"}%
  Dist from 20d high: ${x.distFrom20dHighPct?.toFixed(1) ?? "n/a"}%
  Dist from 50d high: ${x.distFrom50dHighPct?.toFixed(1) ?? "n/a"}%
  Bars since 20d high: ${x.barsSince20dHigh ?? "n/a"}
  Up-days last 20:  ${x.upDayRatio20 != null ? (x.upDayRatio20 * 100).toFixed(0) + "%" : "n/a"}
  Up-days last 60:  ${x.upDayRatio60 != null ? (x.upDayRatio60 * 100).toFixed(0) + "%" : "n/a"}
  20d realized vol (ann): ${x.volAnn20?.toFixed(0) ?? "n/a"}%
  Volume thrust (5d/60d): ${x.dollarVolThrust5v60?.toFixed(2) ?? "n/a"}×
  Volume trend (20d/1y): ${f.volumeTrendRatio?.toFixed(2) ?? "n/a"}×
  Avg $-vol 20d: $${((f.avgDollarVol20 ?? 0) / 1e6).toFixed(1)}M/day
  Dist from 52w high: ${f.distFromHigh52wPct?.toFixed(1)}%
  Max drawdown 1y: ${f.maxDrawdown1y?.toFixed(0)}%

Component scores (0-100):
  Breakout:        ${comp.breakout.score.toFixed(0)}  — ${comp.breakout.reasons.join("; ") || "no notes"}
  Momentum:        ${comp.momentum.score.toFixed(0)}  — ${comp.momentum.reasons.join("; ") || "no notes"}
  Volume surge:    ${comp.volumeSurge.score.toFixed(0)}  — ${comp.volumeSurge.reasons.join("; ") || "no notes"}
  Volatility fuel: ${comp.volatilityFuel.score.toFixed(0)}  — ${comp.volatilityFuel.reasons.join("; ") || "no notes"}
  Risk (safer=hi): ${comp.risk.score.toFixed(0)}  — ${comp.risk.reasons.join("; ") || "no notes"}

Return JSON with:
- thesis: 2-3 sentences on why this chart's short-horizon fingerprint resembles a launching momentum name.
- bullCase: 3-5 concrete short-term strengths from the numbers above.
- bearCase: 3-5 concrete short-term risks or weak signals from the numbers above.
- invalidation: 3-5 objective price/volume signals that would say "the momentum thesis is dead" (e.g. "loses the 20-day moving average on volume").
- watchFor: 3-5 short-horizon things to watch (volume follow-through, next earnings window, sector rotation). Keep generic — no fabricated dates.
- notes: one short caveat about data limitations (price-only features, no live fundamentals or news).`;
}

export async function generateRocketThesis(
  symbol: string,
  name: string,
  sector: string,
  f: FeatureVector,
  x: RocketExtras,
  comp: RocketComponents,
  composite: number,
  confidence: number,
): Promise<RocketThesis> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    return {
      thesis: `${name} (${symbol}) is currently ranked in the Momentum Rockets universe based on its short-horizon price-action. AI synthesis is unavailable (missing LOVABLE_API_KEY).`,
      bullCase: comp.breakout.reasons.concat(comp.momentum.reasons).slice(0, 4),
      bearCase: comp.risk.reasons.slice(0, 4),
      invalidation: ["Loses 20-day moving average on volume", "Volume dries up (<0.8× baseline)"],
      watchFor: ["Follow-through day", "Next earnings window", "Sector rotation"],
      notes: "AI synthesis disabled; fallback text generated from numeric evidence.",
    };
  }

  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-3-flash-preview");

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: SCHEMA }),
      prompt: buildPrompt(symbol, name, sector, f, x, comp, composite, confidence),
    });
    return {
      thesis: String(output.thesis ?? "").slice(0, 700),
      bullCase: (output.bullCase ?? []).slice(0, 5).map((s) => String(s).slice(0, 200)),
      bearCase: (output.bearCase ?? []).slice(0, 5).map((s) => String(s).slice(0, 200)),
      invalidation: (output.invalidation ?? []).slice(0, 5).map((s) => String(s).slice(0, 200)),
      watchFor: (output.watchFor ?? []).slice(0, 5).map((s) => String(s).slice(0, 200)),
      notes: String(output.notes ?? "").slice(0, 300),
    };
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      return {
        thesis: `${name} (${symbol}) — composite ${composite.toFixed(0)}/100 with ${confidence.toFixed(0)}% confidence. AI could not parse structured output; showing numeric summary.`,
        bullCase: comp.breakout.reasons.concat(comp.momentum.reasons).slice(0, 4),
        bearCase: comp.risk.reasons.slice(0, 4),
        invalidation: ["Loses 20-day moving average on volume", "Volume dries up (<0.8× baseline)"],
        watchFor: ["Follow-through day", "Next earnings", "Sector rotation"],
        notes: "AI output was malformed; fallback summary from numeric evidence only.",
      };
    }
    throw err;
  }
}
