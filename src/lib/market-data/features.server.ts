// Feature engineering — computes the daily "market fingerprint" from FRED
// macro series stored in market_series. All features are normalized (z-score
// vs. expanding history + long-history percentile) so cross-regime comparison
// is meaningful.
//
// New features can be added by appending to FEATURE_DEFS. Each feature is
// self-describing: source series, formula, confidence tier, category block.

import {
  historyUpTo,
  percentileRank,
  pctChangeDays,
  rollingWindow,
  valueAt,
  yoyPct,
  zscore,
} from "./stats";

export type SeriesPoint = { date: string; value: number };
export type SeriesMap = Map<string, SeriesPoint[]>; // series_id -> sorted ASC

export type FeatureBlock =
  | "rates"
  | "credit"
  | "stress"
  | "macro"
  | "cross_asset"
  | "market_structure";

export type FeatureDef = {
  key: string;
  label: string;
  block: FeatureBlock;
  confidence_tier: "high" | "medium" | "low";
  formula: string;
  sources: string[];
  /** Directional weight for risk composite: +1 means higher value => higher risk */
  risk_direction: 1 | -1 | 0;
  /** Compute raw value for a given iso date; return null if data missing */
  compute: (iso: string, sm: SeriesMap) => number | null;
};

// -----------------------------------------------------------------------------
// Feature definitions

