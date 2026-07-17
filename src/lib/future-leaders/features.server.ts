// Feature engineering for the Future Leaders Scanner.
// Consumes Yahoo-adjusted daily Bar[] (newest-first, as returned by
// fetchYahooDaily in market.server.ts) and produces the numeric feature
// vector the scoring models operate on.

import type { Bar } from "../market.server";

export type FeatureVector = {
  symbol: string;
  price: number;
  asOf: string;
  barsAvailable: number;

  // Returns (log-adjusted, %)
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret12m: number | null;
  ret12m1m: number | null; // 12-1 momentum (classic Fama-French)
  ret3y: number | null;
  ret5y: number | null;
  cagr3y: number | null;
  cagr5y: number | null;

  // Trend
  sma50: number | null;
  sma200: number | null;
  distSma50Pct: number | null;
  distSma200Pct: number | null;
  sma200SlopePct: number | null; // % change of SMA200 vs 60 bars ago
  above200: boolean;
  stage2: boolean; // Weinstein-style stage 2 flag

  // 52w bounds
  high52w: number;
  low52w: number;
  distFromHigh52wPct: number;
  distFromLow52wPct: number;

  // Volatility & risk
  volAnn60: number | null; // annualized realized vol from 60d log-returns
  volAnn250: number | null;
  maxDrawdown1y: number; // negative %
  maxDrawdown3y: number;

  // Beta / alpha vs SPY (250d)
  beta250: number | null;
  alphaAnn250: number | null; // annualized alpha vs SPY

  // Volume
  avgDollarVol20: number | null;
  volumeTrendRatio: number | null; // avg vol 20 / avg vol 250
  upDayRatio250: number | null;

  // Relative strength vs SPY (Mansfield-style, 252d)
  rsMansfield: number | null;
};

function pctChange(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return NaN;
  return ((a - b) / b) * 100;
}

function sma(closes: number[], period: number, offset = 0): number | null {
  // closes is newest-first
  if (closes.length < offset + period) return null;
  let sum = 0;
  for (let i = offset; i < offset + period; i++) sum += closes[i];
  return sum / period;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - m) * (b - m), 0) / (nums.length - 1);
  return Math.sqrt(v);
}

function returnBetween(closes: number[], fromIdx: number, toIdx: number): number | null {
  // closes newest-first: fromIdx > toIdx (further back to more recent)
  if (fromIdx >= closes.length || toIdx >= closes.length) return null;
  const older = closes[fromIdx];
  const newer = closes[toIdx];
  if (!older || older === 0) return null;
  return pctChange(newer, older);
}

function maxDrawdown(closes: number[], lookback: number): number {
  // closes newest-first; walk in chronological order over the last `lookback` bars
  const window = closes.slice(0, Math.min(lookback, closes.length)).slice().reverse();
  if (window.length < 2) return 0;
  let peak = window[0];
  let mdd = 0;
  for (const c of window) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return mdd * 100;
}

function annualizedVol(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const rets: number[] = [];
  for (let i = 0; i < lookback; i++) {
    const c = closes[i];
    const p = closes[i + 1];
    if (!c || !p) return null;
    rets.push(Math.log(c / p));
  }
  return stdev(rets) * Math.sqrt(252) * 100;
}

function alignedReturns(a: number[], b: number[], n: number): { ra: number[]; rb: number[] } | null {
  if (a.length < n + 1 || b.length < n + 1) return null;
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 0; i < n; i++) {
    const a1 = a[i], a2 = a[i + 1], b1 = b[i], b2 = b[i + 1];
    if (!a1 || !a2 || !b1 || !b2) return null;
    ra.push(Math.log(a1 / a2));
    rb.push(Math.log(b1 / b2));
  }
  return { ra, rb };
}

function betaAlpha(closes: number[], spyCloses: number[]): { beta: number | null; alphaAnn: number | null } {
  const aligned = alignedReturns(closes, spyCloses, 250);
  if (!aligned) return { beta: null, alphaAnn: null };
  const { ra, rb } = aligned;
  const meanA = ra.reduce((a, b) => a + b, 0) / ra.length;
  const meanB = rb.reduce((a, b) => a + b, 0) / rb.length;
  let cov = 0, varB = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - meanA) * (rb[i] - meanB);
    varB += (rb[i] - meanB) ** 2;
  }
  if (varB === 0) return { beta: null, alphaAnn: null };
  const beta = cov / varB;
  const alphaDaily = meanA - beta * meanB;
  return { beta, alphaAnn: alphaDaily * 252 * 100 };
}

function mansfieldRS(closes: number[], spyCloses: number[]): number | null {
  // Mansfield RS: (ratio / MA(ratio, 52w) - 1) * 100
  if (closes.length < 252 || spyCloses.length < 252) return null;
  const ratios: number[] = [];
  for (let i = 0; i < 252; i++) {
    if (!spyCloses[i]) return null;
    ratios.push(closes[i] / spyCloses[i]);
  }
  const cur = ratios[0];
  const ma = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (ma === 0) return null;
  return (cur / ma - 1) * 100;
}

