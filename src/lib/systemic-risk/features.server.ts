// Cross-asset feature vector for the Systemic Risk engine.
//
// Every feature is a %/ratio/z-score — NEVER a raw price. Two markets
// separated by 25 years and 10x in dollar terms can generate identical
// vectors if their risk regime is identical. This mirrors the design
// discipline of the Historical Analog Scanner.
//
// Features that require a dataset that didn't exist at time T (e.g. HYG
// spreads pre-2007) are reported as null. The analog matcher and EWS
// aggregator both skip nulls and note them in `data_coverage` on the
// snapshot so the UI can be honest about coverage.

import {
  fetchUniverse,
  indexOnOrBefore,
  type DailyBar,
  type SystemicSymbol,
} from "./data.server";

export const FEATURE_KEYS = [
  "spy_ret_20d",
  "spy_ret_60d",
  "spy_ret_252d",
  "spy_dd_252d",
  "spy_dist_sma200",
  "spy_dist_sma50",
  "spy_realized_vol_20d",
  "vix_level",
  "vix_chg_20d",
  "vix_term_ratio",
  "iwm_spy_60d",
  "hyg_lqd_60d",
  "tlt_20d",
  "ief_shy_60d",
  "uup_60d",
  "gld_spy_60d",
  "uso_60d",
  "sector_dispersion_60d",
  "defensive_cyclical_ratio",
  "sector_breadth_sma200",
  "efa_spy_60d",
  "eem_spy_60d",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureVector = Record<FeatureKey, number | null>;

const ALL_SYMBOLS: SystemicSymbol[] = [
  "SPY", "QQQ", "IWM", "VIX", "VIX3M",
  "XLK", "XLF", "XLE", "XLU", "XLV", "XLY", "XLP", "XLI", "XLB", "XLC", "XLRE",
  "HYG", "LQD", "TLT", "IEF", "SHY", "UUP", "GLD", "USO", "EFA", "EEM",
];

const DEFENSIVE_SECTORS: SystemicSymbol[] = ["XLU", "XLP", "XLV"];
const CYCLICAL_SECTORS: SystemicSymbol[] = ["XLK", "XLY", "XLF", "XLI"];
const ALL_SECTORS: SystemicSymbol[] = [
  "XLK", "XLF", "XLE", "XLU", "XLV", "XLY", "XLP", "XLI", "XLB", "XLC", "XLRE",
];

export type UniverseSnapshot = Awaited<ReturnType<typeof fetchUniverse>>;

export async function loadUniverse(): Promise<UniverseSnapshot> {
  return fetchUniverse(ALL_SYMBOLS);
}

// Percentage return over N sessions ending at idx.
function retN(bars: DailyBar[], idx: number, n: number): number | null {
  if (idx < n || idx >= bars.length) return null;
  const a = bars[idx - n].adjClose, b = bars[idx].adjClose;
  if (!a) return null;
  return ((b - a) / a) * 100;
}

// Drawdown from the trailing N-day peak, in %.
function ddN(bars: DailyBar[], idx: number, n: number): number | null {
  if (idx < n || idx >= bars.length) return null;
  let peak = -Infinity;
  for (let k = idx - n; k <= idx; k++) if (bars[k].adjClose > peak) peak = bars[k].adjClose;
  if (peak <= 0) return null;
  return ((bars[idx].adjClose - peak) / peak) * 100;
}

// % distance from simple moving average.
function distSma(bars: DailyBar[], idx: number, n: number): number | null {
  if (idx < n || idx >= bars.length) return null;
  let s = 0;
  for (let k = idx - n + 1; k <= idx; k++) s += bars[k].adjClose;
  const sma = s / n;
  return ((bars[idx].adjClose - sma) / sma) * 100;
}

// Annualized realized vol over 20 daily returns (%).
function realizedVol(bars: DailyBar[], idx: number, n = 20): number | null {
  if (idx < n || idx >= bars.length) return null;
  const rets: number[] = [];
  for (let k = idx - n + 1; k <= idx; k++) {
    const a = bars[k - 1]?.adjClose, b = bars[k]?.adjClose;
    if (!a || !b) continue;
    rets.push(Math.log(b / a));
  }
  if (rets.length < 5) return null;
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

// Ratio of two series' N-day % returns (leadership).
function ratioChg(a: DailyBar[], b: DailyBar[], aIdx: number, bIdx: number, n: number): number | null {
  const ra = retN(a, aIdx, n);
  const rb = retN(b, bIdx, n);
  if (ra == null || rb == null) return null;
  return ra - rb;
}

export function computeFeaturesAt(
  universe: UniverseSnapshot,
  date: string,
): FeatureVector {
  const idx = (s: SystemicSymbol) => indexOnOrBefore(universe[s], date);
  const feats: FeatureVector = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, null]),
  ) as FeatureVector;

  const spyBars = universe.SPY;
  const spyIdx = idx("SPY");
  if (spyIdx >= 0) {
    feats.spy_ret_20d = retN(spyBars, spyIdx, 20);
    feats.spy_ret_60d = retN(spyBars, spyIdx, 60);
    feats.spy_ret_252d = retN(spyBars, spyIdx, 252);
    feats.spy_dd_252d = ddN(spyBars, spyIdx, 252);
    feats.spy_dist_sma200 = distSma(spyBars, spyIdx, 200);
    feats.spy_dist_sma50 = distSma(spyBars, spyIdx, 50);
    feats.spy_realized_vol_20d = realizedVol(spyBars, spyIdx, 20);
  }

  const vixIdx = idx("VIX");
  if (vixIdx >= 0) {
    feats.vix_level = universe.VIX[vixIdx].close;
    feats.vix_chg_20d = retN(universe.VIX, vixIdx, 20);
    const v3Idx = idx("VIX3M");
    if (v3Idx >= 0 && universe.VIX3M[v3Idx].close > 0) {
      feats.vix_term_ratio = universe.VIX[vixIdx].close / universe.VIX3M[v3Idx].close;
    }
  }

  const iwmIdx = idx("IWM");
  if (iwmIdx >= 0 && spyIdx >= 0) {
    feats.iwm_spy_60d = ratioChg(universe.IWM, spyBars, iwmIdx, spyIdx, 60);
  }

  const hygIdx = idx("HYG"), lqdIdx = idx("LQD");
  if (hygIdx >= 0 && lqdIdx >= 0) {
    feats.hyg_lqd_60d = ratioChg(universe.HYG, universe.LQD, hygIdx, lqdIdx, 60);
  }

  const tltIdx = idx("TLT");
  if (tltIdx >= 0) feats.tlt_20d = retN(universe.TLT, tltIdx, 20);

  const iefIdx = idx("IEF"), shyIdx = idx("SHY");
  if (iefIdx >= 0 && shyIdx >= 0) {
    feats.ief_shy_60d = ratioChg(universe.IEF, universe.SHY, iefIdx, shyIdx, 60);
  }

  const uupIdx = idx("UUP");
  if (uupIdx >= 0) feats.uup_60d = retN(universe.UUP, uupIdx, 60);

  const gldIdx = idx("GLD");
  if (gldIdx >= 0 && spyIdx >= 0) {
    feats.gld_spy_60d = ratioChg(universe.GLD, spyBars, gldIdx, spyIdx, 60);
  }

  const usoIdx = idx("USO");
  if (usoIdx >= 0) feats.uso_60d = retN(universe.USO, usoIdx, 60);

  // Sector dispersion — stdev of 60d returns across sectors present
  const sectorRets: number[] = [];
  for (const s of ALL_SECTORS) {
    const si = idx(s);
    if (si < 0) continue;
    const r = retN(universe[s], si, 60);
    if (r != null) sectorRets.push(r);
  }
  if (sectorRets.length >= 4) {
    const m = sectorRets.reduce((s, x) => s + x, 0) / sectorRets.length;
    const v = sectorRets.reduce((s, x) => s + (x - m) ** 2, 0) / (sectorRets.length - 1);
    feats.sector_dispersion_60d = Math.sqrt(v);
  }

  // Defensive/Cyclical 60d relative
  const defAvg = mean(DEFENSIVE_SECTORS.map((s) => retN(universe[s], idx(s), 60)));
  const cycAvg = mean(CYCLICAL_SECTORS.map((s) => retN(universe[s], idx(s), 60)));
  if (defAvg != null && cycAvg != null) {
    feats.defensive_cyclical_ratio = defAvg - cycAvg;
  }

  // Breadth: % of sectors above 200d SMA
  let above = 0, counted = 0;
  for (const s of ALL_SECTORS) {
    const si = idx(s);
    if (si < 0) continue;
    const d = distSma(universe[s], si, 200);
    if (d == null) continue;
    counted++;
    if (d > 0) above++;
  }
  if (counted >= 4) feats.sector_breadth_sma200 = (above / counted) * 100;

  // International relative
  const efaIdx = idx("EFA"), eemIdx = idx("EEM");
  if (efaIdx >= 0 && spyIdx >= 0) feats.efa_spy_60d = ratioChg(universe.EFA, spyBars, efaIdx, spyIdx, 60);
  if (eemIdx >= 0 && spyIdx >= 0) feats.eem_spy_60d = ratioChg(universe.EEM, spyBars, eemIdx, spyIdx, 60);

  return feats;
}

