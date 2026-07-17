// Deep on-demand report generator for one Future Leaders ranking row.
//
// Combines real, sourced evidence (price-action features + component scores
// already stored on the ranking row) with the fundamentals bundle
// (EDGAR + Yahoo quoteSummary + Finnhub) and an AI-generated deep narrative
// (thesis, growth drivers, bull/bear, price scenarios).
//
// All numbers rendered in the UI must be traceable to a source; every
// projected number is labeled as an "AI Estimate" with a confidence value.

import { z } from "zod";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { buildFundamentalsBundle, type FundamentalsBundle } from "./fundamentals-score.server";
import type { FeatureVector } from "./features.server";

export type DeepReportComponents = {
  historical: number;
  momentum: number;
  quality: number;
  relativeStrength: number;
  risk: number;
};

export type ScoreBreakdownItem = {
  label: string;
  points: number;   // contribution to composite (already weighted)
  maxPoints: number;
  raw: number;      // 0..100 raw component
  weight: number;   // fraction of composite this contributes
  source: string;   // e.g. "price-action", "sec-edgar", "yahoo", "finnhub"
  detail: string;
};

export type PriceScenario = {
  horizon: "1y" | "3y" | "5y" | "10y";
  conservative: number; // % return
  base: number;
  bull: number;
  confidence: number;   // 0..100
  rationale: string;
};

export type DeepReport = {
  symbol: string;
  name: string;
  sector: string;
  generatedAt: string;
  aiSucceeded: boolean;
  dataQuality: {
    score: number;
    reasons: string[];
    sources: string[];
  };
  scoreBreakdown: {
    items: ScoreBreakdownItem[];
    compositeVerified: number;
  };
  fundamentals: {
    revenueYoYPct: number | null;
    revenue3yCagrPct: number | null;
    grossMarginPct: number | null;
    operatingMarginPct: number | null;
    fcfMarginPct: number | null;
    ruleOf40: number | null;
    epsYoYPct: number | null;
    shareDilution3yPct: number | null;
    insiderNetDollars90d: number | null;
    heldPercentInstitutions: number | null;
    recommendationMean: number | null;
    analystTargetUpside: number | null;
    marketCap: number | null;
    forwardPE: number | null;
    sources: string[];
  };
  analog: {
    primaryAnalogs: string[];
    similarityNotes: string[];
    matchedFeatures: string[];
    differingFeatures: string[];
  };
  aiThesis: {
    overview: string;               // 4-8 sentence why-selected narrative, evidence-linked
    whyRankedHere: string[];        // company-specific reasons rooted in the numbers
    historicalPatternExplained: string; // long-form: why this fingerprint resembles winners
    keyMetricsExplained: Array<{ metric: string; value: string; interpretation: string }>;
    oneYearOutlook: string;         // what the AI expects over the next ~12 months and why
    differentiators: string[];      // what sets it apart in its sector
    growthDrivers: string[];        // labeled catalysts
    competitiveMoat: string[];
    bullCase: string[];
    bearCase: string[];
    invalidation: string[];         // what would flip the thesis
    whatToWatch: string[];          // specific data points/events to monitor
  };
  scenarios: PriceScenario[];
  disclaimer: string;
};

const DEEP_SCHEMA = z.object({
  overview: z.string(),
  whyRankedHere: z.array(z.string()),
  historicalPatternExplained: z.string(),
  keyMetricsExplained: z.array(z.object({
    metric: z.string(),
    value: z.string(),
    interpretation: z.string(),
  })),
  oneYearOutlook: z.string(),
  differentiators: z.array(z.string()),
  growthDrivers: z.array(z.string()),
  competitiveMoat: z.array(z.string()),
  bullCase: z.array(z.string()),
  bearCase: z.array(z.string()),
  invalidation: z.array(z.string()),
  whatToWatch: z.array(z.string()),
  primaryAnalogs: z.array(z.string()),
  similarityNotes: z.array(z.string()),
  matchedFeatures: z.array(z.string()),
  differingFeatures: z.array(z.string()),
  scenarios: z.array(z.object({
    horizon: z.string(),
    conservative: z.number(),
    base: z.number(),
    bull: z.number(),
    confidence: z.number(),
    rationale: z.string(),
  })),
});

