// Scoring — combines the feature vector into an ensemble of independent
// risk models, then a composite Systemic Risk Score. Each model returns a
// 0-100 contribution and a reasoning payload; the composite is the
// average of available models weighted by data confidence.
//
// This is deliberately transparent: every score traces back to the feature
// percentiles it reads. No hidden constants beyond the regime cutoffs, which
// are calibrated against historical percentile distributions of the composite.

import { FEATURE_DEFS, type FeatureVector } from "./features.server";
import { cosine } from "./stats";

export type ModelResult = {
  key: string;
  label: string;
  score: number; // 0..100
  weight: number; // 0..1
  reasoning: {
    driver: string;
    percentile?: number;
    value?: number | null;
    contribution: number; // 0..1
  }[];
};

function pickFeature(fv: FeatureVector, key: string) {
  return fv.values.find((v) => v.key === key);
}

function to100(x: number) {
  return Math.round(Math.max(0, Math.min(100, x * 100)));
}

// Model 1: yield curve stress ------------------------------------------------
function modelYieldCurve(fv: FeatureVector): ModelResult {
  const s2s = pickFeature(fv, "yc_2s10s");
  const s3m = pickFeature(fv, "yc_3m10y");
  const reasoning: ModelResult["reasoning"] = [];
  const parts: number[] = [];
  if (s2s?.risk_score != null) {
    reasoning.push({ driver: "2s10s inversion", percentile: s2s.percentile ?? undefined, value: s2s.value, contribution: s2s.risk_score });
    parts.push(s2s.risk_score);
  }
  if (s3m?.risk_score != null) {
    reasoning.push({ driver: "3m10y inversion", percentile: s3m.percentile ?? undefined, value: s3m.value, contribution: s3m.risk_score });
    parts.push(s3m.risk_score);
  }
  const raw = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  return { key: "yield_curve", label: "Yield Curve Stress", score: to100(raw), weight: parts.length ? 1 : 0, reasoning };
}

// Model 2: credit stress -----------------------------------------------------
function modelCredit(fv: FeatureVector): ModelResult {
  const hy = pickFeature(fv, "hy_spread");
  const hyD = pickFeature(fv, "hy_change_63d");
  const ig = pickFeature(fv, "ig_spread");
  const reasoning: ModelResult["reasoning"] = [];
  const parts: number[] = [];
  for (const [driver, f] of [["HY OAS level", hy], ["HY OAS 3m Δ", hyD], ["IG OAS level", ig]] as const) {
    if (f?.risk_score != null) {
      reasoning.push({ driver, percentile: f.percentile ?? undefined, value: f.value, contribution: f.risk_score });
      parts.push(f.risk_score);
    }
  }
  const raw = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  return { key: "credit", label: "Credit Stress", score: to100(raw), weight: parts.length ? 1 : 0, reasoning };
}

// Model 3: volatility regime -------------------------------------------------
function modelVolatility(fv: FeatureVector): ModelResult {
  const vix = pickFeature(fv, "vix_level");
  const vix21 = pickFeature(fv, "vix_regime_21d");
  const reasoning: ModelResult["reasoning"] = [];
  const parts: number[] = [];
  for (const [driver, f] of [["VIX spot", vix], ["VIX 21d avg", vix21]] as const) {
    if (f?.risk_score != null) {
      reasoning.push({ driver, percentile: f.percentile ?? undefined, value: f.value, contribution: f.risk_score });
      parts.push(f.risk_score);
    }
  }
  const raw = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  return { key: "volatility", label: "Volatility Regime", score: to100(raw), weight: parts.length ? 1 : 0, reasoning };
}

