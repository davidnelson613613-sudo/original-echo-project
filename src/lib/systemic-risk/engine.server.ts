// Systemic Risk Engine — orchestration layer.
//
// Loads the multi-asset universe, computes today's feature vector, finds
// the most similar historical periods, calculates outcome-conditional
// probabilities, and produces an Early Warning Score with full
// explainability.

import {
  ANALOG_ELIGIBLE_EVENTS,
  CRISIS_EVENTS,
  type CrisisEvent,
  type CrisisKind,
} from "./crises";
import {
  buildNormStats,
  computeFeaturesAt,
  cosineSim,
  FEATURE_KEYS,
  loadUniverse,
  zScore,
  type FeatureKey,
  type FeatureVector,
  type NormStats,
  type UniverseSnapshot,
} from "./features.server";
import { indexOnOrBefore } from "./data.server";

export type AnalogMatch = {
  event_id: string;
  event_label: string;
  event_kind: CrisisKind;
  match_date: string;
  days_before_trough: number;
  similarity: number;   // 0..100
  outcome_dd_pct: number; // realized SPY drawdown to event trough
  outcome_days_to_trough: number;
};

export type RegimeLabel =
  | "healthy"
  | "correction"
  | "elevated_risk"
  | "high_risk"
  | "crisis";

export type Snapshot = {
  as_of: string;
  early_warning_score: number; // 0..100
  regime: RegimeLabel;
  probabilities: Record<CrisisKind, number>;
  features_raw: FeatureVector;
  features_z: FeatureVector;
  top_analogs: AnalogMatch[];
  drivers: Array<{ key: FeatureKey; z: number; contribution: number; direction: "risk-on" | "risk-off" }>;
  disagreements: Array<{ key: FeatureKey; z: number; note: string }>;
  data_coverage: { features_present: number; features_total: number; missing_keys: FeatureKey[] };
  meta: {
    universe_symbols: number;
    normstats_sample_size: number;
    analog_windows_scanned: number;
    days_around_event: number;
  };
};

// Feature "direction": +z means more risk (higher VIX, deeper DD, etc.)
// The sign flips a raw z-score into a risk contribution. Tuned to align
// with historical bear-market fingerprints, not opinion.
const FEATURE_RISK_SIGN: Record<FeatureKey, 1 | -1 | 0> = {
  spy_ret_20d: -1,
  spy_ret_60d: -1,
  spy_ret_252d: -1,
  spy_dd_252d: -1,        // more negative dd -> risk up
  spy_dist_sma200: -1,    // below SMA200 -> risk up
  spy_dist_sma50: -1,
  spy_realized_vol_20d: +1,
  vix_level: +1,
  vix_chg_20d: +1,
  vix_term_ratio: +1,     // >1 = inverted, stress
  iwm_spy_60d: -1,        // small caps lagging = risk
  hyg_lqd_60d: -1,        // HY lagging IG = credit stress
  tlt_20d: 0,             // ambiguous
  ief_shy_60d: 0,
  uup_60d: +1,            // strong dollar = risk-off historically
  gld_spy_60d: +1,        // gold outperforming = risk-off
  uso_60d: 0,
  sector_dispersion_60d: +1,
  defensive_cyclical_ratio: +1, // defensives beating cyclicals = risk-off
  sector_breadth_sma200: -1,    // fewer sectors above SMA200 = risk
  efa_spy_60d: 0,
  eem_spy_60d: 0,
};

// Weights normalize each feature's contribution to the EWS. Non-zero
// weights come from historical importance in bear-market analogs.
const FEATURE_WEIGHT: Record<FeatureKey, number> = {
  spy_dd_252d: 1.4,
  spy_dist_sma200: 1.3,
  spy_realized_vol_20d: 1.2,
  vix_level: 1.5,
  vix_term_ratio: 1.4,
  hyg_lqd_60d: 1.4,
  iwm_spy_60d: 1.0,
  sector_breadth_sma200: 1.3,
  defensive_cyclical_ratio: 1.1,
  vix_chg_20d: 0.9,
  spy_ret_20d: 0.7,
  spy_ret_60d: 0.9,
  spy_ret_252d: 0.6,
  spy_dist_sma50: 0.7,
  sector_dispersion_60d: 0.8,
  uup_60d: 0.5,
  gld_spy_60d: 0.5,
  tlt_20d: 0.3,
  ief_shy_60d: 0.3,
  uso_60d: 0.3,
  efa_spy_60d: 0.4,
  eem_spy_60d: 0.4,
};

export type EngineOptions = {
  as_of?: string; // defaults to latest SPY bar
  daysAroundEvent?: number; // ± window used to build historical fingerprints
  topK?: number;
  minMatchFeatures?: number;
};

export async function computeSnapshot(opts: EngineOptions = {}): Promise<Snapshot> {
  const universe = await loadUniverse();
  return computeSnapshotFromUniverse(universe, opts);
}