function computeDataQuality(features: FeatureVector, fb: FundamentalsBundle): { score: number; reasons: string[]; sources: string[] } {
  const reasons: string[] = [];
  const sources = ["yahoo-daily-bars", ...fb.sources];
  let score = 30; // baseline for having price-action bars

  if (features.barsAvailable >= 1260) { score += 20; reasons.push("5+ years of price history"); }
  else if (features.barsAvailable >= 756) { score += 12; reasons.push("3+ years of price history"); }
  else if (features.barsAvailable >= 252) { score += 6; reasons.push("1+ year of price history"); }
  else reasons.push(`Only ${features.barsAvailable} bars available (limited history)`);

  if (fb.edgar?.hasData) { score += 20; reasons.push("SEC EDGAR filings present"); }
  else reasons.push("No SEC EDGAR filings (likely ADR or recent IPO)");

  if (fb.yahoo) { score += 15; reasons.push("Yahoo quoteSummary (analyst + institutional)"); }
  if (fb.finnhub?.hasData) { score += 15; reasons.push("Finnhub fundamentals (insider + revisions)"); }

  return { score: Math.min(100, score), reasons, sources };
}

function buildScoreBreakdown(
  components: DeepReportComponents,
  weights: Record<string, number>,
  fb: FundamentalsBundle,
  composite: number,
): { items: ScoreBreakdownItem[]; compositeVerified: number } {
  const items: ScoreBreakdownItem[] = [];
  const wHist = weights.historical ?? 0.25;
  const wMom = weights.momentum ?? 0.20;
  const wQual = weights.quality ?? 0.20;
  const wRs = weights.relativeStrength ?? 0.15;
  const wRisk = weights.risk ?? 0.20;

  items.push({
    label: "Historical winner similarity",
    raw: components.historical,
    weight: wHist,
    points: components.historical * wHist,
    maxPoints: 100 * wHist,
    source: "price-action",
    detail: "How closely the multi-year price/trend fingerprint matches historical mega-winners at similar stages.",
  });
  items.push({
    label: "Momentum & trend",
    raw: components.momentum,
    weight: wMom,
    points: components.momentum * wMom,
    maxPoints: 100 * wMom,
    source: "price-action",
    detail: "12-1 momentum, 6m return, distance from 200-SMA, stage-2 uptrend.",
  });
  items.push({
    label: "Quality proxy",
    raw: components.quality,
    weight: wQual,
    points: components.quality * wQual,
    maxPoints: 100 * wQual,
    source: fb.edgar?.hasData ? "sec-edgar + price-action" : "price-action",
    detail: fb.edgar?.hasData
      ? `Blends realized-vol/DD with fundamentals: gross ${fb.edgar.grossMarginPct?.toFixed(0) ?? "—"}%, op ${fb.edgar.operatingMarginPct?.toFixed(0) ?? "—"}%, FCF ${fb.edgar.fcfMarginPct?.toFixed(0) ?? "—"}%.`
      : "Realized vol and drawdown control (no EDGAR fallback).",
  });
  items.push({
    label: "Relative strength",
    raw: components.relativeStrength,
    weight: wRs,
    points: components.relativeStrength * wRs,
    maxPoints: 100 * wRs,
    source: "price-action",
    detail: "Mansfield RS vs SPY, annualized alpha, beta.",
  });
  items.push({
    label: "Risk (higher = safer)",
    raw: components.risk,
    weight: wRisk,
    points: components.risk * wRisk,
    maxPoints: 100 * wRisk,
    source: "price-action",
    detail: "Realized vol, max drawdown, dollar-volume liquidity floor.",
  });

  // Fundamentals sidecar contributions (only shown when data present)
  if (fb.growth.dataComplete) {
    items.push({
      label: "Revenue growth (fundamental)",
      raw: fb.growth.score,
      weight: 0.10,
      points: fb.growth.score * 0.10,
      maxPoints: 10,
      source: "sec-edgar",
      detail: fb.growth.reasons.join("; ") || "—",
    });
  }
  if (fb.profitability.dataComplete) {
    items.push({
      label: "Profitability (fundamental)",
      raw: fb.profitability.score,
      weight: 0.08,
      points: fb.profitability.score * 0.08,
      maxPoints: 8,
      source: "sec-edgar",
      detail: fb.profitability.reasons.join("; ") || "—",
    });
  }
  if (fb.insider.dataComplete) {
    items.push({
      label: "Insider & institutional",
      raw: fb.insider.score,
      weight: 0.05,
      points: fb.insider.score * 0.05,
      maxPoints: 5,
      source: "finnhub + yahoo",
      detail: fb.insider.reasons.join("; ") || "—",
    });
  }
  if (fb.analyst.dataComplete) {
    items.push({
      label: "Analyst sentiment",
      raw: fb.analyst.score,
      weight: 0.05,
      points: fb.analyst.score * 0.05,
      maxPoints: 5,
      source: "yahoo + finnhub",
      detail: fb.analyst.reasons.join("; ") || "—",
    });
  }

  return { items, compositeVerified: composite };
}

