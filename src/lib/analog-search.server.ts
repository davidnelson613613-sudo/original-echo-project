// True historical pattern search engine.
//
// For a given symbol we fetch its full daily history (up to ~5000 bars,
// roughly 20 years), compute a rich feature fingerprint at every date, then
// search the entire history — plus optional sibling instruments — for the
// dates whose fingerprint is closest to the CURRENT fingerprint. Similarity
// is scored with a Gaussian kernel across weighted feature blocks (regime,
// trend, momentum, volatility, market-context). For each best-match date we
// look forward 90 trading days to see what actually happened — max drawdown,
// days to trough, forward returns, recovery, realized vol, max rally — and
// classify the shape of the outcome (capitulation, v-bottom, slow bleed,
// double-bottom, rounded, retest). We aggregate the top K matches into a
// probabilistic outlook with per-projection confidence.

import type { Bar } from "./market.server";

// ── Public types ──

export type WindowFeatures = {
  idx: number;
  date: string;
  price: number;
  // Drawdown / range
  dd60: number;
  dd20: number;
  dd252: number;
  pct52wRange: number; // 0..100
  daysSincePeak60: number;
  speedDecline: number;
  high60: number;
  high20: number;
  // Returns
  ret5: number;
  ret20: number;
  ret60: number;
  roc10: number;
  // Trend
  distSma20: number;
  distSma50: number;
  distSma100: number;
  distSma200: number;
  sma50VsSma200: number;
  sma20Slope20: number; // %/day
  // Momentum
  rsi14: number;
  rsiSlope5: number;
  macdHist: number; // normalized by price (%)
  // Volatility
  atrPct: number;
  atr60Pct: number;
  volExpansion: number; // atr14 / atr60
  realizedVol20: number; // stdev of daily returns *sqrt(252) %
  // Drawdown shape
  ddDepthVsSpeed: number; // dd60 / atrPct
  pctDownBars20: number;  // 0..100
  worstDailyDrop20: number; // negative %
  worstGap20: number; // negative %
  // Volume (0 when volume unavailable)
  relVol20: number;
  volTrend: number;
  downDayVolRatio20: number;
  // Gap
  gapCount20: number;
  netGap20: number;
  // Market context (filled in for benchmark-aware series; 0 otherwise)
  rsVsSpy20: number;
  rsVsSpy60: number;
  rsVsSector20: number;
  rsVsSector60: number;
  corrVsSpy60: number;
  betaVsSpy60: number;
  spyDd60: number;
  spyRsi14: number;
};

export type BottomType =
  | "capitulation"
  | "v_bottom"
  | "slow_bleed"
  | "double_bottom"
  | "rounded"
  | "retest"
  | "no_bottom";

export type MarketPhase =
  | "uptrend"
  | "chop"
  | "early_decline"
  | "mid_decline"
  | "late_decline"
  | "capitulation"
  | "bottoming"
  | "failed_bounce"
  | "recovery"
  | "retest";

export type ForwardOutcome = {
  path: ForwardPathPoint[];
  minLowPct: number;
  daysToTrough: number;
  fwd1: number | null;
  fwd5: number | null;
  fwd10: number | null;
  fwd20: number | null;
  fwd30: number | null;
  fwd60: number | null;
  fwd90: number | null;
  daysToRecovery: number | null;
  recovered: boolean;
  maxRallyPct: number;
  volDuringForward: number; // annualized realized vol %
  bottomAlreadyIn: boolean; // trough was at t=0 or within 3 bars
  bottomType: BottomType;
  failed: boolean; // fwd90 < -5 OR minLowPct < -15 without recovery
};

export type ForwardPathPoint = {
  day: number;
  closePct: number;
  lowPct: number;
  highPct: number;
};

export type AnalogHit = {
  date: string;
  idx: number;
  symbol: string;             // source symbol (may be a sibling)
  isSameSymbol: boolean;
  similarity: number;         // 0..100
  weight: number;             // aggregation weight
  features: WindowFeatures;
  forward: ForwardOutcome;
  distanceBreakdown: { key: string; label: string; delta: number; score: number; weight: number; block: string }[];
};

export type AnalogAggregate = {
  count: number;
  meanSimilarity: number;
  agreement: number; // 0..1 — 1 - normalized stdev of fwd90
  meanMinLowPct: number;
  medianMinLowPct: number;
  worstMinLowPct: number;
  p25MinLowPct: number;
  p75MinLowPct: number;
  meanDaysToTrough: number;
  meanFwd5: number | null;
  meanFwd30: number | null;
  meanFwd90: number | null;
  p25Fwd30: number | null;
  p75Fwd30: number | null;
  p25Fwd90: number | null;
  p75Fwd90: number | null;
  meanMaxRally: number;
  meanForwardVol: number;
  recoveryRate: number;
  medianDaysToRecovery: number | null;
  probReversal: number;
  probContinuedDecline: number;
  probChop: number;
  probBottomIn: number;
  expectedRemainingDownside: number; // %, only from matches where bottom still ahead
  bottomTypeDistribution: Record<BottomType, number>;
  // Per-projection confidence (0..100)
  confidenceOverall: number;
  confidenceDownside: number;
  confidenceFwd30: number;
  confidenceFwd90: number;
  confidenceBottomIn: number;
};

export type HorizonExpectation = {
  days: number;
  meanPct: number;
  p25: number;
  p75: number;
  probUp: number;
  sample: number;
  confidence: number;
};

export type FailureExample = {
  date: string;
  symbol: string;
  similarity: number;
  minLowPct: number;
  fwd90: number | null;
  reason: string;
};

export type TraderAnswers = {
  seenBefore: boolean;
  occurrences: number;
  favorability: "favorable" | "mixed" | "unfavorable";
  favorabilityScore: number; // -100..+100
  phase: MarketPhase;
  phaseNarrative: string;
  whatUsuallyHappens: string;
  biggestRisks: string;
  riskRewardNote: string;
  earlyOrLate: "early" | "middle" | "late" | "post-bottom" | "n/a";
};

export type AnalogSearchResult = {
  symbol: string;
  asOfDate: string;
  current: WindowFeatures;
  best: AnalogHit;
  matches: AnalogHit[];
  aggregate: AnalogAggregate;
  projections: {
    worstPrice: number;
    worstPriceP10: number;
    priceAt30d: number | null;
    priceAt30dLow: number | null;
    priceAt30dHigh: number | null;
    priceAt90d: number | null;
    priceAt90dLow: number | null;
    priceAt90dHigh: number | null;
    recoveryPrice: number;
    projectedFloor: number;         // price * (1 + p25MinLowPct/100)
    expectedDaysToTrough: number;
    expectedDaysToRecovery: number | null;
  };
  horizons: HorizonExpectation[];
  marketPhase: MarketPhase;
  phaseNarrative: string;
  bestNarrative: string;
  failureAnalysis: {
    failureRate: number;
    failedCount: number;
    failedExamples: FailureExample[];
    summary: string;
  };
  traderAnswers: TraderAnswers;
  totalCandidatesSearched: number;
  contributingSymbols: { symbol: string; matches: number }[];
  strongestSimilarities: { label: string; delta: number; score: number }[];
  biggestDifferences: { label: string; delta: number; score: number }[];
  summary: string;
};

// A compact summary that downstream components can consume.
export type AnalogSummary = {
  symbol: string;
  bestDate: string;
  similarity: number;
  probBottomIn: number;
  expectedRemainingDownsidePct: number;
  projectedFloor: number;
  recoveryPrice: number;
  confidence: number;
};

// ── Sector / related instrument maps ──