export function computeSnapshotFromUniverse(
  universe: UniverseSnapshot,
  opts: EngineOptions = {},
): Snapshot {
  const spy = universe.SPY;
  if (!spy?.length) throw new Error("SPY data unavailable");
  const asOf = opts.as_of ?? spy[spy.length - 1].date;
  const daysAround = opts.daysAroundEvent ?? 60;
  const topK = opts.topK ?? 8;
  const minMatch = opts.minMatchFeatures ?? 10;

  const normStats = buildNormStats(universe, "2000-01-03", 5);
  const featRaw = computeFeaturesAt(universe, asOf);
  const featZ = zScore(featRaw, normStats);

  // ── Analog matching ──
  // For each eligible historical event, score similarity at multiple lead
  // times (from -daysAround to +daysAround, stride 5) against today's z-vector.
  const analogs: AnalogMatch[] = [];
  let windowsScanned = 0;
  for (const ev of ANALOG_ELIGIBLE_EVENTS) {
    const troughIdx = indexOnOrBefore(spy, ev.trough);
    if (troughIdx < 0) continue;
    for (let offset = -daysAround; offset <= daysAround; offset += 5) {
      const testIdx = troughIdx + offset;
      if (testIdx < 260 || testIdx >= spy.length) continue;
      windowsScanned++;
      const testDate = spy[testIdx].date;
      if (testDate >= asOf) continue; // no forward-looking
      const past = computeFeaturesAt(universe, testDate);
      const pastZ = zScore(past, normStats);
      const { sim, n } = cosineSim(featZ, pastZ);
      if (n < minMatch) continue;
      const daysBefore = -offset; // negative offset = before trough
      analogs.push({
        event_id: ev.id,
        event_label: ev.label,
        event_kind: ev.kind,
        match_date: testDate,
        days_before_trough: daysBefore,
        similarity: Math.max(0, sim) * 100,
        outcome_dd_pct: ev.spx_dd_pct,
        outcome_days_to_trough: Math.max(0, daysBefore),
      });
    }
  }
  analogs.sort((a, b) => b.similarity - a.similarity);
  // Keep the single best window per event for the primary top list
  const seen = new Set<string>();
  const topAnalogsPrimary: AnalogMatch[] = [];
  for (const m of analogs) {
    if (seen.has(m.event_id)) continue;
    seen.add(m.event_id);
    topAnalogsPrimary.push(m);
    if (topAnalogsPrimary.length >= topK) break;
  }

  // ── Probabilities ──
  // Weighted by similarity² across ALL matches (not just top-K per-event),
  // grouped by crisis kind. The result is "% of the weighted evidence
  // that comes from this kind of environment", conditioned on top-N
  // matches with similarity >= 60.
  const evidence = analogs.filter((m) => m.similarity >= 60);
  const probs: Record<CrisisKind, number> = {
    bear_market: 0, crash: 0, credit_event: 0, liquidity_crisis: 0,
    banking_crisis: 0, recession: 0, flash_crash: 0, commodity_shock: 0, sovereign_debt: 0,
  };
  let totalW = 0;
  for (const m of evidence) {
    const w = (m.similarity / 100) ** 2;
    probs[m.event_kind] += w;
    totalW += w;
  }
  if (totalW > 0) {
    for (const k of Object.keys(probs) as CrisisKind[]) {
      probs[k] = Math.round((probs[k] / totalW) * 1000) / 10;
    }
  }

  // ── Early Warning Score ──
  // Weighted sum of risk-directed z-scores, mapped through a logistic
  // squashing to 0..100. Then blend with average top-analog similarity to
  // avoid pure-technical spikes without confirming historical fingerprint.
  let riskSum = 0, wSum = 0;
  const contribs: Snapshot["drivers"] = [];
  const dissents: Snapshot["disagreements"] = [];
  for (const k of FEATURE_KEYS) {
    const z = featZ[k];
    if (z == null || !Number.isFinite(z)) continue;
    const sign = FEATURE_RISK_SIGN[k];
    if (sign === 0) continue;
    const w = FEATURE_WEIGHT[k];
    const c = sign * z * w; // positive = pushing risk higher
    riskSum += c;
    wSum += w;
    if (c >= 0.4) {
      contribs.push({ key: k, z, contribution: c, direction: "risk-off" });
    } else if (c <= -0.4) {
      dissents.push({ key: k, z, note: "This indicator disagrees with the risk signal" });
    }
  }
  const avgWeightedZ = wSum > 0 ? riskSum / wSum : 0;
  const techScore = 100 / (1 + Math.exp(-avgWeightedZ * 1.5)); // logistic
  const meanTopSim = topAnalogsPrimary.length
    ? topAnalogsPrimary.reduce((s, m) => s + m.similarity, 0) / topAnalogsPrimary.length
    : 0;
  const ews = Math.round(0.65 * techScore + 0.35 * meanTopSim);

  contribs.sort((a, b) => b.contribution - a.contribution);
  dissents.sort((a, b) => a.z - b.z);

  const regime: RegimeLabel =
    ews >= 80 ? "crisis" :
    ews >= 65 ? "high_risk" :
    ews >= 50 ? "elevated_risk" :
    ews >= 30 ? "correction" : "healthy";

  const missing = FEATURE_KEYS.filter((k) => featRaw[k] == null);
  const present = FEATURE_KEYS.length - missing.length;
  const normSample = Math.max(...FEATURE_KEYS.map((k) => normStats[k]?.n ?? 0));

  return {
    as_of: asOf,
    early_warning_score: ews,
    regime,
    probabilities: probs,
    features_raw: featRaw,
    features_z: featZ,
    top_analogs: topAnalogsPrimary,
    drivers: contribs.slice(0, 8),
    disagreements: dissents.slice(0, 5),
    data_coverage: {
      features_present: present,
      features_total: FEATURE_KEYS.length,
      missing_keys: missing,
    },
    meta: {
      universe_symbols: Object.keys(universe).filter((k) => (universe as any)[k]?.length).length,
      normstats_sample_size: normSample,
      analog_windows_scanned: windowsScanned,
      days_around_event: daysAround,
    },
  };
}