// Model 4: macro deterioration ----------------------------------------------
function modelMacro(fv: FeatureVector): ModelResult {
  const drivers: [string, string][] = [
    ["Unemployment 6m Δ", "unrate_change_6m"],
    ["Industrial Production YoY", "indpro_yoy"],
    ["Nonfarm Payrolls YoY", "payems_yoy"],
    ["Housing Starts YoY", "houst_yoy"],
    ["Consumer Sentiment", "sentiment_level"],
    ["CPI YoY", "cpi_yoy"],
  ];
  const reasoning: ModelResult["reasoning"] = [];
  const parts: number[] = [];
  for (const [label, key] of drivers) {
    const f = pickFeature(fv, key);
    if (f?.risk_score != null) {
      reasoning.push({ driver: label, percentile: f.percentile ?? undefined, value: f.value, contribution: f.risk_score });
      parts.push(f.risk_score);
    }
  }
  const raw = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  return { key: "macro", label: "Macro Deterioration", score: to100(raw), weight: parts.length ? 1 : 0, reasoning };
}

// Model 5: cross-asset divergence -------------------------------------------
function modelCrossAsset(fv: FeatureVector): ModelResult {
  const drivers: [string, string][] = [
    ["USD 3m Δ", "dollar_change_63d"],
    ["10Y Real Rate", "real_rate_10y"],
  ];
  const reasoning: ModelResult["reasoning"] = [];
  const parts: number[] = [];
  for (const [label, key] of drivers) {
    const f = pickFeature(fv, key);
    if (f?.risk_score != null) {
      reasoning.push({ driver: label, percentile: f.percentile ?? undefined, value: f.value, contribution: f.risk_score });
      parts.push(f.risk_score);
    }
  }
  const raw = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  return { key: "cross_asset", label: "Cross-Asset Divergence", score: to100(raw), weight: parts.length ? 1 : 0, reasoning };
}

// Model 6: breadth deterioration --------------------------------------------
// Fraction of available features currently in the top decile of risk.
function modelBreadth(fv: FeatureVector): ModelResult {
  const scored = fv.values.filter((v) => v.risk_score != null);
  if (scored.length === 0) {
    return { key: "breadth", label: "Breadth Deterioration", score: 0, weight: 0, reasoning: [] };
  }
  const hot = scored.filter((v) => (v.risk_score ?? 0) > 0.8);
  const frac = hot.length / scored.length;
  return {
    key: "breadth",
    label: "Breadth Deterioration",
    score: to100(frac),
    weight: 1,
    reasoning: hot.slice(0, 5).map((v) => ({
      driver: FEATURE_DEFS.find((d) => d.key === v.key)?.label ?? v.key,
      percentile: v.percentile ?? undefined,
      value: v.value,
      contribution: v.risk_score ?? 0,
    })),
  };
}

export function runAllModels(fv: FeatureVector): ModelResult[] {
  return [modelYieldCurve(fv), modelCredit(fv), modelVolatility(fv), modelMacro(fv), modelCrossAsset(fv), modelBreadth(fv)];
}

// -----------------------------------------------------------------------------
// Composite score

export type CompositeResult = {
  composite: number; // 0..100
  regime: "Healthy" | "Improving" | "Neutral" | "Elevated Risk" | "High Risk" | "Severe Historical Risk";
  confidence: number; // 0..1 based on coverage & tier
  models: ModelResult[];
  top_contributors: { key: string; label: string; contribution: number; percentile: number | null; value: number | null }[];
};

export function labelRegime(score: number): CompositeResult["regime"] {
  if (score < 20) return "Healthy";
  if (score < 35) return "Improving";
  if (score < 50) return "Neutral";
  if (score < 65) return "Elevated Risk";
  if (score < 80) return "High Risk";
  return "Severe Historical Risk";
}