// Sector proxy per symbol (falls back to SPY).
export const SECTOR_PROXY: Record<string, string> = {
  SMH: "XLK", SOXX: "XLK", SOXQ: "XLK", XSD: "XLK", NVDA: "SMH", AMD: "SMH", INTC: "SMH", AVGO: "SMH", TSM: "SMH", MU: "SMH",
  XLK: "SPY", QQQ: "SPY", XLE: "SPY", OIH: "XLE", XOP: "XLE",
  AAPL: "XLK", MSFT: "XLK", GOOGL: "XLK", GOOG: "XLK", META: "XLK", AMZN: "XLK", TSLA: "XLK", NFLX: "XLK",
  XOM: "XLE", CVX: "XLE", COP: "XLE", OXY: "XLE",
  JPM: "XLF", BAC: "XLF", GS: "XLF", MS: "XLF", XLF: "SPY",
  UNH: "XLV", JNJ: "XLV", PFE: "XLV", XLV: "SPY",
  SPY: "SPY", VOO: "SPY", IVV: "SPY",
};

// Sibling instruments to include as extra analog candidates (weighted lower).
export const RELATED_SYMBOLS: Record<string, string[]> = {
  SMH: ["SOXX", "SOXQ", "XSD"],
  SOXX: ["SMH", "SOXQ", "XSD"],
  SOXQ: ["SMH", "SOXX"],
  XLK: ["QQQ", "VGT"],
  QQQ: ["XLK", "VGT"],
  SPY: ["VOO", "IVV"],
  XLE: ["OIH", "XOP", "VDE"],
  OIH: ["XLE", "XOP"],
  XOP: ["XLE", "OIH"],
  XLF: ["KRE", "IYF"],
  XLV: ["IHI", "IBB"],
};

// ── Feature engineering ──

function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  let v = 0;
  for (const x of a) v += (x - m) * (x - m);
  return Math.sqrt(v / (a.length - 1));
}

export function computeAllFeatures(barsAsc: Bar[]): (WindowFeatures | null)[] {
  const n = barsAsc.length;
  if (n < 260) return new Array(n).fill(null);

  const closes = barsAsc.map((b) => b.close);
  const highs = barsAsc.map((b) => b.high);
  const lows = barsAsc.map((b) => b.low);
  const opens = barsAsc.map((b) => b.open);
  const vols = barsAsc.map((b) => b.volume ?? 0);

  const rollingSma = (period: number) => {
    const out = new Array(n).fill(NaN);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  };
  const sma20 = rollingSma(20);
  const sma50 = rollingSma(50);
  const sma100 = rollingSma(100);
  const sma200 = rollingSma(200);

  // EMA helper
  const ema = (period: number, src: number[]) => {
    const out = new Array(n).fill(NaN);
    const k = 2 / (period + 1);
    let e = src[0];
    out[0] = e;
    for (let i = 1; i < n; i++) {
      e = src[i] * k + e * (1 - k);
      out[i] = e;
    }
    return out;
  };
  const ema12 = ema(12, closes);
  const ema26 = ema(26, closes);
  const macd = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = ema(9, macd);
  const macdHistArr = macd.map((v, i) => v - macdSignal[i]);

  // Wilder ATR14 & ATR60
  const wilder = (period: number, src: number[]) => {
    const out = new Array(n).fill(NaN);
    if (n <= period) return out;
    let a = 0;
    for (let i = 1; i <= period; i++) a += src[i];
    a /= period;
    out[period] = a;
    for (let i = period + 1; i < n; i++) {
      a = (a * (period - 1) + src[i]) / period;
      out[i] = a;
    }
    return out;
  };
  const trs = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
    trs[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  const atr14 = wilder(14, trs);
  const atr60 = wilder(60, trs);

  // Wilder RSI14
  const rsi = new Array(n).fill(NaN);
  {
    let g = 0;
    let l = 0;
    for (let i = 1; i <= 14; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) g += d;
      else l -= d;
    }
    g /= 14;
    l /= 14;
    rsi[14] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = 15; i < n; i++) {
      const d = closes[i] - closes[i - 1];
      const gi = d > 0 ? d : 0;
      const li = d < 0 ? -d : 0;
      g = (g * 13 + gi) / 14;
      l = (l * 13 + li) / 14;
      rsi[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }

  // Daily returns (log-ish simple returns %)
  const rets = new Array(n).fill(0);
  for (let i = 1; i < n; i++) rets[i] = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;

  // Gap % (open vs prior close)
  const gaps = new Array(n).fill(0);
  for (let i = 1; i < n; i++) gaps[i] = ((opens[i] - closes[i - 1]) / closes[i - 1]) * 100;

  // Rolling volume avg
  const rollVolAvg = (period: number) => {
    const out = new Array(n).fill(0);
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += vols[i];
      if (i >= period) s -= vols[i - period];
      if (i >= period - 1) out[i] = s / period;
    }
    return out;
  };
  const vol20 = rollVolAvg(20);
  const vol60 = rollVolAvg(60);

  const out: (WindowFeatures | null)[] = new Array(n).fill(null);
  for (let i = 252; i < n; i++) {
    const price = closes[i];
    let high60 = 0;
    let peakIdx = i;
    const lo60 = Math.max(0, i - 59);
    for (let k = lo60; k <= i; k++) {
      if (highs[k] > high60) {
        high60 = highs[k];
        peakIdx = k;
      }
    }
    let high20 = 0;
    for (let k = Math.max(0, i - 19); k <= i; k++) if (highs[k] > high20) high20 = highs[k];
    let high252 = 0;
    let low252 = Infinity;
    for (let k = Math.max(0, i - 251); k <= i; k++) {
      if (highs[k] > high252) high252 = highs[k];
      if (lows[k] < low252) low252 = lows[k];
    }
    const dd60 = ((price - high60) / high60) * 100;
    const dd20 = ((price - high20) / high20) * 100;
    const dd252 = ((price - high252) / high252) * 100;
    const pct52wRange =
      high252 > low252 ? ((price - low252) / (high252 - low252)) * 100 : 50;

    const daysSincePeak60 = i - peakIdx;
    const speedDecline = daysSincePeak60 > 0 ? dd60 / daysSincePeak60 : 0;

    const ret5 = ((price - closes[i - 5]) / closes[i - 5]) * 100;
    const ret20 = ((price - closes[i - 20]) / closes[i - 20]) * 100;
    const ret60 = ((price - closes[i - 60]) / closes[i - 60]) * 100;
    const roc10 = ((price - closes[i - 10]) / closes[i - 10]) * 100;

    const distSma20 = ((price - sma20[i]) / sma20[i]) * 100;
    const distSma50 = ((price - sma50[i]) / sma50[i]) * 100;
    const distSma100 = ((price - sma100[i]) / sma100[i]) * 100;
    const distSma200 = ((price - sma200[i]) / sma200[i]) * 100;
    const sma50VsSma200 = ((sma50[i] - sma200[i]) / sma200[i]) * 100;
    const sma20Slope20 = i >= 40 && isFinite(sma20[i - 20]) && sma20[i - 20] > 0
      ? ((sma20[i] - sma20[i - 20]) / sma20[i - 20]) * 100 / 20
      : 0;

    const atrPct = (atr14[i] / price) * 100;
    const atr60Pct = isFinite(atr60[i]) ? (atr60[i] / price) * 100 : atrPct;
    const volExpansion = atr60Pct > 0 ? atrPct / atr60Pct : 1;

    const last20Rets = rets.slice(i - 19, i + 1);
    const realizedVol20 = stdev(last20Rets) * Math.sqrt(252);

    const ddDepthVsSpeed = atrPct > 0 ? dd60 / atrPct : dd60;
    const downBars = last20Rets.filter((r) => r < 0).length;
    const pctDownBars20 = (downBars / last20Rets.length) * 100;
    const worstDailyDrop20 = Math.min(0, ...last20Rets);
    const last20Gaps = gaps.slice(i - 19, i + 1);
    const worstGap20 = Math.min(0, ...last20Gaps);
    const gapCount20 = last20Gaps.filter((g) => Math.abs(g) > 0.5).length;
    const netGap20 = last20Gaps.reduce((a, b) => a + b, 0);

    const relVol20 = vol20[i] > 0 ? vols[i] / vol20[i] : 0;
    const volTrend = vol60[i] > 0 ? vol20[i] / vol60[i] : 0;
    let downVolSum = 0;
    let upVolSum = 0;
    for (let k = i - 19; k <= i; k++) {
      if (rets[k] < 0) downVolSum += vols[k];
      else upVolSum += vols[k];
    }
    const totalVol = downVolSum + upVolSum;
    const downDayVolRatio20 = totalVol > 0 ? (downVolSum / totalVol) * 100 : 50;

    const rsiPrev = i >= 5 ? rsi[i - 5] : rsi[i];
    const rsiSlope5 = isFinite(rsiPrev) ? (rsi[i] - rsiPrev) / 5 : 0;

    const macdHist = price > 0 && isFinite(macdHistArr[i]) ? (macdHistArr[i] / price) * 100 : 0;

    out[i] = {
      idx: i,
      date: barsAsc[i].datetime,
      price,
      dd60,
      dd20,
      dd252,
      pct52wRange,
      daysSincePeak60,
      speedDecline,
      high60,
      high20,
      ret5,
      ret20,
      ret60,
      roc10,
      distSma20,
      distSma50,
      distSma100,
      distSma200,
      sma50VsSma200,
      sma20Slope20,
      rsi14: rsi[i],
      rsiSlope5,
      macdHist,
      atrPct,
      atr60Pct,
      volExpansion,
      realizedVol20,
      ddDepthVsSpeed,
      pctDownBars20,
      worstDailyDrop20,
      worstGap20,
      relVol20,
      volTrend,
      downDayVolRatio20,
      gapCount20,
      netGap20,
      // Filled in later by attachMarketContext:
      rsVsSpy20: 0,
      rsVsSpy60: 0,
      rsVsSector20: 0,
      rsVsSector60: 0,
      corrVsSpy60: 0,
      betaVsSpy60: 0,
      spyDd60: 0,
      spyRsi14: 50,
    };
  }
  return out;
}