// ── Backtest ─────────────────────────────────────────────────────────
// Walk the engine forward through history at each crisis event and
// report: (a) EWS score across the pre-crisis window, (b) how many days
// before the trough the score first crossed each regime threshold.

export type BacktestEvent = {
  event_id: string;
  event_label: string;
  trough: string;
  dd_pct: number;
  first_elevated_days_before: number | null;
  first_high_days_before: number | null;
  first_crisis_days_before: number | null;
  peak_ews_in_window: number;
  peak_ews_date: string | null;
};

export type BacktestSummary = {
  events_scored: number;
  events_flagged_elevated: number;
  events_flagged_high: number;
  median_lead_days_elevated: number | null;
  median_lead_days_high: number | null;
};

export type BacktestResult = {
  summary: BacktestSummary;
  per_event: BacktestEvent[];
  timeline: Array<{ event_id: string; date: string; ews: number; regime: RegimeLabel }>;
};

export async function runBacktest(options?: {
  windowBefore?: number; // trading days before trough to test
  stride?: number;
}): Promise<BacktestResult> {
  const universe = await loadUniverse();
  const spy = universe.SPY;
  if (!spy?.length) throw new Error("SPY data unavailable");
  const windowBefore = options?.windowBefore ?? 180;
  const stride = options?.stride ?? 5;

  const perEvent: BacktestEvent[] = [];
  const timeline: BacktestResult["timeline"] = [];
  let flaggedElev = 0, flaggedHigh = 0;
  const leadsElev: number[] = [], leadsHigh: number[] = [];

  for (const ev of CRISIS_EVENTS) {
    if (ev.data_available_from < "1998-01-01") continue;
    const troughIdx = indexOnOrBefore(spy, ev.trough);
    if (troughIdx < 0) continue;
    let firstElev: number | null = null, firstHigh: number | null = null, firstCrisis: number | null = null;
    let peakEws = 0, peakDate: string | null = null;

    for (let d = windowBefore; d >= 0; d -= stride) {
      const idx = troughIdx - d;
      if (idx < 260) continue;
      const date = spy[idx].date;
      // Score AS IF this were "today" — matcher already filters out
      // testDate >= asOf, but we also want to skip forward peeking into
      // OTHER events. runBacktest reuses computeSnapshotFromUniverse with
      // as_of=date, so the analog matcher naturally excludes future data.
      const snap = computeSnapshotFromUniverse(universe, { as_of: date, topK: 6 });
      timeline.push({ event_id: ev.id, date, ews: snap.early_warning_score, regime: snap.regime });
      if (snap.early_warning_score > peakEws) {
        peakEws = snap.early_warning_score;
        peakDate = date;
      }
      if (firstElev == null && snap.early_warning_score >= 50) firstElev = d;
      if (firstHigh == null && snap.early_warning_score >= 65) firstHigh = d;
      if (firstCrisis == null && snap.early_warning_score >= 80) firstCrisis = d;
    }

    if (firstElev != null) { flaggedElev++; leadsElev.push(firstElev); }
    if (firstHigh != null) { flaggedHigh++; leadsHigh.push(firstHigh); }

    perEvent.push({
      event_id: ev.id,
      event_label: ev.label,
      trough: ev.trough,
      dd_pct: ev.spx_dd_pct,
      first_elevated_days_before: firstElev,
      first_high_days_before: firstHigh,
      first_crisis_days_before: firstCrisis,
      peak_ews_in_window: peakEws,
      peak_ews_date: peakDate,
    });
  }

  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  return {
    summary: {
      events_scored: perEvent.length,
      events_flagged_elevated: flaggedElev,
      events_flagged_high: flaggedHigh,
      median_lead_days_elevated: median(leadsElev),
      median_lead_days_high: median(leadsHigh),
    },
    per_event: perEvent,
    timeline,
  };
}