export const FEATURE_DEFS: FeatureDef[] = [
  {
    key: "yc_2s10s",
    label: "10Y - 2Y Yield Spread",
    block: "rates",
    confidence_tier: "high",
    formula: "FRED T10Y2Y level; inversion (negative) => risk",
    sources: ["T10Y2Y"],
    risk_direction: -1,
    compute: (iso, sm) => valueAt(sm.get("T10Y2Y") ?? [], iso)?.value ?? null,
  },
  {
    key: "yc_3m10y",
    label: "10Y - 3M Yield Spread",
    block: "rates",
    confidence_tier: "high",
    formula: "FRED T10Y3M level; inversion => risk",
    sources: ["T10Y3M"],
    risk_direction: -1,
    compute: (iso, sm) => valueAt(sm.get("T10Y3M") ?? [], iso)?.value ?? null,
  },
  {
    key: "hy_spread",
    label: "High Yield OAS",
    block: "credit",
    confidence_tier: "high",
    formula: "BAMLH0A0HYM2 level; wider => risk",
    sources: ["BAMLH0A0HYM2"],
    risk_direction: 1,
    compute: (iso, sm) => valueAt(sm.get("BAMLH0A0HYM2") ?? [], iso)?.value ?? null,
  },
  {
    key: "hy_change_63d",
    label: "HY OAS 3-Month Change",
    block: "credit",
    confidence_tier: "high",
    formula: "BAMLH0A0HYM2 % change over ~63 trading days",
    sources: ["BAMLH0A0HYM2"],
    risk_direction: 1,
    compute: (iso, sm) => pctChangeDays(sm.get("BAMLH0A0HYM2") ?? [], iso, 90),
  },
  {
    key: "ig_spread",
    label: "IG Corporate OAS",
    block: "credit",
    confidence_tier: "high",
    formula: "BAMLC0A0CM level; wider => risk",
    sources: ["BAMLC0A0CM"],
    risk_direction: 1,
    compute: (iso, sm) => valueAt(sm.get("BAMLC0A0CM") ?? [], iso)?.value ?? null,
  },
  {
    key: "vix_level",
    label: "VIX Level",
    block: "stress",
    confidence_tier: "high",
    formula: "VIXCLS spot level",
    sources: ["VIXCLS"],
    risk_direction: 1,
    compute: (iso, sm) => valueAt(sm.get("VIXCLS") ?? [], iso)?.value ?? null,
  },
  {
    key: "vix_regime_21d",
    label: "VIX 21-Day Average",
    block: "stress",
    confidence_tier: "high",
    formula: "21-day mean of VIXCLS",
    sources: ["VIXCLS"],
    risk_direction: 1,
    compute: (iso, sm) => {
      const w = rollingWindow(sm.get("VIXCLS") ?? [], iso, 30);
      if (w.length < 5) return null;
      return w.reduce((a, b) => a + b, 0) / w.length;
    },
  },
  {
    key: "unrate_change_6m",
    label: "Unemployment 6-Month Change",
    block: "macro",
    confidence_tier: "high",
    formula: "UNRATE current - value 6 months ago (percentage points)",
    sources: ["UNRATE"],
    risk_direction: 1,
    compute: (iso, sm) => {
      const s = sm.get("UNRATE") ?? [];
      const cur = valueAt(s, iso);
      if (!cur) return null;
      const t = new Date(cur.date).getTime();
      const cutoff = t - 180 * 86_400_000;
      let prev: SeriesPoint | null = null;
      for (const v of s) {
        if (new Date(v.date).getTime() <= cutoff) prev = v;
        else break;
      }
      return prev ? cur.value - prev.value : null;
    },
  },
  {
    key: "cpi_yoy",
    label: "CPI YoY",
    block: "macro",
    confidence_tier: "high",
    formula: "CPIAUCSL year-over-year percent change",
    sources: ["CPIAUCSL"],
    risk_direction: 1,
    compute: (iso, sm) => {
      const s = sm.get("CPIAUCSL") ?? [];
      const cur = valueAt(s, iso);
      return cur ? yoyPct(s, cur.date) : null;
    },
  },
  {
    key: "indpro_yoy",
    label: "Industrial Production YoY",
    block: "macro",
    confidence_tier: "high",
    formula: "INDPRO YoY; decline => risk",
    sources: ["INDPRO"],
    risk_direction: -1,
    compute: (iso, sm) => {
      const s = sm.get("INDPRO") ?? [];
      const cur = valueAt(s, iso);
      return cur ? yoyPct(s, cur.date) : null;
    },
  },
  {
    key: "payems_yoy",
    label: "Nonfarm Payrolls YoY",
    block: "macro",
    confidence_tier: "high",
    formula: "PAYEMS YoY; decline => risk",
    sources: ["PAYEMS"],
    risk_direction: -1,
    compute: (iso, sm) => {
      const s = sm.get("PAYEMS") ?? [];
      const cur = valueAt(s, iso);
      return cur ? yoyPct(s, cur.date) : null;
    },
  },
  {
    key: "houst_yoy",
    label: "Housing Starts YoY",
    block: "macro",
    confidence_tier: "medium",
    formula: "HOUST YoY; decline => risk",
    sources: ["HOUST"],
    risk_direction: -1,
    compute: (iso, sm) => {
      const s = sm.get("HOUST") ?? [];
      const cur = valueAt(s, iso);
      return cur ? yoyPct(s, cur.date) : null;
    },
  },
  {
    key: "sentiment_level",
    label: "UMich Consumer Sentiment",
    block: "macro",
    confidence_tier: "medium",
    formula: "UMCSENT level; lower => risk",
    sources: ["UMCSENT"],
    risk_direction: -1,
    compute: (iso, sm) => valueAt(sm.get("UMCSENT") ?? [], iso)?.value ?? null,
  },
  {
    key: "m2_yoy",
    label: "M2 Money Supply YoY",
    block: "macro",
    confidence_tier: "medium",
    formula: "M2SL YoY; extreme values (both ends) inform regime, not risk directly",
    sources: ["M2SL"],
    risk_direction: 0,
    compute: (iso, sm) => {
      const s = sm.get("M2SL") ?? [];
      const cur = valueAt(s, iso);
      return cur ? yoyPct(s, cur.date) : null;
    },
  },
  {
    key: "dollar_change_63d",
    label: "USD 3-Month Change",
    block: "cross_asset",
    confidence_tier: "medium",
    formula: "DTWEXBGS % change over 90 days; sharp strength => risk",
    sources: ["DTWEXBGS"],
    risk_direction: 1,
    compute: (iso, sm) => pctChangeDays(sm.get("DTWEXBGS") ?? [], iso, 90),
  },
  {
    key: "real_rate_10y",
    label: "10Y Real Rate (DGS10 - CPI YoY)",
    block: "cross_asset",
    confidence_tier: "medium",
    formula: "DGS10 minus CPIAUCSL YoY",
    sources: ["DGS10", "CPIAUCSL"],
    risk_direction: 1,
    compute: (iso, sm) => {
      const dgs = valueAt(sm.get("DGS10") ?? [], iso);
      const cpi = sm.get("CPIAUCSL") ?? [];
      const cpiPt = valueAt(cpi, iso);
      if (!dgs || !cpiPt) return null;
      const yoy = yoyPct(cpi, cpiPt.date);
      if (yoy == null) return null;
      return dgs.value - yoy * 100;
    },
  },
];

export const FEATURE_KEYS = FEATURE_DEFS.map((f) => f.key);