// Attach market-context features. `spyByDate` / `sectorByDate` map a bar's
// date to that day's (close, dd60, rsi14, ret20, ret60). If a feature for a
// given date is missing, defaults are left in place (neutral values).
export type MarketContext = {
  spy: Map<string, { close: number; dd60: number; rsi14: number; ret20: number; ret60: number }>;
  sector: Map<string, { close: number; ret20: number; ret60: number }> | null;
  spyReturns: Map<string, number>; // daily return
  symReturns: (date: string) => number | undefined;
};

export function attachMarketContext(
  features: (WindowFeatures | null)[],
  bars: Bar[],
  ctx: MarketContext,
): void {
  // Precompute the symbol's own daily returns keyed by date
  const symRets = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    symRets.set(bars[i].datetime, ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100);
  }

  for (const f of features) {
    if (!f) continue;
    const spyNow = ctx.spy.get(f.date);
    if (spyNow) {
      f.spyDd60 = spyNow.dd60;
      f.spyRsi14 = spyNow.rsi14;
      // RS = own ret − spy ret
      const symRet20 = f.ret20;
      const symRet60 = f.ret60;
      f.rsVsSpy20 = symRet20 - spyNow.ret20;
      f.rsVsSpy60 = symRet60 - spyNow.ret60;
    }
    if (ctx.sector) {
      const sec = ctx.sector.get(f.date);
      if (sec) {
        f.rsVsSector20 = f.ret20 - sec.ret20;
        f.rsVsSector60 = f.ret60 - sec.ret60;
      }
    }

    // Beta & correlation over last 60 trading days vs SPY
    const window = 60;
    const idx = f.idx;
    const startDate = bars[Math.max(0, idx - window + 1)].datetime;
    // Collect aligned daily returns
    const sy: number[] = [];
    const sp: number[] = [];
    for (let k = Math.max(1, idx - window + 1); k <= idx; k++) {
      const d = bars[k].datetime;
      const sr = symRets.get(d);
      const spr = ctx.spyReturns.get(d);
      if (sr !== undefined && spr !== undefined) {
        sy.push(sr);
        sp.push(spr);
      }
    }
    if (sy.length >= 20) {
      const my = sy.reduce((a, b) => a + b, 0) / sy.length;
      const mp = sp.reduce((a, b) => a + b, 0) / sp.length;
      let cov = 0, vp = 0, vy = 0;
      for (let k = 0; k < sy.length; k++) {
        cov += (sy[k] - my) * (sp[k] - mp);
        vp += (sp[k] - mp) ** 2;
        vy += (sy[k] - my) ** 2;
      }
      f.betaVsSpy60 = vp > 0 ? cov / vp : 0;
      f.corrVsSpy60 = vp > 0 && vy > 0 ? cov / Math.sqrt(vp * vy) : 0;
    }
    // (startDate is intentionally unused — kept as an anchor for future window strategies.)
    void startDate;
  }
}

// Build a MarketContext-shaped record for a benchmark ticker.
export function buildBenchmarkIndex(bars: Bar[]): {
  quick: Map<string, { close: number; dd60: number; rsi14: number; ret20: number; ret60: number }>;
  dailyRet: Map<string, number>;
} {
  const quick = new Map<string, { close: number; dd60: number; rsi14: number; ret20: number; ret60: number }>();
  const dailyRet = new Map<string, number>();
  const feats = computeAllFeatures(bars);
  for (let i = 1; i < bars.length; i++) {
    dailyRet.set(bars[i].datetime, ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100);
  }
  for (const f of feats) {
    if (!f) continue;
    quick.set(f.date, {
      close: f.price,
      dd60: f.dd60,
      rsi14: f.rsi14,
      ret20: f.ret20,
      ret60: f.ret60,
    });
  }
  return { quick, dailyRet };
}

export function buildSectorIndex(bars: Bar[]): Map<string, { close: number; ret20: number; ret60: number }> {
  const m = new Map<string, { close: number; ret20: number; ret60: number }>();
  const feats = computeAllFeatures(bars);
  for (const f of feats) {
    if (!f) continue;
    m.set(f.date, { close: f.price, ret20: f.ret20, ret60: f.ret60 });
  }
  return m;
}

// ── Similarity ──

type FeatureSpec = {
  key: keyof WindowFeatures;
  label: string;
  tol: number;
  weight: number;
  block: "regime" | "trend" | "momentum" | "volatility" | "market" | "shape" | "volume";
};