export function composite(fv: FeatureVector, models: ModelResult[]): CompositeResult {
  const w = models.reduce((a, m) => a + m.weight, 0);
  const composite = w > 0 ? models.reduce((a, m) => a + m.score * m.weight, 0) / w : 0;

  // Confidence: coverage × tier weighting (high=1, medium=0.75, low=0.5)
  const tierW: number[] = fv.values.map((v) => {
    if (v.risk_score == null) return 0;
    const def = FEATURE_DEFS.find((d) => d.key === v.key);
    if (!def) return 0.5;
    return def.confidence_tier === "high" ? 1 : def.confidence_tier === "medium" ? 0.75 : 0.5;
  });
  const confidence = fv.coverage * (tierW.reduce((a, b) => a + b, 0) / Math.max(1, fv.values.length));

  // Top contributors — features with highest risk_score
  const top_contributors = fv.values
    .filter((v) => v.risk_score != null)
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
    .slice(0, 8)
    .map((v) => {
      const def = FEATURE_DEFS.find((d) => d.key === v.key);
      return {
        key: v.key,
        label: def?.label ?? v.key,
        contribution: v.risk_score ?? 0,
        percentile: v.percentile,
        value: v.value,
      };
    });

  return { composite, regime: labelRegime(composite), confidence, models, top_contributors };
}

// -----------------------------------------------------------------------------
// Historical analog matcher

export type AnalogMatch = {
  date: string;
  similarity: number; // 0..1
  event?: { slug: string; name: string; category: string };
  forward_outcomes?: { horizon: "1m" | "3m" | "6m" | "12m"; return: number | null };
  agreements: { key: string; label: string; risk_score: number }[];
  disagreements: { key: string; label: string; today: number; then: number }[];
};

/**
 * Convert a FeatureVector to a fixed-length numeric vector for cosine sim.
 * Missing values become 0.5 (neutral percentile).
 */
export function fvToRiskVec(fv: FeatureVector): number[] {
  return FEATURE_DEFS.map((d) => {
    const v = fv.values.find((x) => x.key === d.key);
    return v?.risk_score ?? 0.5;
  });
}

export function findAnalogs(
  today: FeatureVector,
  history: FeatureVector[],
  events: { slug: string; name: string; category: string; start_date: string; end_date: string | null }[],
  topN = 5,
): AnalogMatch[] {
  const todayVec = fvToRiskVec(today);
  const scored = history
    .filter((h) => h.as_of < today.as_of && h.coverage > 0.5)
    .map((h) => {
      const v = fvToRiskVec(h);
      // Similarity: 1 - normalized L2 distance (rescaled to [0,1])
      const diffs = todayVec.map((t, i) => Math.abs(t - v[i]));
      const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const sim = 1 - meanDiff; // meanDiff is already in [0,1]
      return { fv: h, sim, cos: cosine(todayVec, v) };
    })
    .sort((a, b) => b.sim - a.sim);

  const seenMonths = new Set<string>();
  const top: AnalogMatch[] = [];
  for (const s of scored) {
    const ym = s.fv.as_of.slice(0, 7);
    if (seenMonths.has(ym)) continue;
    seenMonths.add(ym);
    // Find event covering this date
    const t = new Date(s.fv.as_of).getTime();
    const evt = events.find((e) => {
      const st = new Date(e.start_date).getTime();
      const en = e.end_date ? new Date(e.end_date).getTime() : st + 365 * 86_400_000;
      return t >= st && t <= en;
    });
    const agreements: AnalogMatch["agreements"] = [];
    const disagreements: AnalogMatch["disagreements"] = [];
    for (const def of FEATURE_DEFS) {
      const th = today.values.find((v) => v.key === def.key)?.risk_score;
      const then = s.fv.values.find((v) => v.key === def.key)?.risk_score;
      if (th == null || then == null) continue;
      if (Math.abs(th - then) < 0.15) agreements.push({ key: def.key, label: def.label, risk_score: (th + then) / 2 });
      else if (Math.abs(th - then) > 0.4) disagreements.push({ key: def.key, label: def.label, today: th, then });
    }
    top.push({
      date: s.fv.as_of,
      similarity: s.sim,
      event: evt ? { slug: evt.slug, name: evt.name, category: evt.category } : undefined,
      agreements: agreements.slice(0, 5),
      disagreements: disagreements.slice(0, 5),
    });
    if (top.length >= topN) break;
  }
  return top;
}