function mean(xs: (number | null)[]): number | null {
  const clean = xs.filter((x): x is number => x != null);
  if (!clean.length) return null;
  return clean.reduce((s, x) => s + x, 0) / clean.length;
}

// ── Feature normalization ────────────────────────────────────────────
// We z-score against a long-run distribution built from every SPY
// trading day since 2000. This makes "how extreme is today" comparable
// across features with different natural scales.

export type FeatureStats = { mean: number; std: number; n: number };
export type NormStats = Record<FeatureKey, FeatureStats | null>;

export function buildNormStats(
  universe: UniverseSnapshot,
  from = "2000-01-03",
  strideDays = 5,
): NormStats {
  const spy = universe.SPY;
  const startIdx = indexOnOrBefore(spy, from);
  const endIdx = spy.length - 1;
  const acc = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, [] as number[]]),
  ) as unknown as Record<FeatureKey, number[]>;
  for (let i = Math.max(startIdx, 260); i <= endIdx; i += strideDays) {
    const d = spy[i].date;
    const f = computeFeaturesAt(universe, d);
    for (const k of FEATURE_KEYS) {
      const v = f[k];
      if (v != null && Number.isFinite(v)) acc[k].push(v);
    }
  }
  const stats = {} as NormStats;
  for (const k of FEATURE_KEYS) {
    const xs = acc[k];
    if (xs.length < 30) { stats[k] = null; continue; }
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
    stats[k] = { mean: m, std: Math.sqrt(v) || 1e-9, n: xs.length };
  }
  return stats;
}

export function zScore(f: FeatureVector, stats: NormStats): FeatureVector {
  const out = {} as FeatureVector;
  for (const k of FEATURE_KEYS) {
    const v = f[k];
    const s = stats[k];
    if (v == null || s == null) { out[k] = null; continue; }
    out[k] = (v - s.mean) / s.std;
  }
  return out;
}

// Cosine similarity across features present in both vectors.
export function cosineSim(a: FeatureVector, b: FeatureVector): { sim: number; n: number } {
  let dot = 0, na = 0, nb = 0, n = 0;
  for (const k of FEATURE_KEYS) {
    const x = a[k], y = b[k];
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    dot += x * y; na += x * x; nb += y * y; n++;
  }
  if (n < 6 || na === 0 || nb === 0) return { sim: 0, n };
  return { sim: dot / (Math.sqrt(na) * Math.sqrt(nb)), n };
}