const FEATURE_SPECS: FeatureSpec[] = [
  // Regime
  { key: "dd60", label: "Drawdown from 60d high", tol: 5, weight: 2.4, block: "regime" },
  { key: "dd20", label: "Drawdown from 20d high", tol: 3, weight: 1.4, block: "regime" },
  { key: "dd252", label: "Drawdown from 1y high", tol: 8, weight: 1.4, block: "regime" },
  { key: "pct52wRange", label: "Position in 52w range", tol: 15, weight: 1.1, block: "regime" },
  { key: "daysSincePeak60", label: "Days since 60d peak", tol: 15, weight: 0.9, block: "regime" },
  { key: "speedDecline", label: "Decline speed (%/day)", tol: 0.35, weight: 1.6, block: "regime" },
  // Trend
  { key: "distSma20", label: "Distance from 20-SMA", tol: 3, weight: 1.0, block: "trend" },
  { key: "distSma50", label: "Distance from 50-SMA", tol: 4, weight: 1.1, block: "trend" },
  { key: "distSma100", label: "Distance from 100-SMA", tol: 6, weight: 0.9, block: "trend" },
  { key: "distSma200", label: "Distance from 200-SMA", tol: 8, weight: 1.3, block: "trend" },
  { key: "sma50VsSma200", label: "50 vs 200 SMA", tol: 6, weight: 1.0, block: "trend" },
  { key: "sma20Slope20", label: "20-SMA slope", tol: 0.4, weight: 0.9, block: "trend" },
  // Momentum
  { key: "rsi14", label: "RSI(14)", tol: 10, weight: 1.5, block: "momentum" },
  { key: "rsiSlope5", label: "RSI slope (5d)", tol: 3, weight: 0.8, block: "momentum" },
  { key: "macdHist", label: "MACD histogram (%)", tol: 0.6, weight: 1.0, block: "momentum" },
  { key: "roc10", label: "10d rate of change", tol: 4, weight: 0.9, block: "momentum" },
  { key: "ret5", label: "5-day return", tol: 3, weight: 1.0, block: "momentum" },
  { key: "ret20", label: "20-day return", tol: 5, weight: 1.0, block: "momentum" },
  { key: "ret60", label: "60-day return", tol: 9, weight: 0.8, block: "momentum" },
  // Volatility
  { key: "atrPct", label: "ATR volatility (%)", tol: 1.0, weight: 1.1, block: "volatility" },
  { key: "volExpansion", label: "Vol expansion (ATR14/ATR60)", tol: 0.35, weight: 1.0, block: "volatility" },
  { key: "realizedVol20", label: "Realized vol (20d, ann.)", tol: 15, weight: 1.0, block: "volatility" },
  // Shape
  { key: "ddDepthVsSpeed", label: "Depth vs vol", tol: 5, weight: 0.9, block: "shape" },
  { key: "pctDownBars20", label: "% down bars (20d)", tol: 15, weight: 0.6, block: "shape" },
  { key: "worstDailyDrop20", label: "Worst 1-day drop", tol: 3, weight: 0.7, block: "shape" },
  { key: "worstGap20", label: "Worst gap (20d)", tol: 2, weight: 0.5, block: "shape" },
  // Volume
  { key: "relVol20", label: "Relative volume", tol: 0.7, weight: 0.7, block: "volume" },
  { key: "volTrend", label: "Volume trend (20/60)", tol: 0.4, weight: 0.5, block: "volume" },
  { key: "downDayVolRatio20", label: "Down-day vol share", tol: 15, weight: 0.6, block: "volume" },
  { key: "gapCount20", label: "Gap count (20d)", tol: 4, weight: 0.4, block: "volume" },
  // Market context
  { key: "rsVsSpy20", label: "Rel strength vs SPY (20d)", tol: 4, weight: 1.1, block: "market" },
  { key: "rsVsSpy60", label: "Rel strength vs SPY (60d)", tol: 8, weight: 1.0, block: "market" },
  { key: "rsVsSector20", label: "Rel strength vs sector (20d)", tol: 4, weight: 0.9, block: "market" },
  { key: "rsVsSector60", label: "Rel strength vs sector (60d)", tol: 8, weight: 0.9, block: "market" },
  { key: "corrVsSpy60", label: "Correlation vs SPY", tol: 0.4, weight: 0.5, block: "market" },
  { key: "betaVsSpy60", label: "Beta vs SPY", tol: 0.5, weight: 0.5, block: "market" },
  { key: "spyDd60", label: "Market drawdown regime", tol: 4, weight: 1.3, block: "market" },
  { key: "spyRsi14", label: "Market RSI regime", tol: 12, weight: 0.8, block: "market" },
];

// Precompute per-block total weights so no block can overwhelm others.
const BLOCK_TOTALS: Record<string, number> = {};
for (const s of FEATURE_SPECS) BLOCK_TOTALS[s.block] = (BLOCK_TOTALS[s.block] ?? 0) + s.weight;

// Feature keys whose default value (0 or 50) also happens to be a legal
// real value. If BOTH sides equal the default we cannot distinguish
// "genuinely matches" from "data was never attached" — skip instead of
// awarding a perfect score. Without this, a symbol with no SPY context or
// no volume history gets ~15 free perfect-match features and similarity
// is systematically overstated.
const DEFAULT_SENTINELS: Partial<Record<keyof WindowFeatures, number>> = {
  rsVsSpy20: 0, rsVsSpy60: 0, rsVsSector20: 0, rsVsSector60: 0,
  corrVsSpy60: 0, betaVsSpy60: 0, spyDd60: 0, spyRsi14: 50,
  relVol20: 0, volTrend: 0, downDayVolRatio20: 50, gapCount20: 0,
  netGap20: 0,
};

function scoreSimilarity(cur: WindowFeatures, cand: WindowFeatures) {
  let weighted = 0;
  let totalWeight = 0;
  const breakdown: AnalogHit["distanceBreakdown"] = [];
  for (const spec of FEATURE_SPECS) {
    const a = cur[spec.key] as number;
    const b = cand[spec.key] as number;
    if (typeof a !== "number" || typeof b !== "number" || !isFinite(a) || !isFinite(b)) continue;
    const sentinel = DEFAULT_SENTINELS[spec.key];
    if (sentinel !== undefined && a === sentinel && b === sentinel) continue;
    const delta = a - b;
    // Gaussian kernel: exp(-(Δ/tol)²). Smoothly saturates for outliers.
    const s = Math.exp(-((delta / spec.tol) ** 2));
    // Block-normalized weight so each block contributes proportionally.
    const blockNorm = BLOCK_TOTALS[spec.block] || 1;
    const w = spec.weight / blockNorm;
    weighted += s * w;
    totalWeight += w;
    breakdown.push({ key: String(spec.key), label: spec.label, delta, score: s, weight: spec.weight, block: spec.block });
  }
  const similarity = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 0;
  return { similarity, breakdown };
}

// Cheap pre-gate features used to prune candidates BEFORE running the full
// 36-feature Gaussian. Each pair (key, tol) says "reject when |Δ| > tol".
// Tolerances are intentionally generous: prescreen aims to cut the obvious
// non-matches (uptrend vs bear, RSI 20 vs 80), not to compete with the full
// score. Empirically this eliminates 60-80% of candidates on typical scans.
const PRESCREEN: Array<{ key: keyof WindowFeatures; tol: number }> = [
  { key: "rsi14", tol: 22 },
  { key: "distSma200", tol: 18 },
  { key: "dd60", tol: 12 },
  { key: "ret60", tol: 22 },
];

function passesPrescreen(cur: WindowFeatures, cand: WindowFeatures): boolean {
  for (const p of PRESCREEN) {
    const a = cur[p.key] as number;
    const b = cand[p.key] as number;
    if (typeof a !== "number" || typeof b !== "number") continue;
    if (Math.abs(a - b) > p.tol) return false;
  }
  return true;
}

// ── Forward outcomes ──

function classifyBottom(
  barsAsc: Bar[],
  idx: number,
  cur: WindowFeatures,
  minLowPct: number,
  troughOffset: number,
  daysToRecovery: number | null,
): BottomType {
  if (troughOffset <= 3 && minLowPct > -1) return "no_bottom";
  const fastDrop = minLowPct < -8 && troughOffset <= 15 && cur.atrPct > 2;
  if (fastDrop && daysToRecovery !== null && daysToRecovery - troughOffset < 20) return "capitulation";
  if (daysToRecovery !== null && daysToRecovery <= 12 && troughOffset <= 8) return "v_bottom";

  // Double-bottom: after trough, price rallies then dips again to within 3% of low
  if (troughOffset > 5 && troughOffset < 70) {
    const troughIdx = idx + troughOffset;
    const troughPrice = barsAsc[troughIdx].low;
    const lookaheadEnd = Math.min(barsAsc.length - 1, troughIdx + 30);
    let sawRally = false;
    for (let k = troughIdx + 3; k <= lookaheadEnd; k++) {
      if ((barsAsc[k].high - troughPrice) / troughPrice > 0.05) sawRally = true;
      if (sawRally && Math.abs(barsAsc[k].low - troughPrice) / troughPrice < 0.03) return "double_bottom";
    }
  }
  if (minLowPct > -6 && troughOffset > 30) return "slow_bleed";
  if (cur.atrPct < 1.5 && troughOffset > 20 && troughOffset < 60) return "rounded";
  if (daysToRecovery === null && minLowPct < -4) return "slow_bleed";
  return "retest";
}