// -----------------------------------------------------------------------------
// Loader

/** Load all series referenced by FEATURE_DEFS into a map, sorted ASC by date */
export async function loadSeriesMap(): Promise<SeriesMap> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const wantedIds = Array.from(new Set(FEATURE_DEFS.flatMap((f) => f.sources)));
  const sm: SeriesMap = new Map();
  // Fetch in chunks to keep response sizes reasonable.
  for (const sid of wantedIds) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabaseAdmin
      .from("market_series")
      .select("date, value")
      .eq("source", "fred")
      .eq("series_id", sid)
      .order("date", { ascending: true })
      .limit(50_000);
    if (error) throw new Error(`loadSeriesMap ${sid}: ${error.message}`);
    sm.set(
      sid,
      (data ?? [])
        .map((r) => ({ date: r.date as string, value: Number(r.value) }))
        .filter((r) => Number.isFinite(r.value)),
    );
  }
  return sm;
}

// -----------------------------------------------------------------------------
// Feature vector

export type FeatureValue = {
  key: string;
  block: FeatureBlock;
  confidence_tier: FeatureDef["confidence_tier"];
  value: number | null;
  zscore: number | null;
  percentile: number | null;
  risk_score: number | null; // 0..1 (higher = more risk contribution)
};

export type FeatureVector = {
  as_of: string;
  values: FeatureValue[];
  missing: string[];
  coverage: number; // 0..1
};

/**
 * Compute the feature vector at iso. Normalization uses the full history of
 * each individual feature computed up to iso (expanding window), which keeps
 * the calc reproducible from raw data alone.
 */
export function computeFeatureVector(iso: string, sm: SeriesMap): FeatureVector {
  const values: FeatureValue[] = [];
  const missing: string[] = [];

  for (const def of FEATURE_DEFS) {
    const raw = def.compute(iso, sm);
    if (raw == null || !Number.isFinite(raw)) {
      values.push({
        key: def.key,
        block: def.block,
        confidence_tier: def.confidence_tier,
        value: null,
        zscore: null,
        percentile: null,
        risk_score: null,
      });
      missing.push(def.key);
      continue;
    }
    // Build the historical distribution of this feature by walking dates
    // Approximation: use the source-series dates as "candidate anchors" and
    // recompute the feature at each. To keep this fast we sample instead.
    const history = buildFeatureHistory(def, sm, iso);
    const zs = history.length > 5 ? zscore(raw, history) : 0;
    const pct = history.length > 5 ? percentileRank(raw, history) : 0.5;

    // risk_score in [0,1]: percentile if risk_direction=+1, (1-percentile) if -1,
    // and distance-from-median for direction=0 (both tails risky).
    let risk: number;
    if (def.risk_direction === 1) risk = pct;
    else if (def.risk_direction === -1) risk = 1 - pct;
    else risk = Math.abs(pct - 0.5) * 2;

    values.push({
      key: def.key,
      block: def.block,
      confidence_tier: def.confidence_tier,
      value: raw,
      zscore: zs,
      percentile: pct,
      risk_score: risk,
    });
  }

  const coverage = 1 - missing.length / FEATURE_DEFS.length;
  return { as_of: iso, values, missing, coverage };
}

/**
 * Build the historical distribution for a feature by evaluating at monthly
 * anchor dates (fast + representative). Uses primary source series dates as
 * candidate anchors.
 */
function buildFeatureHistory(def: FeatureDef, sm: SeriesMap, isoUpTo: string): number[] {
  const primary = def.sources[0];
  const s = sm.get(primary);
  if (!s || s.length === 0) return [];
  const t = new Date(isoUpTo).getTime();
  const out: number[] = [];
  // Monthly sampling — one anchor per month
  const seen = new Set<string>();
  for (const p of s) {
    if (new Date(p.date).getTime() > t) break;
    const ym = p.date.slice(0, 7);
    if (seen.has(ym)) continue;
    seen.add(ym);
    const v = def.compute(p.date, sm);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Compute the feature vector at many dates (used by backtests & analog matcher).
 * Anchors are monthly (start-of-month) for speed.
 */
export function computeVectorSeries(sm: SeriesMap, startIso: string, endIso: string): FeatureVector[] {
  const anchors: string[] = [];
  const start = new Date(startIso);
  const end = new Date(endIso);
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur.getTime() <= end.getTime()) {
    anchors.push(cur.toISOString().slice(0, 10));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return anchors.map((iso) => computeFeatureVector(iso, sm));
}