function buildPrompt(args: {
  symbol: string; name: string; sector: string;
  features: FeatureVector; composite: number; confidence: number;
  components: DeepReportComponents;
  fb: FundamentalsBundle;
}): string {
  const { symbol, name, sector, features: f, composite, confidence, components, fb } = args;
  const edgar = fb.edgar;
  const y = fb.yahoo;
  const fh = fb.finnhub;
  return `You are a senior equity research analyst writing a DEEP, EXTENSIVE, evidence-based long-term thesis for the "Future Leaders" scanner.
You are analyzing companies that MAY resemble future long-term compounders (like Nvidia, Amazon, Apple, Costco, Netflix, Tesla) at earlier stages.
The user wants to understand SPECIFICALLY why THIS company earned its rank, what the historical data is signaling, and what to watch — not generic filler.

HARD RULES:
- Never predict returns. Never guarantee outcomes. Use hedged language ("resembles", "has characteristics of", "based on available evidence").
- Every claim MUST be supported by a number in the evidence block, or explicitly framed as a qualitative inference. Do NOT invent revenue figures, market share, product names, or dates. If you don't have a number for something, say "not available in this dataset".
- Scenario returns are ESTIMATES generated from historical price-action fingerprints and current fundamentals. Attach a confidence to each. They are not forecasts.
- Be SPECIFIC: cite the actual numbers ("12-1 momentum of 47%", "gross margin 68%", "distance from 200-SMA 22%"). Never write generic bullets like "strong momentum" or "good fundamentals" without a number attached.
- Overview: 4-8 sentences, 400-900 characters, tightly linked to the numbers.
- historicalPatternExplained: 3-6 sentences (400-900 chars) describing precisely which fingerprint features match which historical mega-winners at similar stages, and which stage of the winner-lifecycle this looks like.
- oneYearOutlook: 3-6 sentences on what the price fingerprint + fundamentals imply is most likely over the next ~12 months (base + range), what would confirm the thesis, and what would break it.
- Each bullet under 240 characters. 4-8 items in whyRankedHere and keyMetricsExplained. 3-6 items in every other list.

Company: ${name} (${symbol})  Sector: ${sector}
Composite: ${composite.toFixed(1)}/100  Confidence: ${confidence.toFixed(0)}/100

Price-action evidence:
  Price ${f.price?.toFixed(2)} as of ${f.asOf} | 5y CAGR ${f.cagr5y?.toFixed(1) ?? "n/a"}% | 3y CAGR ${f.cagr3y?.toFixed(1) ?? "n/a"}%
  12-1 momentum ${f.ret12m1m?.toFixed(1) ?? "n/a"}% | 6m ${f.ret6m?.toFixed(1) ?? "n/a"}%
  Dist 200SMA ${f.distSma200Pct?.toFixed(1) ?? "n/a"}% | 200SMA slope ${f.sma200SlopePct?.toFixed(1) ?? "n/a"}%
  Stage-2 ${f.stage2 ? "yes" : "no"} | Off 52w high ${f.distFromHigh52wPct?.toFixed(1)}%
  Mansfield RS ${f.rsMansfield?.toFixed(1) ?? "n/a"} | Alpha vs SPY ${f.alphaAnn250?.toFixed(1) ?? "n/a"}%/yr
  Vol ann ${f.volAnn250?.toFixed(0) ?? "n/a"}% | Beta ${f.beta250?.toFixed(2) ?? "n/a"}
  Max DD 1y/3y ${f.maxDrawdown1y?.toFixed(0)}% / ${f.maxDrawdown3y?.toFixed(0)}%
  Avg $-vol 20d $${((f.avgDollarVol20 ?? 0) / 1e6).toFixed(0)}M

Components (0-100):
  Historical similarity ${components.historical.toFixed(0)}
  Momentum ${components.momentum.toFixed(0)}
  Quality ${components.quality.toFixed(0)}
  Relative strength ${components.relativeStrength.toFixed(0)}
  Risk ${components.risk.toFixed(0)}

Fundamentals (${fb.sources.join(", ") || "limited coverage"}):
  Revenue YoY: ${edgar?.revenueYoYPct?.toFixed(1) ?? "n/a"}%
  Revenue 3y CAGR: ${edgar?.revenue3yCagrPct?.toFixed(1) ?? "n/a"}%
  Gross margin: ${edgar?.grossMarginPct?.toFixed(1) ?? "n/a"}%
  Operating margin: ${edgar?.operatingMarginPct?.toFixed(1) ?? "n/a"}%
  FCF margin: ${edgar?.fcfMarginPct?.toFixed(1) ?? "n/a"}%
  Rule-of-40: ${edgar?.ruleOf40?.toFixed(0) ?? "n/a"}
  EPS YoY: ${edgar?.epsYoYPct?.toFixed(1) ?? "n/a"}%
  Share dilution 3y: ${edgar?.shareDilution3yPct?.toFixed(1) ?? "n/a"}%
  Insider net $ (90d): ${fh?.insiderNetDollars90d != null ? `$${(fh.insiderNetDollars90d/1e6).toFixed(2)}M` : "n/a"}
  Institutional ownership: ${y?.heldPercentInstitutions != null ? (y.heldPercentInstitutions*100).toFixed(0) + "%" : "n/a"}
  Analyst consensus: ${y?.recommendationMean?.toFixed(2) ?? "n/a"} (1=strong buy, 5=sell)
  Target upside: ${y?.analystTargetUpside?.toFixed(0) ?? "n/a"}%
  Market cap: ${y?.marketCap != null ? `$${(y.marketCap/1e9).toFixed(1)}B` : "n/a"}
  Forward P/E: ${y?.forwardPE?.toFixed(1) ?? "n/a"}

Return JSON with:
- overview: 4-8 sentences on why THIS company's evidence specifically resembles historical compounders at similar stages. Reference actual numbers. Company-specific, never generic.
- whyRankedHere: 4-8 concrete, evidence-linked reasons WHY this stock earned its composite score. Cite specific numbers from the evidence block. Example: "12-1 momentum of 47% ranks in the top decile of the universe" not "strong momentum".
- historicalPatternExplained: A 3-6 sentence paragraph describing which specific past mega-winners had a similar fingerprint at similar stages, WHICH features (stage-2 uptrend, RS Mansfield, distance-from-200SMA, drawdown profile) look most alike, and roughly WHERE in the winner-lifecycle this appears to be (early stage-2 breakout / mid-cycle continuation / late-stage extension). Never invent tickers — pick from real historical winners.
- keyMetricsExplained: 6-12 objects each with {metric, value, interpretation}. Cover the most decisive metrics for this specific rank (mix of price-action and fundamentals when available). Interpretation must be 1-2 sentences on WHAT that number tells us in this context.
- oneYearOutlook: 3-6 sentences on the most probable 12-month path implied by the fingerprint + fundamentals, what would CONFIRM the thesis (specific price/fundamental thresholds), and what would BREAK it.
- differentiators: 3-5 concrete factors from the evidence that set it apart in its sector.
- growthDrivers: 3-6 revenue/earnings/margin drivers supported by numbers above (or price-action signals when fundamentals missing).
- competitiveMoat: 3-5 moat characteristics INFERRED FROM MARGIN STRUCTURE + INDUSTRY (e.g. "60%+ gross margins suggest pricing power"). Do not fabricate product names.
- bullCase: 3-5 bullets grounded in the numbers.
- bearCase: 3-5 concrete risks (valuation, competition, macro, fundamental weakness).
- invalidation: 3-5 specific things that would flip the thesis negative (e.g. "revenue growth decelerating below 15% YoY", "loss of stage-2 uptrend", "insider selling exceeds $20M/quarter").
- whatToWatch: 4-8 specific, near-term data points or events worth monitoring (next earnings print, 200-SMA reclaim/loss, RS breakdown vs SPY, insider window opening, etc.).
- primaryAnalogs: 2-4 historical mega-winner tickers whose fingerprint most closely resembles this one at this stage (NVDA, AAPL, AMZN, MSFT, COST, MNST, AVGO, NFLX, TSLA, SHOP, etc.).
- similarityNotes: 2-4 sentences explaining WHY those analogs match (which characteristics).
- matchedFeatures: 3-6 specific features that match the analogs (stage-2, high margins, accelerating growth, etc.).
- differingFeatures: 2-5 features that DIFFER from the analogs and warrant caution.
- scenarios: exactly 4 objects for horizons ["1y","3y","5y","10y"]. Each has:
    - conservative: total return % (10th percentile of analog forward returns tempered by current fundamentals). Can be negative.
    - base: median case %
    - bull: 90th percentile %
    - confidence: 0..100 (LOWER for longer horizons; LOWER when fundamentals or history is thin)
    - rationale: one sentence tying the range to analog history + fundamentals
  Scenarios must be internally consistent (conservative <= base <= bull) and hedged (never wildly optimistic without evidence).`;
}