function computeForward(barsAsc: Bar[], idx: number, curFeatures: WindowFeatures): ForwardOutcome {
  const price = curFeatures.price;
  const targetPeak = curFeatures.high60;
  const endIdx = Math.min(idx + 90, barsAsc.length - 1);

  const path: ForwardPathPoint[] = [{ day: 0, closePct: 0, lowPct: 0, highPct: 0 }];
  for (let k = idx + 1; k <= endIdx; k++) {
    const b = barsAsc[k];
    path.push({
      day: k - idx,
      closePct: ((b.close - price) / price) * 100,
      lowPct: ((b.low - price) / price) * 100,
      highPct: ((b.high - price) / price) * 100,
    });
  }

  let minLow = price;
  let troughOffset = 0;
  let maxHigh = price;
  for (let k = idx + 1; k <= endIdx; k++) {
    if (barsAsc[k].low < minLow) {
      minLow = barsAsc[k].low;
      troughOffset = k - idx;
    }
    if (barsAsc[k].high > maxHigh) maxHigh = barsAsc[k].high;
  }
  const minLowPct = ((minLow - price) / price) * 100;
  const maxRallyPct = ((maxHigh - price) / price) * 100;

  const closeAt = (offset: number) =>
    idx + offset <= endIdx ? ((barsAsc[idx + offset].close - price) / price) * 100 : null;

  // Realized vol over the forward window (annualized %)
  const rets: number[] = [];
  for (let k = idx + 1; k <= endIdx; k++) {
    rets.push(((barsAsc[k].close - barsAsc[k - 1].close) / barsAsc[k - 1].close) * 100);
  }
  const volDuringForward = stdev(rets) * Math.sqrt(252);

  let daysToRecovery: number | null = null;
  for (let k = idx + 1; k <= endIdx; k++) {
    if (barsAsc[k].high >= targetPeak) {
      daysToRecovery = k - idx;
      break;
    }
  }

  const bottomAlreadyIn = troughOffset <= 3 && minLowPct > -1.5;
  const bottomType = classifyBottom(barsAsc, idx, curFeatures, minLowPct, troughOffset || 1, daysToRecovery);

  const fwd90Val = closeAt(90);
  const failed =
    (fwd90Val !== null && fwd90Val < -5) ||
    (minLowPct < -15 && daysToRecovery === null);

  return {
    path,
    minLowPct,
    daysToTrough: troughOffset || 1,
    fwd1: closeAt(1),
    fwd5: closeAt(5),
    fwd10: closeAt(10),
    fwd20: closeAt(20),
    fwd30: closeAt(30),
    fwd60: closeAt(60),
    fwd90: fwd90Val,
    daysToRecovery,
    recovered: daysToRecovery !== null,
    maxRallyPct,
    volDuringForward,
    bottomAlreadyIn,
    bottomType,
    failed,
  };
}

// ── Aggregation ──

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[i];
}

function weightedMean(vals: number[], ws: number[]): number {
  let a = 0, b = 0;
  for (let i = 0; i < vals.length; i++) { a += vals[i] * ws[i]; b += ws[i]; }
  return b > 0 ? a / b : 0;
}

function aggregate(matches: AnalogHit[]): AnalogAggregate {
  const ws = matches.map((m) => m.weight);
  const mins = matches.map((m) => m.forward.minLowPct);
  const troughs = matches.map((m) => m.forward.daysToTrough);
  const f5 = matches.map((m) => m.forward.fwd5).filter((x): x is number => x !== null);
  const f30arr = matches.filter((m) => m.forward.fwd30 !== null);
  const f90arr = matches.filter((m) => m.forward.fwd90 !== null);
  const f30 = f30arr.map((m) => m.forward.fwd30!);
  const f90 = f90arr.map((m) => m.forward.fwd90!);
  const f30w = f30arr.map((m) => m.weight);
  const f90w = f90arr.map((m) => m.weight);
  const recDays = matches.map((m) => m.forward.daysToRecovery).filter((x): x is number => x !== null);
  const recovered = matches.filter((m) => m.forward.recovered).length;
  const rallies = matches.map((m) => m.forward.maxRallyPct);
  const fvols = matches.map((m) => m.forward.volDuringForward);

  const meanSimilarity = weightedMean(matches.map((m) => m.similarity), ws);
  const agreementSpread = f90.length > 1 ? stdev(f90) : 0;
  const agreement = Math.max(0, 1 - Math.min(1, agreementSpread / 30));

  const reversalCount = matches.filter((m) => m.forward.recovered && (m.forward.fwd90 ?? 0) > 0).length;
  const declineCount = matches.filter((m) => (m.forward.fwd90 ?? 0) < -3).length;
  const chopCount = matches.length - reversalCount - declineCount;

  const bottomInMatches = matches.filter((m) => m.forward.bottomAlreadyIn);
  const bottomInShare = matches.length ? bottomInMatches.length / matches.length : 0;
  const remainingDownside = matches.filter((m) => !m.forward.bottomAlreadyIn);
  const expectedRemainingDownside = remainingDownside.length
    ? weightedMean(remainingDownside.map((m) => m.forward.minLowPct), remainingDownside.map((m) => m.weight))
    : 0;

  const btDist: Record<BottomType, number> = {
    capitulation: 0, v_bottom: 0, slow_bleed: 0, double_bottom: 0, rounded: 0, retest: 0, no_bottom: 0,
  };
  for (const m of matches) btDist[m.forward.bottomType]++;
  const nn = matches.length || 1;
  for (const k of Object.keys(btDist) as BottomType[]) btDist[k] = btDist[k] / nn;

  // Per-projection confidence: blends similarity, sample size, and agreement.
  const nBoost = Math.min(1, matches.length / 8);
  const simBoost = Math.min(1, meanSimilarity / 85);
  const confidenceOverall = Math.round(100 * (0.5 * simBoost + 0.3 * agreement + 0.2 * nBoost));
  const conf = (agree: number) =>
    Math.round(100 * (0.45 * simBoost + 0.35 * agree + 0.2 * nBoost));

  const downsideSpread = mins.length > 1 ? stdev(mins) : 0;
  const downsideAgree = Math.max(0, 1 - Math.min(1, downsideSpread / 12));
  const f30Spread = f30.length > 1 ? stdev(f30) : 0;
  const f30Agree = Math.max(0, 1 - Math.min(1, f30Spread / 15));

  return {
    count: matches.length,
    meanSimilarity: Math.round(meanSimilarity),
    agreement,
    meanMinLowPct: weightedMean(mins, ws),
    medianMinLowPct: median(mins),
    worstMinLowPct: Math.min(...mins),
    p25MinLowPct: percentile(mins, 25),
    p75MinLowPct: percentile(mins, 75),
    meanDaysToTrough: weightedMean(troughs, ws),
    meanFwd5: f5.length ? weightedMean(f5, f5.map(() => 1)) : null,
    meanFwd30: f30.length ? weightedMean(f30, f30w) : null,
    meanFwd90: f90.length ? weightedMean(f90, f90w) : null,
    p25Fwd30: f30.length ? percentile(f30, 25) : null,
    p75Fwd30: f30.length ? percentile(f30, 75) : null,
    p25Fwd90: f90.length ? percentile(f90, 25) : null,
    p75Fwd90: f90.length ? percentile(f90, 75) : null,
    meanMaxRally: weightedMean(rallies, ws),
    meanForwardVol: weightedMean(fvols, ws),
    recoveryRate: matches.length ? recovered / matches.length : 0,
    medianDaysToRecovery: recDays.length ? median(recDays) : null,
    probReversal: matches.length ? reversalCount / matches.length : 0,
    probContinuedDecline: matches.length ? declineCount / matches.length : 0,
    probChop: matches.length ? Math.max(0, chopCount / matches.length) : 0,
    probBottomIn: bottomInShare,
    expectedRemainingDownside,
    bottomTypeDistribution: btDist,
    confidenceOverall,
    confidenceDownside: conf(downsideAgree),
    confidenceFwd30: conf(f30Agree),
    confidenceFwd90: conf(agreement),
    confidenceBottomIn: conf(Math.max(bottomInShare, 1 - bottomInShare)),
  };
}

