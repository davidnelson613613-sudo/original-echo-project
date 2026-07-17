// AI synthesis: convert a numeric evidence bundle into a plain-English
// thesis, bull/bear case, catalysts, and analog candidates.
// Uses Lovable AI Gateway with a guarded structured-output call.

import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { FeatureVector } from "./features.server";
import type { ComponentScores } from "./models.server";

export type AiThesis = {
  thesis: string;
  bullCase: string[];
  bearCase: string[];
  catalysts: string[];
  primaryAnalogs: string[];
  notes: string;
};

const THESIS_SCHEMA = z.object({
  thesis: z.string(),
  bullCase: z.array(z.string()),
  bearCase: z.array(z.string()),
  catalysts: z.array(z.string()),
  primaryAnalogs: z.array(z.string()),
  notes: z.string(),
});

function buildPrompt(
  symbol: string,
  name: string,
  sector: string,
  f: FeatureVector,
  comp: ComponentScores,
  composite: number,
  confidence: number,
): string {
  return `You are a research analyst writing a concise, evidence-based note for the "Future Leaders Scanner".
This scanner surfaces companies whose price-action fingerprint currently resembles historical mega-winners
(Nvidia, Apple, Amazon, Microsoft, Netflix, Costco, Monster, Broadcom, etc.) at similar stages of their development.

Never predict returns. Never guarantee anything. Use hedged language ("resembles", "has characteristics of").
Base every claim ONLY on the numeric evidence below — do not invent fundamentals you can't see.
Limit each list to 3-5 items. Keep the thesis under 500 characters. Keep every bullet under 140 characters.

Company: ${name} (${symbol}) — Sector: ${sector}
Composite score: ${composite.toFixed(1)}/100  |  Confidence: ${confidence.toFixed(0)}/100

Price-action features:
  Price: ${f.price?.toFixed(2)}  |  As of: ${f.asOf}
  5y CAGR: ${f.cagr5y?.toFixed(1) ?? "n/a"}%  |  3y CAGR: ${f.cagr3y?.toFixed(1) ?? "n/a"}%
  12-1 momentum: ${f.ret12m1m?.toFixed(1) ?? "n/a"}%  |  6m return: ${f.ret6m?.toFixed(1) ?? "n/a"}%
  Distance from 200SMA: ${f.distSma200Pct?.toFixed(1) ?? "n/a"}%  |  200SMA slope: ${f.sma200SlopePct?.toFixed(1) ?? "n/a"}%
  Stage-2 uptrend: ${f.stage2 ? "yes" : "no"}  |  Distance from 52w high: ${f.distFromHigh52wPct?.toFixed(1)}%
  Mansfield RS: ${f.rsMansfield?.toFixed(1) ?? "n/a"}  |  Alpha vs SPY: ${f.alphaAnn250?.toFixed(1) ?? "n/a"}%/yr
  Realized vol (1y ann): ${f.volAnn250?.toFixed(0) ?? "n/a"}%  |  Beta: ${f.beta250?.toFixed(2) ?? "n/a"}
  Max drawdown 1y/3y: ${f.maxDrawdown1y?.toFixed(0)}% / ${f.maxDrawdown3y?.toFixed(0)}%
  Avg $-volume 20d: $${((f.avgDollarVol20 ?? 0) / 1e6).toFixed(0)}M

Component scores (0-100):
  Historical similarity: ${comp.historical.score.toFixed(0)}  — ${comp.historical.reasons.join("; ")}
  Momentum & trend:      ${comp.momentum.score.toFixed(0)}  — ${comp.momentum.reasons.join("; ")}
  Quality proxy:         ${comp.quality.score.toFixed(0)}  — ${comp.quality.reasons.join("; ")}
  Relative strength:     ${comp.relativeStrength.score.toFixed(0)}  — ${comp.relativeStrength.reasons.join("; ")}
  Risk (higher=safer):   ${comp.risk.score.toFixed(0)}  — ${comp.risk.reasons.join("; ")}

Return JSON with:
- thesis: 2-4 sentences on why this company's fingerprint resembles historical winners at similar stages.
- bullCase: 3-5 concrete strengths from the numbers above.
- bearCase: 3-5 concrete risks or weak signals from the numbers above.
- catalysts: 3-5 general catalysts to watch (earnings, sector rotation, macro). Keep generic — no fabricated dates.
- primaryAnalogs: 2-4 historical mega-winner tickers whose price-action stage most closely resembles this one.
- notes: one short caveat about data limitations (price-only features, no live fundamentals in this MVP).`;
}

export async function generateThesis(
  symbol: string,
  name: string,
  sector: string,
  f: FeatureVector,
  comp: ComponentScores,
  composite: number,
  confidence: number,
): Promise<AiThesis> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    return {
      thesis: `${name} (${symbol}) is currently ranked in the Future Leaders universe based on its multi-year price-action fingerprint. AI synthesis is unavailable (missing LOVABLE_API_KEY).`,
      bullCase: comp.historical.reasons.concat(comp.momentum.reasons).slice(0, 4),
      bearCase: comp.risk.reasons.slice(0, 4),
      catalysts: ["Next earnings report", "Sector rotation shifts", "Macro rate expectations"],
      primaryAnalogs: [],
      notes: "AI synthesis disabled; fallback text generated from numeric evidence.",
    };
  }

  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-3-flash-preview");

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: THESIS_SCHEMA }),
      prompt: buildPrompt(symbol, name, sector, f, comp, composite, confidence),
    });
    return {
      thesis: String(output.thesis ?? "").slice(0, 700),
      bullCase: (output.bullCase ?? []).slice(0, 5).map((s) => String(s).slice(0, 200)),
      bearCase: (output.bearCase ?? []).slice(0, 5).map((s) => String(s).slice(0, 200)),
      catalysts: (output.catalysts ?? []).slice(0, 5).map((s) => String(s).slice(0, 200)),
      primaryAnalogs: (output.primaryAnalogs ?? []).slice(0, 4).map((s) => String(s).toUpperCase().slice(0, 10)),
      notes: String(output.notes ?? "").slice(0, 300),
    };
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      // Fall back to numeric-only summary.
      return {
        thesis: `${name} (${symbol}) — composite ${composite.toFixed(0)}/100 with ${confidence.toFixed(0)}% confidence. AI could not parse structured output; showing numeric summary.`,
        bullCase: comp.historical.reasons.concat(comp.momentum.reasons).slice(0, 4),
        bearCase: comp.risk.reasons.slice(0, 4),
        catalysts: ["Next earnings report", "Sector rotation", "Macro shifts"],
        primaryAnalogs: [],
        notes: "AI output was malformed; fallback summary from numeric evidence only.",
      };
    }
    throw err;
  }
}