const TRADING_DAYS_1M = 21;
const TRADING_DAYS_3M = 63;
const TRADING_DAYS_6M = 126;
const TRADING_DAYS_1Y = 252;
const TRADING_DAYS_3Y = 756;
const TRADING_DAYS_5Y = 1260;

export function computeFeatureVector(
  symbol: string,
  bars: Bar[],
  spyBars: Bar[] | null,
): FeatureVector | null {
  if (!bars || bars.length < 60) return null;

  const closes = bars.map((b) => b.close);
  const spyCloses = spyBars ? spyBars.map((b) => b.close) : [];
  const price = closes[0];
  const asOf = bars[0].datetime;

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma200Prev = sma(closes, 200, 60);
  const sma30 = sma(closes, 30);
  const sma30Prev = sma(closes, 30, 10);

  const window52w = closes.slice(0, Math.min(252, closes.length));
  const high52w = Math.max(...window52w);
  const low52w = Math.min(...window52w);

  const above200 = sma200 !== null && price > sma200;
  const stage2 =
    sma30 !== null &&
    sma30Prev !== null &&
    price > sma30 &&
    sma30 > sma30Prev &&
    above200;

  const beta = spyCloses.length >= 251 ? betaAlpha(closes, spyCloses) : { beta: null, alphaAnn: null };
  const rs = spyCloses.length >= 252 ? mansfieldRS(closes, spyCloses) : null;

  // Volume features
  let avgDollarVol20: number | null = null;
  let volumeTrendRatio: number | null = null;
  if (bars.length >= 20 && bars[0].volume != null) {
    let sum = 0, n = 0;
    for (let i = 0; i < 20; i++) {
      const v = bars[i].volume;
      if (v != null) { sum += v * bars[i].close; n++; }
    }
    if (n > 0) avgDollarVol20 = sum / n;
    if (bars.length >= 250) {
      let v20 = 0, c20 = 0, v250 = 0, c250 = 0;
      for (let i = 0; i < 250; i++) {
        const v = bars[i].volume;
        if (v == null) continue;
        v250 += v; c250++;
        if (i < 20) { v20 += v; c20++; }
      }
      if (c20 > 0 && c250 > 0) {
        const a = v20 / c20, b = v250 / c250;
        if (b > 0) volumeTrendRatio = a / b;
      }
    }
  }

  // Up-day ratio last 250 sessions
  let upDayRatio250: number | null = null;
  if (closes.length >= 251) {
    let up = 0;
    for (let i = 0; i < 250; i++) if (closes[i] > closes[i + 1]) up++;
    upDayRatio250 = up / 250;
  }

  const sma200SlopePct =
    sma200 !== null && sma200Prev !== null && sma200Prev !== 0
      ? ((sma200 - sma200Prev) / sma200Prev) * 100
      : null;

  return {
    symbol,
    price,
    asOf,
    barsAvailable: bars.length,
    ret1m: returnBetween(closes, TRADING_DAYS_1M, 0),
    ret3m: returnBetween(closes, TRADING_DAYS_3M, 0),
    ret6m: returnBetween(closes, TRADING_DAYS_6M, 0),
    ret12m: returnBetween(closes, TRADING_DAYS_1Y, 0),
    ret12m1m: returnBetween(closes, TRADING_DAYS_1Y, TRADING_DAYS_1M),
    ret3y: returnBetween(closes, TRADING_DAYS_3Y, 0),
    ret5y: returnBetween(closes, TRADING_DAYS_5Y, 0),
    cagr3y: (() => {
      const r = returnBetween(closes, TRADING_DAYS_3Y, 0);
      if (r === null) return null;
      return (Math.pow(1 + r / 100, 1 / 3) - 1) * 100;
    })(),
    cagr5y: (() => {
      const r = returnBetween(closes, TRADING_DAYS_5Y, 0);
      if (r === null) return null;
      return (Math.pow(1 + r / 100, 1 / 5) - 1) * 100;
    })(),
    sma50,
    sma200,
    distSma50Pct: sma50 ? pctChange(price, sma50) : null,
    distSma200Pct: sma200 ? pctChange(price, sma200) : null,
    sma200SlopePct,
    above200,
    stage2,
    high52w,
    low52w,
    distFromHigh52wPct: pctChange(price, high52w),
    distFromLow52wPct: pctChange(price, low52w),
    volAnn60: annualizedVol(closes, 60),
    volAnn250: annualizedVol(closes, 250),
    maxDrawdown1y: maxDrawdown(closes, TRADING_DAYS_1Y),
    maxDrawdown3y: maxDrawdown(closes, TRADING_DAYS_3Y),
    beta250: beta.beta,
    alphaAnn250: beta.alphaAnn,
    avgDollarVol20,
    volumeTrendRatio,
    upDayRatio250,
    rsMansfield: rs,
  };
}