// ── Market phase, narrative, failure, horizons, trader answers ──

export function classifyMarketPhase(f: WindowFeatures): { phase: MarketPhase; narrative: string } {
  const dd = f.dd60;
  const days = f.daysSincePeak60;
  const speed = f.speedDecline; // %/day, negative for declines
  const rsi = f.rsi14;
  const volExp = f.volExpansion;
  const ret5 = f.ret5;
  const ret20 = f.ret20;
  const ret60 = f.ret60;
  const distSma50 = f.distSma50;

  // Uptrend
  if (dd > -3 && distSma50 > 0 && ret60 > 0)
    return { phase: "uptrend", narrative: `Uptrend — price is within 3% of its 60d high and above the 50-day moving average.` };

  // Chop
  if (dd > -4 && Math.abs(ret60) < 4 && volExp < 1.15)
    return { phase: "chop", narrative: `Range-bound — small drawdown, low volatility expansion, flat 60d return.` };

  // Capitulation: fast, deep, hot vol, oversold
  if (dd < -10 && ret5 < -5 && volExp > 1.35 && rsi < 35)
    return { phase: "capitulation", narrative: `Capitulation — ${dd.toFixed(1)}% drawdown with a ${ret5.toFixed(1)}% 5-day flush, volatility expanding ${((volExp - 1) * 100).toFixed(0)}%, RSI ${rsi.toFixed(0)}.` };

  // Failed bounce: bounced 20d then rolling
  if (dd < -8 && ret20 > 3 && ret5 < -2)
    return { phase: "failed_bounce", narrative: `Failed bounce — rallied ${ret20.toFixed(1)}% off the low over 20d then rolled over the last 5d (${ret5.toFixed(1)}%).` };

  // Bottoming: deep dd, RSI turning up, positive short-term
  if (dd < -8 && rsi >= 32 && rsi <= 48 && ret5 > 0 && speed > -0.3)
    return { phase: "bottoming", narrative: `Potential bottoming — drawdown has stabilised, RSI ${rsi.toFixed(0)} lifting, 5d return positive.` };

  // Recovery: bouncing from decline, still below high
  if (dd > -12 && dd < -2 && ret20 > 5 && distSma50 > -3)
    return { phase: "recovery", narrative: `Recovery underway — bouncing ${ret20.toFixed(1)}% off recent lows, closing back toward the 50-day.` };

  // Retest: dd similar but ret60 stayed weak, prior lows nearby
  if (dd < -6 && ret60 < -3 && Math.abs(ret5) < 3)
    return { phase: "retest", narrative: `Retest zone — sitting near prior lows with muted 5d moves after a weak 60-day.` };

  // Decline staging by days-since-peak and depth
  if (dd < -15 && days > 25 && speed < 0)
    return { phase: "late_decline", narrative: `Late decline — ${dd.toFixed(1)}% off high, ${days} days into the sell-off.` };
  if (dd < -8 && days >= 10)
    return { phase: "mid_decline", narrative: `Mid-decline — ${dd.toFixed(1)}% off high, ${days} days into the sell-off.` };
  if (dd < -3)
    return { phase: "early_decline", narrative: `Early decline — ${dd.toFixed(1)}% off high after ${days} days.` };

  return { phase: "chop", narrative: `Neutral tape — no dominant phase signal.` };
}

const PHASE_LABEL: Record<MarketPhase, string> = {
  uptrend: "Uptrend",
  chop: "Chop / range",
  early_decline: "Early decline",
  mid_decline: "Mid decline",
  late_decline: "Late decline",
  capitulation: "Capitulation",
  bottoming: "Bottoming",
  failed_bounce: "Failed bounce",
  recovery: "Recovery",
  retest: "Retest",
};

const BOTTOM_LABEL: Record<BottomType, string> = {
  capitulation: "capitulation",
  v_bottom: "V-bottom",
  slow_bleed: "slow bleed",
  double_bottom: "double bottom",
  rounded: "rounded bottom",
  retest: "retest",
  no_bottom: "no clean bottom",
};