export async function generateDeepReport(args: {
  symbol: string;
  name: string;
  sector: string;
  features: FeatureVector;
  composite: number;
  confidence: number;
  components: DeepReportComponents;
  weights: Record<string, number>;
}): Promise<DeepReport> {
  const fb = await buildFundamentalsBundle(args.symbol);
  const dataQuality = computeDataQuality(args.features, fb);
  const scoreBreakdown = buildScoreBreakdown(args.components, args.weights, fb, args.composite);

  let aiOut: z.infer<typeof DEEP_SCHEMA> | null = null;
  const key = process.env.LOVABLE_API_KEY;
  const modelChain = [
    "google/gemini-2.5-flash", // fastest, reliable JSON
    "openai/gpt-5.5",          // strict json_schema, high fidelity
    "google/gemini-2.5-pro",   // deepest reasoning, slower
  ];
  let lastAiError: string | null = null;
  if (key) {
    const gateway = createLovableAiGatewayProvider(key);
    const prompt = buildPrompt({ ...args, fb });
    for (const modelId of modelChain) {
      try {
        const { output } = await generateText({
          model: gateway(modelId),
          output: Output.object({ schema: DEEP_SCHEMA }),
          prompt,
        });
        aiOut = output as z.infer<typeof DEEP_SCHEMA>;
        if (aiOut && aiOut.overview && Array.isArray(aiOut.whyRankedHere) && aiOut.whyRankedHere.length > 0) {
          console.log(`[deep-report] ${args.symbol} AI generated via ${modelId}`);
          break;
        }
        aiOut = null; // structurally empty; try next model
      } catch (err) {
        lastAiError = err instanceof Error ? err.message : String(err);
        if (NoObjectGeneratedError.isInstance(err)) {
          console.error(`[deep-report] ${args.symbol} ${modelId} produced malformed JSON — falling back`);
        } else {
          console.error(`[deep-report] ${args.symbol} ${modelId} failed:`, lastAiError);
        }
      }
    }
  }
  const aiSucceeded = !!aiOut && !!aiOut.overview && Array.isArray(aiOut.whyRankedHere) && aiOut.whyRankedHere.length > 0;

  const horizons: Array<"1y" | "3y" | "5y" | "10y"> = ["1y", "3y", "5y", "10y"];
  const scenarios: PriceScenario[] = horizons.map((h) => {
    const found = aiOut?.scenarios.find((s) => s.horizon === h);
    if (found) {
      const c = Number(found.conservative);
      const b = Number(found.base);
      const u = Number(found.bull);
      // Enforce ordering defensively
      const [lo, mid, hi] = [c, b, u].sort((x, y) => x - y);
      return {
        horizon: h,
        conservative: lo,
        base: mid,
        bull: hi,
        confidence: Math.max(0, Math.min(100, Number(found.confidence) || 0)),
        rationale: String(found.rationale ?? "").slice(0, 280),
      };
    }
    // Fallback: derive from CAGR + component-inferred noise so a report still has scenarios.
    const cagr = args.features.cagr5y ?? args.features.cagr3y ?? 8;
    const years = h === "1y" ? 1 : h === "3y" ? 3 : h === "5y" ? 5 : 10;
    const base = (Math.pow(1 + cagr / 100, years) - 1) * 100;
    return {
      horizon: h,
      conservative: base * 0.3,
      base,
      bull: base * 1.8,
      confidence: Math.max(15, 60 - years * 4),
      rationale: "Fallback estimate from realized CAGR (AI unavailable).",
    };
  });

  return {
    symbol: args.symbol,
    name: args.name,
    sector: args.sector,
    generatedAt: new Date().toISOString(),
    aiSucceeded,
    dataQuality,
    scoreBreakdown,
    fundamentals: {
      revenueYoYPct: fb.edgar?.revenueYoYPct ?? null,
      revenue3yCagrPct: fb.edgar?.revenue3yCagrPct ?? null,
      grossMarginPct: fb.edgar?.grossMarginPct ?? null,
      operatingMarginPct: fb.edgar?.operatingMarginPct ?? null,
      fcfMarginPct: fb.edgar?.fcfMarginPct ?? null,
      ruleOf40: fb.edgar?.ruleOf40 ?? null,
      epsYoYPct: fb.edgar?.epsYoYPct ?? null,
      shareDilution3yPct: fb.edgar?.shareDilution3yPct ?? null,
      insiderNetDollars90d: fb.finnhub?.insiderNetDollars90d ?? null,
      heldPercentInstitutions: fb.yahoo?.heldPercentInstitutions ?? null,
      recommendationMean: fb.yahoo?.recommendationMean ?? null,
      analystTargetUpside: fb.yahoo?.analystTargetUpside ?? null,
      marketCap: fb.yahoo?.marketCap ?? null,
      forwardPE: fb.yahoo?.forwardPE ?? null,
      sources: fb.sources,
    },
    analog: {
      primaryAnalogs: aiOut?.primaryAnalogs?.slice(0, 4).map((s) => String(s).toUpperCase()) ?? [],
      similarityNotes: aiOut?.similarityNotes?.slice(0, 4) ?? [],
      matchedFeatures: aiOut?.matchedFeatures?.slice(0, 6) ?? [],
      differingFeatures: aiOut?.differingFeatures?.slice(0, 5) ?? [],
    },
    aiThesis: {
      overview: aiOut?.overview ?? `${args.name} (${args.symbol}) ranks in the Future Leaders universe based on its multi-year price-action fingerprint (composite ${args.composite.toFixed(0)}/100, confidence ${args.confidence.toFixed(0)}/100). AI narrative unavailable — showing numeric evidence only.`,
      whyRankedHere: aiOut?.whyRankedHere?.slice(0, 8) ?? [],
      historicalPatternExplained: aiOut?.historicalPatternExplained ?? "",
      keyMetricsExplained: aiOut?.keyMetricsExplained?.slice(0, 12) ?? [],
      oneYearOutlook: aiOut?.oneYearOutlook ?? "",
      differentiators: aiOut?.differentiators?.slice(0, 5) ?? [],
      growthDrivers: aiOut?.growthDrivers?.slice(0, 6) ?? [],
      competitiveMoat: aiOut?.competitiveMoat?.slice(0, 5) ?? [],
      bullCase: aiOut?.bullCase?.slice(0, 5) ?? [],
      bearCase: aiOut?.bearCase?.slice(0, 5) ?? [],
      invalidation: aiOut?.invalidation?.slice(0, 5) ?? [],
      whatToWatch: aiOut?.whatToWatch?.slice(0, 8) ?? [],
    },
    scenarios,
    disclaimer: "Research framework — not financial advice. All projected returns are AI-generated estimates from historical price-action fingerprints and current fundamentals, not guarantees or predictions of future performance.",
  };
}