function buildBestNarrative(best: AnalogHit): string {
  const fw = best.forward;
  const d = new Date(best.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const src = best.isSameSymbol ? "" : ` in ${best.symbol}`;
  const bits: string[] = [];
  if (fw.minLowPct < -0.5) {
    bits.push(`declined another ${fw.minLowPct.toFixed(1)}% into a trough ${fw.daysToTrough} trading days later`);
  } else {
    bits.push(`bottomed almost immediately (within ${fw.daysToTrough}d)`);
  }
  bits.push(`formed a ${BOTTOM_LABEL[fw.bottomType]}`);
  if (fw.recovered && fw.daysToRecovery !== null) {
    bits.push(`fully recovered its prior 60d high within ${fw.daysToRecovery} trading days`);
  } else if (fw.maxRallyPct > 3) {
    bits.push(`rallied up to +${fw.maxRallyPct.toFixed(1)}% off the low without reclaiming the prior high inside 90d`);
  } else {
    bits.push(`did not recover meaningfully inside the 90-day window`);
  }
  if (fw.fwd30 !== null) bits.push(`30d return ${fw.fwd30 >= 0 ? "+" : ""}${fw.fwd30.toFixed(1)}%`);
  if (fw.fwd90 !== null) bits.push(`90d return ${fw.fwd90 >= 0 ? "+" : ""}${fw.fwd90.toFixed(1)}%`);
  return `On ${d}${src}, price ${bits.join("; ")}.`;
}

function buildHorizons(matches: AnalogHit[], aggMeanSim: number): HorizonExpectation[] {
  const days = [1, 5, 10, 20, 30, 60, 90] as const;
  const getters: Record<number, (f: ForwardOutcome) => number | null> = {
    1: (f) => f.fwd1, 5: (f) => f.fwd5, 10: (f) => f.fwd10, 20: (f) => f.fwd20,
    30: (f) => f.fwd30, 60: (f) => f.fwd60, 90: (f) => f.fwd90,
  };
  const simBoost = Math.min(1, aggMeanSim / 85);
  const nBoost = Math.min(1, matches.length / 8);
  return days.map((d) => {
    const g = getters[d];
    const pairs = matches
      .map((m) => ({ v: g(m.forward), w: m.weight }))
      .filter((p): p is { v: number; w: number } => p.v !== null);
    if (!pairs.length) return { days: d, meanPct: 0, p25: 0, p75: 0, probUp: 0.5, sample: 0, confidence: 0 };
    const vals = pairs.map((p) => p.v);
    const mean = weightedMean(vals, pairs.map((p) => p.w));
    const p25 = percentile(vals, 25);
    const p75 = percentile(vals, 75);
    const probUp = pairs.filter((p) => p.v > 0).length / pairs.length;
    const spread = vals.length > 1 ? stdev(vals) : 0;
    // Larger tolerance for longer horizons.
    const tol = 2 + d * 0.35;
    const agree = Math.max(0, 1 - Math.min(1, spread / tol));
    const conf = Math.round(100 * (0.45 * simBoost + 0.35 * agree + 0.2 * nBoost));
    return { days: d, meanPct: mean, p25, p75, probUp, sample: pairs.length, confidence: conf };
  });
}

function buildFailureAnalysis(matches: AnalogHit[]): AnalogSearchResult["failureAnalysis"] {
  const failed = matches.filter((m) => m.forward.failed);
  const rate = matches.length ? failed.length / matches.length : 0;
  const examples: FailureExample[] = failed
    .slice()
    .sort((a, b) => (a.forward.fwd90 ?? 0) - (b.forward.fwd90 ?? 0))
    .slice(0, 3)
    .map((m) => ({
      date: m.date,
      symbol: m.symbol,
      similarity: m.similarity,
      minLowPct: m.forward.minLowPct,
      fwd90: m.forward.fwd90,
      reason:
        m.forward.fwd90 !== null && m.forward.fwd90 < -10
          ? "kept declining through the 90d window"
          : m.forward.minLowPct < -15 && !m.forward.recovered
            ? "deep drawdown that never recovered its prior high"
            : "unable to reclaim prior peak inside 90d",
    }));
  const summary = matches.length === 0
    ? "No historical evidence."
    : rate === 0
      ? "None of the top analogs failed inside the 90-day window — historically favorable."
      : rate < 0.25
        ? `Only ${Math.round(rate * 100)}% of analogs failed — small tail risk.`
        : rate < 0.5
          ? `${Math.round(rate * 100)}% of analogs failed — meaningful downside tail.`
          : `${Math.round(rate * 100)}% of analogs failed — evidence is mixed to unfavorable.`;
  return { failureRate: rate, failedCount: failed.length, failedExamples: examples, summary };
}

function buildTraderAnswers(
  current: WindowFeatures,
  totalCandidatesSearched: number,
  matches: AnalogHit[],
  agg: AnalogAggregate,
): TraderAnswers {
  const phaseInfo = classifyMarketPhase(current);
  const occurrences = matches.filter((m) => m.similarity >= 70).length;
  const seenBefore = occurrences > 0;

  // Favorability score in [-100, 100]
  const meanFwd90 = agg.meanFwd90 ?? 0;
  const rev = agg.probReversal - agg.probContinuedDecline;
  const failPenalty = -0.5 * (matches.filter((m) => m.forward.failed).length / Math.max(1, matches.length));
  const score = Math.round(50 * rev + 2 * meanFwd90 + 100 * failPenalty);
  const favorability: TraderAnswers["favorability"] =
    score > 15 ? "favorable" : score < -15 ? "unfavorable" : "mixed";

  const earlyOrLate: TraderAnswers["earlyOrLate"] =
    agg.probBottomIn > 0.6
      ? "post-bottom"
      : phaseInfo.phase === "early_decline"
        ? "early"
        : phaseInfo.phase === "mid_decline" || phaseInfo.phase === "failed_bounce"
          ? "middle"
          : phaseInfo.phase === "late_decline" || phaseInfo.phase === "capitulation" || phaseInfo.phase === "bottoming"
            ? "late"
            : "n/a";

  const usually =
    matches.length === 0
      ? "Not enough analogs to say."
      : agg.probReversal > 0.55
        ? `Historically reversed higher — mean 90d return ${meanFwd90.toFixed(1)}%, recovery rate ${Math.round(agg.recoveryRate * 100)}%.`
        : agg.probContinuedDecline > 0.55
          ? `Historically kept declining — mean 90d return ${meanFwd90.toFixed(1)}%, expected further downside ${agg.expectedRemainingDownside.toFixed(1)}%.`
          : `Mixed outcomes — ${Math.round(agg.probReversal * 100)}% reversal / ${Math.round(agg.probChop * 100)}% chop / ${Math.round(agg.probContinuedDecline * 100)}% decline.`;

  const risks =
    matches.length === 0
      ? "No historical evidence to compare against."
      : `Failure rate ${Math.round((matches.filter((m) => m.forward.failed).length / matches.length) * 100)}%. ` +
        (agg.probBottomIn < 0.4
          ? `Bottom may still be ahead (est. ${agg.expectedRemainingDownside.toFixed(1)}% more downside). `
          : "") +
        (agg.agreement < 0.4 ? "Wide disagreement across analogs — treat projections as ranges, not point targets." : "");

  const riskRewardNote =
    agg.meanFwd90 !== null && agg.expectedRemainingDownside !== 0
      ? `Upside vs downside: mean 90d ${agg.meanFwd90.toFixed(1)}% vs expected remaining downside ${agg.expectedRemainingDownside.toFixed(1)}%.`
      : "";

  return {
    seenBefore,
    occurrences: matches.length,
    favorability,
    favorabilityScore: score,
    phase: phaseInfo.phase,
    phaseNarrative: phaseInfo.narrative,
    whatUsuallyHappens: usually,
    biggestRisks: risks,
    riskRewardNote,
    earlyOrLate,
  };
}

// ── Public entry point ──


export type CandidateSet = {
  symbol: string;
  bars: Bar[];
  features: (WindowFeatures | null)[];
  isSameSymbol: boolean;
};

export function searchAnalogs(
  symbol: string,
  primary: { bars: Bar[]; features: (WindowFeatures | null)[] },
  extras: CandidateSet[] = [],
  opts: { topK?: number; excludeRecentDays?: number } = {},
): AnalogSearchResult | null {
  const topK = opts.topK ?? 8;
  const excludeRecent = opts.excludeRecentDays ?? 120;

  const n = primary.bars.length;
  const currentIdx = n - 1;
  const current = primary.features[currentIdx];
  if (!current) return null;

  // Two-phase pipeline:
  //  1) Score similarity for every eligible bar (cheap, no forward walk).
  //  2) Take top ~topK*6 pre-dedup, THEN compute forward outcomes only
  //     for those. Previously we ran the 90-bar forward walk for every
  //     candidate with similarity ≥ 30, which was 10–50× more work than
  //     needed on a full scan.
  type PreScored = {
    date: string;
    idx: number;
    symbol: string;
    isSameSymbol: boolean;
    similarity: number;
    weight: number;
    features: WindowFeatures;
    distanceBreakdown: AnalogHit["distanceBreakdown"];
  };
  const preScored: PreScored[] = [];

  // Recency weight: linear from 1.0 (today) down to 0.75 for matches
  // ~20 years old, so modern regime evidence gets a mild edge without
  // discarding old analogs. Applied on top of similarity² and sibling
  // penalty in the aggregation weight.
  const recencyWeight = (bars: Bar[], i: number): number => {
    const ageDays = bars.length - 1 - i;
    const twentyYears = 252 * 20;
    return 1 - 0.25 * Math.min(1, ageDays / twentyYears);
  };

  const collect = (set: CandidateSet, siblingPenalty: number) => {
    const N = set.bars.length;
    const maxCandidateIdx = N - 91;
    for (let i = 252; i <= maxCandidateIdx; i++) {
      const f = set.features[i];
      if (!f) continue;
      if (set.isSameSymbol && currentIdx - i < excludeRecent) continue;

      // Hard regime gate: reject candidates whose dd60 is on the opposite side
      // of zero (bull vs bear) OR whose magnitude differs by more than 2x.
      const cd = current.dd60;
      if (cd < -0.5 || cd > 0.5) {
        const ratio = f.dd60 === 0 ? Infinity : cd / f.dd60;
        if (ratio < 0.2 || ratio > 5) continue;
      }

      // Phase-2 momentum regime gate: when today is decisively oversold
      // (RSI14 < 35) or overbought (RSI14 > 65), reject candidates in the
      // opposite RSI regime. Keeps analogs directionally comparable.
      const curRsi = current.rsi14;
      const fRsi = f.rsi14;
      if (curRsi < 35 && fRsi > 55) continue;
      if (curRsi > 65 && fRsi < 45) continue;

      // Cheap prescreen — skip full 36-feature Gaussian for obvious non-matches.
      if (!passesPrescreen(current, f)) continue;

      const { similarity, breakdown } = scoreSimilarity(current, f);
      if (similarity < 30) continue;
      const weight = ((similarity / 100) ** 2) * siblingPenalty * recencyWeight(set.bars, i);
      preScored.push({
        date: f.date,
        idx: f.idx,
        symbol: set.symbol,
        isSameSymbol: set.isSameSymbol,
        similarity,
        weight,
        features: f,
        distanceBreakdown: breakdown,
      });
    }
  };

  collect({ symbol, bars: primary.bars, features: primary.features, isSameSymbol: true }, 1.0);
  const barsBySymbol = new Map<string, Bar[]>();
  barsBySymbol.set(symbol, primary.bars);
  for (const s of extras) {
    barsBySymbol.set(s.symbol, s.bars);
    collect(s, 0.7);
  }

  if (!preScored.length) return null;

  // Rank by aggregation weight so siblings (penalized) don't evict
  // high-quality same-symbol matches, then dedupe.
  preScored.sort((a, b) => b.weight - a.weight);

  // Phase-2 dynamic quality floor: instead of a flat 30% cutoff, require
  // candidates to score within striking distance of the top of the pool.
  // Take the median similarity of the top 24 pre-dedup candidates and use
  // 0.70 * median (with a hard floor of 35) as the acceptance threshold.
  // Prevents forcing weak matches when the pool is thin OR very strong.
  const topSlice = preScored.slice(0, Math.min(24, preScored.length));
  const sortedSims = topSlice.map((s) => s.similarity).sort((a, b) => a - b);
  const medianTop = sortedSims.length
    ? sortedSims[Math.floor(sortedSims.length / 2)]
    : 0;
  const dynamicFloor = Math.max(35, Math.round(medianTop * 0.7));
  const gated = preScored.filter((s) => s.similarity >= dynamicFloor);
  const pool = gated.length >= 4 ? gated : preScored;


  const kept: AnalogHit[] = [];
  const yearCounts = new Map<string, number>();
  const CANDIDATE_POOL = topK * 6;
  for (const s of pool) {
    if (kept.length >= topK) break;
    if (kept.some((k) => k.symbol === s.symbol && Math.abs(k.idx - s.idx) < 20)) continue;
    const yr = s.date.slice(0, 4);
    const yk = `${s.symbol}:${yr}`;
    if ((yearCounts.get(yk) ?? 0) >= 2) continue;
    yearCounts.set(yk, (yearCounts.get(yk) ?? 0) + 1);
    // Compute forward outcome lazily — only for candidates that survive dedupe.
    const bars = barsBySymbol.get(s.symbol);
    if (!bars) continue;
    const forward = computeForward(bars, s.idx, s.features);
    kept.push({
      date: s.date,
      idx: s.idx,
      symbol: s.symbol,
      isSameSymbol: s.isSameSymbol,
      similarity: s.similarity,
      weight: s.weight,
      features: s.features,
      forward,
      distanceBreakdown: s.distanceBreakdown,
    });
    if (kept.length >= topK) break;
    // Safety: never inspect more than CANDIDATE_POOL to bound worst-case work.
    if (kept.length + yearCounts.size > CANDIDATE_POOL) break;
  }
  if (!kept.length) return null;

  const best = kept[0];
  const agg = aggregate(kept);
  const price = current.price;

  const contributingSymbols: { symbol: string; matches: number }[] = [];
  for (const m of kept) {
    const e = contributingSymbols.find((x) => x.symbol === m.symbol);
    if (e) e.matches++;
    else contributingSymbols.push({ symbol: m.symbol, matches: 1 });
  }

  // Explanation for the BEST match
  const sortedByScore = [...best.distanceBreakdown].sort((a, b) => b.score - a.score);
  const strongestSimilarities = sortedByScore.slice(0, 4).map((f) => ({ label: f.label, delta: f.delta, score: f.score }));
  const biggestDifferences = sortedByScore.slice(-3).reverse().map((f) => ({ label: f.label, delta: f.delta, score: f.score }));

  const bestDate = new Date(best.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const summary =
    `Closest to ${bestDate}${best.isSameSymbol ? "" : ` (${best.symbol})`}` +
    ` — ${best.similarity}% match across ${strongestSimilarities.map((f) => f.label.toLowerCase()).slice(0, 2).join(" and ")};` +
    ` ${biggestDifferences[0] ? `differs most on ${biggestDifferences[0].label.toLowerCase()}.` : ""}`;

  const projectedFloor = price * (1 + agg.p25MinLowPct / 100);
  const phaseInfo = classifyMarketPhase(current);
  const horizons = buildHorizons(kept, agg.meanSimilarity);
  const failureAnalysis = buildFailureAnalysis(kept);
  const traderAnswers = buildTraderAnswers(current, preScored.length, kept, agg);
  const bestNarrative = buildBestNarrative(best);
  const phaseNarrative = `${PHASE_LABEL[phaseInfo.phase]} — ${phaseInfo.narrative}`;

  return {
    symbol,
    asOfDate: current.date,
    current,
    best,
    matches: kept,
    aggregate: agg,
    projections: {
      worstPrice: price * (1 + agg.meanMinLowPct / 100),
      worstPriceP10: price * (1 + percentile(kept.map((k) => k.forward.minLowPct), 10) / 100),
      priceAt30d: agg.meanFwd30 !== null ? price * (1 + agg.meanFwd30 / 100) : null,
      priceAt30dLow: agg.p25Fwd30 !== null ? price * (1 + agg.p25Fwd30 / 100) : null,
      priceAt30dHigh: agg.p75Fwd30 !== null ? price * (1 + agg.p75Fwd30 / 100) : null,
      priceAt90d: agg.meanFwd90 !== null ? price * (1 + agg.meanFwd90 / 100) : null,
      priceAt90dLow: agg.p25Fwd90 !== null ? price * (1 + agg.p25Fwd90 / 100) : null,
      priceAt90dHigh: agg.p75Fwd90 !== null ? price * (1 + agg.p75Fwd90 / 100) : null,
      recoveryPrice: current.high60,
      projectedFloor,
      expectedDaysToTrough: Math.max(1, Math.round(agg.meanDaysToTrough)),
      expectedDaysToRecovery: agg.medianDaysToRecovery,
    },
    horizons,
    marketPhase: phaseInfo.phase,
    phaseNarrative,
    bestNarrative,
    failureAnalysis,
    traderAnswers,
    totalCandidatesSearched: preScored.length,
    contributingSymbols,
    strongestSimilarities,
    biggestDifferences,
    summary,
  };
}

export function toSummary(r: AnalogSearchResult): AnalogSummary {
  return {
    symbol: r.symbol,
    bestDate: r.best.date,
    similarity: r.best.similarity,
    probBottomIn: r.aggregate.probBottomIn,
    expectedRemainingDownsidePct: r.aggregate.expectedRemainingDownside,
    projectedFloor: r.projections.projectedFloor,
    recoveryPrice: r.projections.recoveryPrice,
    confidence: r.aggregate.confidenceOverall,
  };
}

// ── Historical data path ──
//
// Phase-1 audit (2026-07-15): the TwelveData daily fetch was retired. The
// Historical Analog Scanner now uses Yahoo (primary, split+dividend adjusted
// via yahoo.server.ts) with Stooq as the automatic fallback. TwelveData
// credits are reserved for live quotes, intraday, and sector proxies.
//
// `fetchLongHistory` is preserved as a thin compatibility shim so existing
// call sites (analog-search.functions.ts, simulation.functions.ts) keep
// working without churn. The `apiKey` argument is ignored — Yahoo/Stooq
// require no key. See REBUILD.md §7.6.
export async function fetchLongHistory(
  symbol: string,
  _apiKey?: string,
  _outputsize = 5000,
): Promise<Bar[]> {
  void _apiKey;
  void _outputsize;
  try {
    const { fetchYahooDaily } = await import("./yahoo.server");
    const yh = await fetchYahooDaily(symbol);
    if (yh.length >= 300) return yh;
  } catch {
    /* fall through to Stooq */
  }
  try {
    const { fetchStooqDaily } = await import("./stooq.server");
    const st = await fetchStooqDaily(symbol);
    if (st.length > 0) return st;
  } catch {
    /* nothing left to try */
  }
  return [];
}


