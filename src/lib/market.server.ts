// Server-only market data + technical indicators + dip scoring.

export type Bar = {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

// Shared timeout wrapper — all upstream fetches (TwelveData, Yahoo,
// earnings providers) go through this so a hung remote never wedges the
// whole scan. 10s default keeps scans within a reasonable budget.
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5_000,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ac.signal });
  } finally {
    clearTimeout(timer);
  }
}




export type Snapshot = {
  symbol: string;
  price: number;
  change1d: number;
  change3d: number;
  change5d: number;
  atr14: number;
  ema9: number;
  sma20: number;
  sma50: number;
  sma200: number;
  high20: number;
  high60: number;
  asOf: string;
};

export const ASSET_META: Record<string, { name: string; group: string }> = {
  NDX: { name: "NASDAQ 100 Index", group: "Index" },
  SPY: { name: "SPDR S&P 500", group: "Index ETF" },
  QQQ: { name: "Invesco QQQ Trust", group: "Index ETF" },
  IWM: { name: "iShares Russell 2000", group: "Index ETF" },
  DIA: { name: "SPDR Dow Jones", group: "Index ETF" },
  SMH: { name: "VanEck Semiconductor", group: "Semi ETF" },
  SOXX: { name: "iShares Semiconductor", group: "Semi ETF" },
  SOXQ: { name: "Invesco PHLX Semi", group: "Semi ETF" },
  NVDA: { name: "NVIDIA Corp.", group: "Semi Major" },
  AMD: { name: "Advanced Micro Devices", group: "Semi Major" },
  TSM: { name: "Taiwan Semiconductor", group: "Semi Major" },
  AVGO: { name: "Broadcom Inc.", group: "Semi Major" },
  TQQQ: { name: "ProShares UltraPro QQQ 3x", group: "Leveraged" },
  SOXL: { name: "Direxion Semi Bull 3x", group: "Leveraged" },
  TECL: { name: "Direxion Tech Bull 3x", group: "Leveraged" },
  UPRO: { name: "ProShares UltraPro S&P 500 3x", group: "Leveraged" },
};

function sma(values: number[], period: number): number {
  if (values.length < period) throw new Error(`Not enough data for SMA${period}`);
  const slice = values.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaChronological(values: number[], period: number): number {
  if (values.length < period) throw new Error(`Not enough data for EMA${period}`);
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function atrWilder(bars: Bar[], period: number): number {
  if (bars.length < period + 1) throw new Error(`Not enough data for ATR${period}`);
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

export function computeSnapshot(symbol: string, barsNewestFirst: Bar[]): Snapshot {
  if (barsNewestFirst.length < 201) {
    throw new Error(
      `Insufficient history for ${symbol}: got ${barsNewestFirst.length} bars, need >= 201`,
    );
  }
  const closesDesc = barsNewestFirst.map((b) => b.close);
  const highsDesc = barsNewestFirst.map((b) => b.high);
  const price = closesDesc[0];
  const change1d = ((closesDesc[0] - closesDesc[1]) / closesDesc[1]) * 100;
  const change3d = ((closesDesc[0] - closesDesc[3]) / closesDesc[3]) * 100;
  const change5d = ((closesDesc[0] - closesDesc[5]) / closesDesc[5]) * 100;

  const barsAsc = [...barsNewestFirst].reverse();
  const closesAsc = barsAsc.map((b) => b.close);

  const sma20 = sma(closesDesc, 20);
  const sma50 = sma(closesDesc, 50);
  const sma200 = sma(closesDesc, 200);
  const ema9 = emaChronological(closesAsc, 9);
  const atr14 = atrWilder(barsAsc, 14);
  const high20 = Math.max(...highsDesc.slice(0, 20));
  const high60 = Math.max(...highsDesc.slice(0, 60));

  return {
    symbol,
    price,
    change1d,
    change3d,
    change5d,
    atr14,
    ema9,
    sma20,
    sma50,
    sma200,
    high20,
    high60,
    asOf: barsNewestFirst[0].datetime,
  };
}

// Score how attractive the current drawdown is. Higher = better dip.
export function scoreDip(s: Snapshot): {
  score: number;
  reasons: string[];
  distSma50Pct: number;
  distSma200Pct: number;
  drawdown20Pct: number;
  drawdown60Pct: number;
} {
  const reasons: string[] = [];
  let score = 0;

  const distSma50Pct = ((s.price - s.sma50) / s.sma50) * 100;
  const distSma200Pct = ((s.price - s.sma200) / s.sma200) * 100;
  const drawdown20Pct = ((s.price - s.high20) / s.high20) * 100;
  const drawdown60Pct = ((s.price - s.high60) / s.high60) * 100;

  // Touching a major support = fat pitch
  if (Math.abs(distSma200Pct) <= 2) {
    score += 40;
    reasons.push(`At 200-SMA (${distSma200Pct.toFixed(2)}%)`);
  } else if (distSma200Pct < 0 && distSma200Pct > -6) {
    score += 25;
    reasons.push(`Below 200-SMA (${distSma200Pct.toFixed(2)}%)`);
  }

  if (Math.abs(distSma50Pct) <= 1.5) {
    score += 25;
    reasons.push(`At 50-SMA (${distSma50Pct.toFixed(2)}%)`);
  } else if (distSma50Pct < 0 && distSma50Pct > -4) {
    score += 15;
    reasons.push(`Below 50-SMA (${distSma50Pct.toFixed(2)}%)`);
  }

  // Multi-day capitulation
  if (s.change5d < -8) {
    score += 30;
    reasons.push(`5d flush ${s.change5d.toFixed(2)}%`);
  } else if (s.change5d < -5) {
    score += 20;
    reasons.push(`5d down ${s.change5d.toFixed(2)}%`);
  } else if (s.change5d < -2) {
    score += 8;
    reasons.push(`5d soft ${s.change5d.toFixed(2)}%`);
  }

  // Today's drop
  if (s.change1d < -3) {
    score += 15;
    reasons.push(`Today ${s.change1d.toFixed(2)}%`);
  } else if (s.change1d < -1.5) {
    score += 8;
    reasons.push(`Today ${s.change1d.toFixed(2)}%`);
  }

  // Distance from 60-day high — bigger drawdown = better opportunity
  if (drawdown60Pct < -15) {
    score += 20;
    reasons.push(`${drawdown60Pct.toFixed(1)}% off 60d high`);
  } else if (drawdown60Pct < -8) {
    score += 10;
    reasons.push(`${drawdown60Pct.toFixed(1)}% off 60d high`);
  }

  // ── Kill switch (softened) ──
  // Only fully disqualify if the name is not falling in any meaningful way.
  // Recent strength now only *reduces* the score instead of forcing NO_DIP,
  // so a legitimate -3% day after a +5% day is still analyzed as a dip.
  const atrDrop = s.atr14 > 0 && (s.high20 - s.price) >= s.atr14;
  const meaningfulDaily = s.change1d <= -1.2;
  const meaningfulDrawdown = drawdown20Pct <= -3.0;
  const isFallingMeaningfully = meaningfulDaily || meaningfulDrawdown || atrDrop;

  // Green-today guard: if the name is up (or effectively flat) on the day,
  // it's not a dip today — regardless of prior weakness.
  const greenToday = s.change1d >= -0.05;

  // Trivial red day (< 1%) sitting on top of a strong rally = ignore
  const trivialAfterRally =
    s.change1d > -1.0 &&
    ((s.change5d > 3 && s.change1d > -0.5) || (s.change3d > 2 && s.change1d > -0.5));

  if (!isFallingMeaningfully || trivialAfterRally || greenToday) {
    score = 0;
    reasons.length = 0;
    reasons.push("Not falling meaningfully");
  } else {
    const strongRecent =
      (s.change5d > 3 && s.change1d > -2) || (s.change3d > 2 && s.change1d > -2);
    if (strongRecent) {
      const penalty = Math.min(25, Math.round(score * 0.3));
      score = Math.max(5, score - penalty);
      reasons.push(`Recent rally (5d ${s.change5d.toFixed(1)}%) — score reduced`);
    }
  }

  return { score, reasons, distSma50Pct, distSma200Pct, drawdown20Pct, drawdown60Pct };
}

// Fetch daily OHLC bars from Twelve Data (single symbol).
export async function fetchTimeSeries(symbol: string, apiKey: string): Promise<Bar[]> {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", "250");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("format", "JSON");

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
  const j = (await res.json()) as {
    status?: string;
    code?: number;
    message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>;
  };
  if (j.status === "error" || !j.values) {
    if (j.code === 429) throw new Error("RATE_LIMIT");
    throw new Error(j.message || `TwelveData error for ${symbol}`);
  }
  return j.values.map((v) => ({
    datetime: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  }));
}

// Batch fetch — Twelve Data supports comma-separated symbols.
export async function fetchTimeSeriesBatch(
  symbols: string[],
  apiKey: string,
): Promise<Record<string, Bar[]>> {
  if (symbols.length === 1) {
    const bars = await fetchTimeSeries(symbols[0], apiKey);
    return { [symbols[0]]: bars };
  }
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", "250");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("format", "JSON");

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
  const raw = (await res.json()) as unknown;

  // Detect top-level error envelope: batch endpoint returns a flat object
  // like {"code":429,"status":"error","message":"..."} on rate limits.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const top = raw as { code?: number; status?: string; message?: string };
    if (top.status === "error" || (typeof top.code === "number" && top.code >= 400)) {
      if (top.code === 429) throw new Error("RATE_LIMIT");
      throw new Error(top.message || `TwelveData error (code ${top.code ?? "?"})`);
    }
  }

  const j = raw as Record<
    string,
    {
      status?: string;
      code?: number;
      message?: string;
      values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>;
    }
  >;

  const out: Record<string, Bar[]> = {};
  for (const sym of symbols) {
    const entry = j[sym];
    if (!entry || entry.status === "error" || !entry.values) continue;
    out[sym] = entry.values.map((v) => ({
      datetime: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }));
  }
  return out;
}

// ─── Yahoo Finance fallback ────────────────────────────────────
// Twelve Data's free tier doesn't serve index symbols like NDX (NASDAQ-100),
// so we transparently fall back to Yahoo's chart API for those. Yahoo returns
// the same OHLC shape we need — no API key required.
const YAHOO_SYMBOL: Record<string, string> = {
  NDX: "^NDX",
  SPX: "^GSPC",
  DJI: "^DJI",
  IXIC: "^IXIC",
  VIX: "^VIX",
};

function toYahooSymbol(sym: string): string {
  return YAHOO_SYMBOL[sym] ?? sym;
}

// Rotate across Yahoo's two public hosts + a large UA/lang pool. Yahoo
// only serves two real API hosts (query1 / query2), so effective capacity
// comes from (host × UA × Accept-Language) fingerprint variety.
// Pool = 2 hosts × 100 UAs × 50 langs = 10,000 identities, shared with
// yahoo.server.ts / yahoo-quote.server.ts via yahoo-identities.server.ts
// so the hot paths can never drift.
// MAX_YAHOO_ATTEMPTS bounds how many fingerprints a single failing
// request will burn before giving up. 24 is enough to survive rolling
// 429s across both hosts and multiple UA families without wasting the
// pool on a genuinely dead symbol.
import { YAHOO_IDENTITIES, withYahooPace, type YahooIdentity } from "./yahoo-identities.server";
let yahooRR = 0;
const MAX_YAHOO_ATTEMPTS = 64;

async function fetchYahooChart(
  symbol: string,
  range: string,
  interval: string,
): Promise<Bar[]> {
  // Try up to MAX_YAHOO_ATTEMPTS identities in order, starting from the
  // current cursor. First 2xx wins. Cursor advances by 1 so the next call
  // starts on a fresh slot, walking through all 10,000 fingerprints over
  // time instead of hammering the first N.
  const attempts: YahooIdentity[] = [];
  for (let i = 0; i < Math.min(MAX_YAHOO_ATTEMPTS, YAHOO_IDENTITIES.length); i++) {
    attempts.push(YAHOO_IDENTITIES[(yahooRR + i) % YAHOO_IDENTITIES.length]);
  }
  yahooRR = (yahooRR + 1) % YAHOO_IDENTITIES.length;

  let lastErr: unknown = null;
  let res: Response | null = null;
  for (const { host, ua, lang } of attempts) {
    const url = new URL(
      `https://${host}/v8/finance/chart/${encodeURIComponent(toYahooSymbol(symbol))}`,
    );
    url.searchParams.set("range", range);
    url.searchParams.set("interval", interval);
    url.searchParams.set("includePrePost", "false");
    try {
      const r = await withYahooPace(() => fetchWithTimeout(url.toString(), {
          headers: {
            "User-Agent": ua,
            Accept: "application/json,text/plain,*/*",
            "Accept-Language": lang,
            "Cache-Control": "no-cache",
          },
        }));
      if (r.ok) { res = r; break; }
      lastErr = new Error(`Yahoo HTTP ${r.status} for ${symbol} via ${host}`);
      // On 429/503, brief jittered pause before the next identity — this
      // stops us from burning through all 12 in <100ms on a bad minute.
      if (r.status === 429 || r.status === 503) {
        await new Promise((res) => setTimeout(res, 250 + Math.random() * 500));
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (!res) throw lastErr ?? new Error(`Yahoo unreachable for ${symbol}`);
  const j = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: (number | null)[];
            high?: (number | null)[];
            low?: (number | null)[];
            close?: (number | null)[];
            volume?: (number | null)[];
          }>;
        };
      }>;
      error?: { description?: string; code?: string };
    };
  };
  const err = j.chart?.error;
  if (err) throw new Error(`Yahoo error ${err.code}: ${err.description ?? ""}`);
  const r = j.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0];
  if (!q || ts.length === 0) return [];
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    // Format datetime to match Twelve Data ("YYYY-MM-DD" for daily, ISO-ish for intraday).
    const d = new Date(ts[i] * 1000);
    const iso = d.toISOString();
    const datetime =
      interval === "1d"
        ? iso.slice(0, 10)
        : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
    bars.push({
      datetime,
      open: o, high: h, low: l, close: c,
      volume: q.volume?.[i] != null ? (q.volume![i] as number) : undefined,
    });
  }
  // Twelve Data returns newest-first; mirror that so all downstream math (which
  // reads bars[0] as "latest") works identically.
  return bars.reverse();
}

export async function fetchYahooDaily(symbol: string, outputsize = 250): Promise<Bar[]> {
  try {
    const bars = await fetchYahooChart(symbol, "2y", "1d");
    if (bars.length) return bars.slice(0, outputsize);
  } catch {
    /* fall through to independent index fallback */
  }
  // NDX must never disappear from the scan when Yahoo throttles. Nasdaq's
  // official history endpoint returns ascending bars, so reverse to preserve
  // this function's TwelveData-compatible newest-first contract.
  try {
    const { fetchNasdaqIndexDaily } = await import("./nasdaq-index.server");
    const bars = await fetchNasdaqIndexDaily(symbol, outputsize);
    return bars.reverse();
  } catch {
    return [];
  }
}

export async function fetchYahooIntraday(
  symbol: string,
  interval: "5min" | "15min" | "60min" = "5min",
  outputsize = 6000,
): Promise<Bar[]> {
  // Yahoo's caps by interval (empirically):
  //   1m  → last 7 days,  2m/5m/15m/30m → last 60 days,  60m → ~730 days.
  // We ask for the maximum range Yahoo will honor for the chosen interval.
  const yahooInterval =
    interval === "5min" ? "5m" : interval === "15min" ? "15m" : "60m";
  const range = interval === "60min" ? "730d" : "60d";
  const bars = await fetchYahooChart(symbol, range, yahooInterval);
  return bars.slice(0, outputsize);
}

// Symbols that TwelveData's free tier doesn't serve — always route via Yahoo.
const YAHOO_ONLY_SYMBOLS = new Set(["NDX", "SPX", "DJI", "IXIC", "VIX"]);

export function isYahooOnly(sym: string): boolean {
  return YAHOO_ONLY_SYMBOLS.has(sym);
}

// ─── Intraday (5-minute) fetch ─────────────────────────────────
export async function fetchIntradayBatch(
  symbols: string[],
  apiKey: string,
  interval: "5min" | "15min" = "5min",
  outputsize = 90,
): Promise<Record<string, Bar[]>> {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("format", "JSON");

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
  const raw = await res.json();

  // Detect top-level error envelope on batch requests.
  if (symbols.length > 1 && raw && typeof raw === "object" && !Array.isArray(raw)) {
    const top = raw as { code?: number; status?: string; message?: string };
    if (top.status === "error" || (typeof top.code === "number" && top.code >= 400)) {
      if (top.code === 429) throw new Error("RATE_LIMIT");
      throw new Error(top.message || `TwelveData error (code ${top.code ?? "?"})`);
    }
  }
  // Single-symbol responses aren't nested by symbol; also handle 429 there.
  if (symbols.length === 1 && raw && typeof raw === "object") {
    const top = raw as { code?: number; status?: string; message?: string };
    if (top.code === 429) throw new Error("RATE_LIMIT");
  }
  const j: Record<string, {
    status?: string;
    code?: number;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
  }> = symbols.length === 1 ? { [symbols[0]]: raw } : raw;

  const out: Record<string, Bar[]> = {};
  for (const sym of symbols) {
    const entry = j[sym];
    if (!entry || entry.status === "error" || !entry.values) continue;
    out[sym] = entry.values.map((v) => ({
      datetime: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: v.volume ? parseFloat(v.volume) : undefined,
    }));
  }
  return out;
}

// ─── RSI(14) — Wilder ──────────────────────────────────────────
export function rsiWilder(closesAscending: number[], period = 14): number | null {
  if (closesAscending.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closesAscending[i] - closesAscending[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  for (let i = period + 1; i < closesAscending.length; i++) {
    const d = closesAscending[i] - closesAscending[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

// ─── Intraday metrics ──────────────────────────────────────────
export type IntradayMetrics = {
  currentPrice: number;
  sessionOpen: number;
  sessionHigh: number;
  sessionLow: number;
  dropFromOpenPct: number;      // negative = down
  dropFromHighPct: number;      // negative
  bounceFromLowPct: number;     // positive if bouncing off low
  dropSpeedPctPerHour: number;  // signed
  rsi5m: number | null;
  volumeRatioVsAvg: number | null; // today's avg 5m volume / trailing 20-bar avg
  lastCandleGreen: boolean;
  reversalCandle: boolean;      // last bar closes in upper 40% of its range after a red run
  redBarStreak: number;
  minutesElapsed: number;
  asOf: string;
};

// bars: newest-first from Twelve Data.
export function computeIntradayMetrics(barsNewestFirst: Bar[], priorClose: number): IntradayMetrics | null {
  if (!barsNewestFirst.length) return null;
  const barsAsc = [...barsNewestFirst].reverse();

  // Identify today's session — group by date part of datetime.
  const lastDate = barsNewestFirst[0].datetime.slice(0, 10);
  const todayAsc = barsAsc.filter((b) => b.datetime.slice(0, 10) === lastDate);
  if (!todayAsc.length) return null;

  const currentPrice = todayAsc[todayAsc.length - 1].close;
  const sessionOpen = todayAsc[0].open;
  const sessionHigh = Math.max(...todayAsc.map((b) => b.high));
  const sessionLow = Math.min(...todayAsc.map((b) => b.low));
  const dropFromOpenPct = ((currentPrice - sessionOpen) / sessionOpen) * 100;
  const dropFromHighPct = ((currentPrice - sessionHigh) / sessionHigh) * 100;
  const bounceFromLowPct = ((currentPrice - sessionLow) / sessionLow) * 100;

  const minutesElapsed = todayAsc.length * 5;
  const changeFromPriorClosePct = ((currentPrice - priorClose) / priorClose) * 100;
  const hours = Math.max(0.25, minutesElapsed / 60);
  const dropSpeedPctPerHour = changeFromPriorClosePct / hours;

  const closesAsc = barsAsc.map((b) => b.close);
  const rsi5m = rsiWilder(closesAsc, 14);

  // volume ratio: today's mean 5m vol / trailing 20 bars mean vol (excluding today)
  const withVol = barsAsc.filter((b) => typeof b.volume === "number");
  let volumeRatioVsAvg: number | null = null;
  if (withVol.length >= 25) {
    const todayVols = todayAsc.filter((b) => typeof b.volume === "number").map((b) => b.volume as number);
    const priorVols = withVol.filter((b) => b.datetime.slice(0, 10) !== lastDate).slice(-40).map((b) => b.volume as number);
    if (todayVols.length && priorVols.length) {
      const mt = todayVols.reduce((a, b) => a + b, 0) / todayVols.length;
      const mp = priorVols.reduce((a, b) => a + b, 0) / priorVols.length;
      if (mp > 0) volumeRatioVsAvg = mt / mp;
    }
  }

  const last = todayAsc[todayAsc.length - 1];
  const lastCandleGreen = last.close > last.open;
  const range = Math.max(1e-9, last.high - last.low);
  const closePos = (last.close - last.low) / range;
  // count red bars going backwards through today
  let redBarStreak = 0;
  for (let i = todayAsc.length - 1; i >= 0; i--) {
    if (todayAsc[i].close < todayAsc[i].open) redBarStreak++;
    else break;
  }
  // Reversal: prior 2+ bars red, current bar closes in upper 40% of range
  const priorTwoRed = todayAsc.length >= 3 &&
    todayAsc[todayAsc.length - 2].close < todayAsc[todayAsc.length - 2].open &&
    todayAsc[todayAsc.length - 3].close < todayAsc[todayAsc.length - 3].open;
  const reversalCandle = priorTwoRed && closePos >= 0.6;

  return {
    currentPrice, sessionOpen, sessionHigh, sessionLow,
    dropFromOpenPct, dropFromHighPct, bounceFromLowPct, dropSpeedPctPerHour,
    rsi5m, volumeRatioVsAvg, lastCandleGreen, reversalCandle, redBarStreak,
    minutesElapsed, asOf: last.datetime,
  };
}

// ─── Regime classification & adaptive ladder ───────────────────
export type Regime =
  | "NO_DIP"
  | "FAKE_OUT"
  | "FAST_CRASH"
  | "SLOW_BLEED"
  | "V_BOUNCE_LIKELY"
  | "SUPPORT_TEST";

export type SignalStatus = "WATCH" | "PROBE" | "BUY_STARTER" | "BUY_LADDER";

export type Rung = { pct: number; price: number; label: string; reason: string };

export type DecisionStep = { label: string; done: boolean };

export type RegimeAnalysis = {
  regime: Regime;
  regimeLabel: string;
  regimeExplanation: string;
  confidence: number;
  status: SignalStatus;
  statusReason: string;
  watchingFor: string[];
  rsiDaily: number | null;
  ladder: Rung[];
  spyContext?: { changePct: number; weak: boolean };
};

// Scored evaluation of every regime. The highest score wins; the second-highest
// above threshold is exposed as a "secondary" characteristic so the UI can
// reflect that markets often show multiple regime traits at once.
export function classifyRegime(args: {
  snapshot: Snapshot;
  intraday: IntradayMetrics | null;
  rsiDaily: number | null;
  spyChangePct: number | null;
  drawdown20Pct: number;
  drawdown60Pct: number;
  distSma50Pct: number;
  distSma200Pct: number;
}): {
  regime: Regime;
  secondaryRegime: Regime | null;
  confidence: number;
  reasons: string[];
  scores: Record<Regime, number>;
} {
  const { snapshot: s, intraday: id, rsiDaily, spyChangePct } = args;
  const spyWeak = spyChangePct !== null && spyChangePct < -0.5;

  // A ≤ −1.2% daily move is the minimum we call a "dip". Intraday selling
  // from the open can add severity, but it cannot turn a green/flat daily
  // tape into a dip. That was the root false-positive path: a name could be
  // up on the day, sell off from a high open, and still rank as "best dip".
  const dailyDown = s.change1d <= -1.2;
  const isActuallyFalling = dailyDown;
  // Recent strength no longer forces NO_DIP — it just softens confidence later.
  const recentlyUp =
    (s.change5d > 3 && s.change1d > -2) ||
    (s.change3d > 2 && s.change1d > -2);

  const scores: Record<Regime, number> = {
    NO_DIP: 0, FAKE_OUT: 0, FAST_CRASH: 0, SLOW_BLEED: 0, V_BOUNCE_LIKELY: 0, SUPPORT_TEST: 0,
  };
  const reasonsBy: Record<Regime, string[]> = {
    NO_DIP: [], FAKE_OUT: [], FAST_CRASH: [], SLOW_BLEED: [], V_BOUNCE_LIKELY: [], SUPPORT_TEST: [],
  };

  // Hard green/flat-day guard: a name that is green or effectively flat on
  // the day is NOT a dip, even if it sold off from the session open/high.
  const greenDay = s.change1d >= -0.05;
  if (greenDay) {
    return {
      regime: "NO_DIP",
      secondaryRegime: null,
      confidence: 92,
      reasons: [
        s.change1d >= 0
          ? `Up ${s.change1d.toFixed(2)}% today — not a dip`
          : `Flat today (${s.change1d.toFixed(2)}%) — not a dip`,
      ],
      scores: { ...scores, NO_DIP: 92 },
    };
  }

  if (!isActuallyFalling) {
    return {
      regime: "NO_DIP",
      secondaryRegime: null,
      confidence: 90,
      reasons: ["Not falling meaningfully today"],
      scores: { ...scores, NO_DIP: 90 },
    };
  }


  // SUPPORT_TEST — hugging a major SMA
  if (Math.abs(args.distSma200Pct) <= 2) {
    scores.SUPPORT_TEST += 55; reasonsBy.SUPPORT_TEST.push(`At 200-SMA (${args.distSma200Pct.toFixed(2)}%)`);
  } else if (args.distSma200Pct < 0 && args.distSma200Pct > -4) {
    scores.SUPPORT_TEST += 35; reasonsBy.SUPPORT_TEST.push(`Below 200-SMA (${args.distSma200Pct.toFixed(2)}%)`);
  }
  if (Math.abs(args.distSma50Pct) <= 1.5) {
    scores.SUPPORT_TEST += 25; reasonsBy.SUPPORT_TEST.push(`At 50-SMA (${args.distSma50Pct.toFixed(2)}%)`);
  }
  if (rsiDaily !== null && rsiDaily < 35) {
    scores.SUPPORT_TEST += 10; reasonsBy.SUPPORT_TEST.push(`Daily RSI ${rsiDaily.toFixed(0)}`);
  }

  // FAST_CRASH — steep intraday drop + volume/broad-market weakness
  if (id) {
    if (id.dropSpeedPctPerHour < -0.6 && s.change1d < -1.5) {
      scores.FAST_CRASH += 45; reasonsBy.FAST_CRASH.push(`Drop speed ${id.dropSpeedPctPerHour.toFixed(2)}%/hr`);
    } else if (id.dropSpeedPctPerHour < -0.3 && s.change1d < -1.0) {
      scores.FAST_CRASH += 25; reasonsBy.FAST_CRASH.push(`Accelerating (${id.dropSpeedPctPerHour.toFixed(2)}%/hr)`);
    }
    if (id.volumeRatioVsAvg !== null && id.volumeRatioVsAvg > 1.4) {
      scores.FAST_CRASH += 20; reasonsBy.FAST_CRASH.push(`Volume ${id.volumeRatioVsAvg.toFixed(1)}× avg`);
    }
    if (spyWeak) { scores.FAST_CRASH += 15; reasonsBy.FAST_CRASH.push(`SPY weak (${spyChangePct!.toFixed(2)}%)`); }
    if (id.dropFromOpenPct < -2) { scores.FAST_CRASH += 10; reasonsBy.FAST_CRASH.push(`${id.dropFromOpenPct.toFixed(2)}% from open`); }
  }

  // V_BOUNCE_LIKELY — oversold + reversal off session low
  if (id) {
    const oversold5m = id.rsi5m !== null && id.rsi5m < 30;
    const oversoldDaily = rsiDaily !== null && rsiDaily < 35;
    if (oversold5m) { scores.V_BOUNCE_LIKELY += 30; reasonsBy.V_BOUNCE_LIKELY.push(`5m RSI ${id.rsi5m!.toFixed(0)}`); }
    if (oversoldDaily) { scores.V_BOUNCE_LIKELY += 15; reasonsBy.V_BOUNCE_LIKELY.push(`Daily RSI ${rsiDaily!.toFixed(0)}`); }
    if (id.bounceFromLowPct > 0.4) { scores.V_BOUNCE_LIKELY += 20; reasonsBy.V_BOUNCE_LIKELY.push(`Bouncing ${id.bounceFromLowPct.toFixed(2)}% off low`); }
    if (id.reversalCandle) { scores.V_BOUNCE_LIKELY += 20; reasonsBy.V_BOUNCE_LIKELY.push("Reversal candle"); }
    if (id.lastCandleGreen && id.bounceFromLowPct > 0.2) { scores.V_BOUNCE_LIKELY += 10; reasonsBy.V_BOUNCE_LIKELY.push("Green bar off low"); }
  }

  // SLOW_BLEED — real multi-day weakness, muted intraday speed
  if (s.change5d < -2 && s.change1d < -0.3) {
    scores.SLOW_BLEED += 35; reasonsBy.SLOW_BLEED.push(`5d change ${s.change5d.toFixed(2)}%`);
    if (!id || Math.abs(id.dropSpeedPctPerHour) < 0.5) {
      scores.SLOW_BLEED += 20; reasonsBy.SLOW_BLEED.push("Muted intraday speed");
    }
    if (s.change3d < -1.5) { scores.SLOW_BLEED += 10; reasonsBy.SLOW_BLEED.push(`3d change ${s.change3d.toFixed(2)}%`); }
  }

  // FAKE_OUT — intraday drop already reversing hard, no broad weakness
  if (id && id.bounceFromLowPct > 0.6 && !spyWeak && s.change1d > -1.5) {
    scores.FAKE_OUT += 40; reasonsBy.FAKE_OUT.push(`Bounced ${id.bounceFromLowPct.toFixed(2)}% off low`);
    if (id.lastCandleGreen) { scores.FAKE_OUT += 15; reasonsBy.FAKE_OUT.push("Last bar green"); }
  }

  // Pick primary + secondary
  const entries = (Object.entries(scores) as [Regime, number][])
    .filter(([r]) => r !== "NO_DIP")
    .sort((a, b) => b[1] - a[1]);
  const [top, second] = entries;
  const primary = top && top[1] >= 20 ? top[0] : "NO_DIP";
  const secondary = second && second[1] >= 30 && second[0] !== primary ? second[0] : null;
  const rawConfidence = primary === "NO_DIP" ? 55 : Math.min(95, 40 + top[1] * 0.6);
  const strengthPenalty = recentlyUp ? 0.75 : 1.0;
  const confidence = Math.round(rawConfidence * strengthPenalty);
  const reasons = primary === "NO_DIP"
    ? ["Weak but not a clean setup"]
    : recentlyUp
      ? [...reasonsBy[primary], `Recent rally (5d ${s.change5d.toFixed(1)}%) reduces confidence`]
      : reasonsBy[primary];

  return {
    regime: primary,
    secondaryRegime: secondary,
    confidence,
    reasons,
    scores,
  };
}


export const REGIME_META: Record<Regime, { label: string; explanation: string }> = {
  NO_DIP: { label: "No Dip", explanation: "Tape is flat or green — no qualifying setup. Sit on hands." },
  FAKE_OUT: { label: "Fake-Out Risk", explanation: "Intraday drop already reversing. Small starter only; reserve most capital for a real breakdown." },
  FAST_CRASH: { label: "Fast Crash", explanation: "Steep, high-volume flush. These usually snap back in 1–3 days. Deploy fast." },
  SLOW_BLEED: { label: "Slow Bleed", explanation: "Grinding multi-day drift lower. Space bids widely — this can last several sessions." },
  V_BOUNCE_LIKELY: { label: "V-Bounce Likely", explanation: "Oversold and reversing off session low. Front-load if you want to catch it." },
  SUPPORT_TEST: { label: "Major Support Test", explanation: "Price at a well-defended level (200-SMA / macro floor). Big buyers historically step in here." },
};

// Build the base (unmodified) ladder for a regime. `atrMult` widens all
// ATR-derived rung spacing (used by the gap-down guard).
// Backtested per-regime parameters live in ladder-params.json. See
// LADDER_PARAMS_REPORT.md for methodology. If the file is missing or
// malformed we fall back to the previous hardcoded literals — a bad
// publish can never brick the app.
import ladderParams from "./ladder-params.json";

type RungSpec = {
  pct: number;
  atrOffset?: number;
  anchor?: "sma50" | "sma200" | "auto";
  anchorOffsetAtr?: number;
  label: string;
  reason: string;
};

type LadderParamsShape = {
  regimes: Partial<Record<Regime, { rungs: RungSpec[] }>>;
};

function resolveRung(spec: RungSpec, s: Snapshot, cur: number, atr: number): Rung {
  const r = (n: number) => Math.round(n * 100) / 100;
  let anchorPrice: number | null = null;
  if (spec.anchor === "sma50") anchorPrice = s.sma50;
  else if (spec.anchor === "sma200") anchorPrice = s.sma200;
  else if (spec.anchor === "auto") {
    const dTo50 = Math.abs(cur - s.sma50);
    const dTo200 = Math.abs(cur - s.sma200);
    anchorPrice = dTo200 < dTo50 ? s.sma200 : s.sma50;
  }
  let price: number;
  let label = spec.label;
  if (anchorPrice !== null) {
    const off = spec.anchorOffsetAtr ?? 0;
    price = r(anchorPrice + off * atr);
    if (spec.anchor === "auto") {
      const dTo50 = Math.abs(cur - s.sma50);
      const dTo200 = Math.abs(cur - s.sma200);
      const which = dTo200 < dTo50 ? "200" : "50";
      if (spec.label === "MA anchor") label = `${which}-SMA anchor`;
    }
  } else {
    const off = spec.atrOffset ?? 0;
    price = r(cur + off * atr);
  }
  return { pct: spec.pct, price, label, reason: spec.reason };
}

function baseLadder(
  regime: Regime,
  s: Snapshot,
  id: IntradayMetrics | null,
  atrMult = 1,
): Rung[] {
  const atr = s.atr14 * atrMult;
  const cur = id?.currentPrice ?? s.price;
  const params = ladderParams as LadderParamsShape;
  const entry = params.regimes?.[regime];
  if (!entry || !Array.isArray(entry.rungs) || entry.rungs.length === 0) return [];
  return entry.rungs.map((spec) => resolveRung(spec, s, cur, atr));
}

// When status is PROBE, prepend a 10% probe rung and scale the base ladder to
// the remaining 90%. When BUY_STARTER (confirmation achieved), if a probe
// would already have fired, the probe is shown separately and the remaining
// ladder assumes the probe is already deployed.
export function buildAdaptiveLadder(
  regime: Regime,
  s: Snapshot,
  id: IntradayMetrics | null,
  status: SignalStatus = "WATCH",
  opts?: { gapAdjusted?: boolean; earningsBlocked?: boolean },
): Rung[] {
  // Earnings within the guard window → no ladder. UI shows a manual-only notice.
  if (opts?.earningsBlocked) return [];

  const gap = opts?.gapAdjusted === true;
  const base = baseLadder(regime, s, id, gap ? 1.5 : 1);
  if (gap && base.length > 0) {
    // Cap the "now" rung so we don't blow all-in at the top of an
    // overnight-shock gap where ATR-14 understates realized volatility.
    // Redistribute the excess across the remaining rungs proportionally.
    const first = base[0];
    const cap = 0.25;
    if (first.pct > cap) {
      const excess = first.pct - cap;
      const restSum = base.slice(1).reduce((a, b) => a + b.pct, 0);
      const scaled: Rung[] = [
        {
          ...first,
          pct: cap,
          label: `${first.label} (gap-adjusted)`,
          reason: "Overnight gap-down > 1.5×ATR — capping starter size until spacing verifies",
        },
        ...base.slice(1).map((rung) => ({
          ...rung,
          pct: restSum > 0 ? Math.round((rung.pct + excess * (rung.pct / restSum)) * 1000) / 1000 : rung.pct,
        })),
      ];
      return applyStatusOverlay(scaled, id, s, status);
    }
  }
  return applyStatusOverlay(base, id, s, status);
}

function applyStatusOverlay(
  base: Rung[],
  id: IntradayMetrics | null,
  s: Snapshot,
  status: SignalStatus,
): Rung[] {
  if (!base.length) return base;
  if (status !== "PROBE" && status !== "BUY_STARTER" && status !== "BUY_LADDER") return base;
  if (!base.length) return base;

  const r = (n: number) => Math.round(n * 100) / 100;
  const cur = id?.currentPrice ?? s.price;
  const probePct = 0.1;

  if (status === "PROBE") {
    const scaled = base.map((rung) => ({ ...rung, pct: Math.round(rung.pct * 0.9 * 1000) / 1000 }));
    return [
      {
        pct: probePct,
        price: r(cur),
        label: "Probe (now)",
        reason: "Meaningful dip detected — small toe-hold while waiting for confirmation",
      },
      ...scaled,
    ];
  }
  // BUY_STARTER / BUY_LADDER after probe: annotate probe as already-filled context.
  const scaled = base.map((rung) => ({ ...rung, pct: Math.round(rung.pct * 0.9 * 1000) / 1000 }));
  return [
    {
      pct: probePct,
      price: r(cur),
      label: "Probe (assumed filled)",
      reason: "If a probe was placed earlier, count it toward this allocation",
    },
    ...scaled,
  ];
}

// Extended shared types (single decision engine surface)
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type MarketContext = "STRONG" | "NEUTRAL" | "WEAK" | "BROAD_SELLOFF";
export type FactorList = { positive: string[]; negative: string[] };
export type ScenarioKey = "HEAVY_SUPPORT" | "BASELINE_FLUSH" | "SLOW_BLEED" | "V_BOUNCE" | "WAITING";

// New signal engine: WATCH → PROBE → BUY_STARTER → BUY_LADDER.
// `analog` is an optional evidence digest from the Historical Pattern
// Recognition scanner — when present with meaningful confidence it can shift
// setupQuality by up to ±20 pts and executionConfidence by up to ±15 pts,
// and always contributes transparent factors to setupFactors/executionFactors.
export function evaluateSignal(args: {
  regime: Regime;
  snapshot: Snapshot;
  intraday: IntradayMetrics | null;
  rsiDaily: number | null;
  distSma200Pct: number;
  distSma50Pct: number;
  drawdown20Pct: number;
  drawdown60Pct: number;
  regimeConfidence: number;
  spyChangePct: number | null;
  analog?: import("./analog-search.functions").AnalogEvidence | null;
}): {
  status: SignalStatus;
  reason: string;
  watchingFor: string[];
  setupQuality: number;
  executionConfidence: number;
  decisionPath: DecisionStep[];
  setupFactors: FactorList;
  executionFactors: FactorList;
} {
  const {
    regime, snapshot: s, intraday: id, rsiDaily,
    distSma200Pct, distSma50Pct, regimeConfidence, spyChangePct, analog,
  } = args;


  // ─── Setup quality with factor breakdown ───
  const setupFactors: FactorList = { positive: [], negative: [] };
  let setup = 0;
  if (regime !== "NO_DIP") {
    const add = Math.min(60, regimeConfidence * 0.6);
    setup += add;
    setupFactors.positive.push(`${REGIME_META[regime].label} regime (${Math.round(add)} pts)`);
  }
  if (Math.abs(distSma200Pct) <= 2) {
    setup += 15;
    setupFactors.positive.push(`At 200-SMA (${distSma200Pct.toFixed(2)}%)`);
  } else if (distSma200Pct < 0 && distSma200Pct > -6) {
    setup += 8;
    setupFactors.positive.push(`Below 200-SMA (${distSma200Pct.toFixed(2)}%)`);
  } else if (distSma200Pct > 6) {
    setupFactors.negative.push(`Far above 200-SMA (+${distSma200Pct.toFixed(1)}%) — no support nearby`);
  }
  if (Math.abs(distSma50Pct) <= 1.5) {
    setupFactors.positive.push(`At 50-SMA (${distSma50Pct.toFixed(2)}%)`);
  }
  if (rsiDaily !== null && rsiDaily < 32) {
    setup += 15;
    setupFactors.positive.push(`Daily RSI oversold (${rsiDaily.toFixed(0)})`);
  } else if (rsiDaily !== null && rsiDaily < 40) {
    setup += 6;
    setupFactors.positive.push(`Daily RSI weak (${rsiDaily.toFixed(0)})`);
  } else if (rsiDaily !== null && rsiDaily > 65) {
    setupFactors.negative.push(`Daily RSI still elevated (${rsiDaily.toFixed(0)})`);
  }
  if (s.change5d < -5) {
    setup += 10;
    setupFactors.positive.push(`5d flush ${s.change5d.toFixed(1)}%`);
  } else if (s.change5d > 3) {
    setupFactors.negative.push(`Recent 5d rally (+${s.change5d.toFixed(1)}%)`);
  }
  if (spyChangePct !== null && spyChangePct < -0.5) {
    setupFactors.negative.push(`Broad market weak (SPY ${spyChangePct.toFixed(2)}%)`);
  } else if (spyChangePct !== null && spyChangePct > 0.3) {
    setupFactors.positive.push(`Broad market steady (SPY +${spyChangePct.toFixed(2)}%)`);
  }
  // ─── Historical analog contribution (setup side) ───
  // Only apply when we have enough historical confidence to be meaningful.
  // Contribution is bounded (±20 setup pts) so it informs but never dominates
  // live-tape signals. Factors are pushed for transparency in the UI.
  let analogSetupDelta = 0;
  if (analog && analog.confidence >= 45 && analog.sampleSize >= 3) {
    const strongEvidence = analog.confidence >= 60 && analog.agreement >= 0.45;
    const label = `analog · ${analog.bestDate.slice(0, 10)}${analog.isSameSymbol ? "" : ` (${analog.bestSymbol})`} · ${analog.similarity}% match · ${analog.sampleSize} cases`;
    if (analog.favorability === "favorable") {
      const pts = strongEvidence ? 15 : 8;
      analogSetupDelta += pts;
      setupFactors.positive.push(`Favorable history: ${label} — ${Math.round(analog.probReversal * 100)}% reversal rate${analog.meanFwd90 !== null ? `, mean 90d ${analog.meanFwd90 >= 0 ? "+" : ""}${analog.meanFwd90.toFixed(1)}%` : ""} (+${pts} pts)`);
    } else if (analog.favorability === "unfavorable") {
      const pts = strongEvidence ? 15 : 8;
      analogSetupDelta -= pts;
      setupFactors.negative.push(`Unfavorable history: ${label} — ${Math.round(analog.probContinuedDecline * 100)}% kept declining${analog.expectedRemainingDownsidePct < -0.5 ? `, est. ${analog.expectedRemainingDownsidePct.toFixed(1)}% more downside` : ""} (−${pts} pts)`);
    } else {
      setupFactors.positive.push(`Mixed history: ${label} — analogs disagree (${Math.round(analog.probReversal * 100)}% reversal / ${Math.round(analog.probContinuedDecline * 100)}% decline)`);
    }
    if (analog.failureRate >= 0.4) {
      const pts = Math.min(8, Math.round(analog.failureRate * 15));
      analogSetupDelta -= pts;
      setupFactors.negative.push(`${Math.round(analog.failureRate * 100)}% of analogs failed inside 90d (−${pts} pts)`);
    }
    if (analog.agreement < 0.35 && analog.sampleSize >= 4) {
      setupFactors.negative.push(`Analog disagreement is wide — treat projections as ranges`);
    }
  }
  setup = Math.max(0, Math.min(100, Math.round(setup + analogSetupDelta)));



  // ─── Confirmation triggers ───
  const executionFactors: FactorList = { positive: [], negative: [] };
  const triggers: string[] = [];
  const watching: string[] = [];
  const rsi5mUp = id && id.rsi5m !== null && id.rsi5m > 30 && id.rsi5m < 45 && id.lastCandleGreen;
  const rsiTurning = id && id.rsi5m !== null && id.rsi5m < 30;
  const reversal = id?.reversalCandle;
  const bouncing = id && id.bounceFromLowPct > 0.4;
  const atSupport = Math.abs(distSma200Pct) <= 2;
  const dailyOversold = rsiDaily !== null && rsiDaily < 32;

  if (reversal) {
    triggers.push("Reversal candle formed");
    executionFactors.positive.push("Reversal candle formed");
  } else {
    watching.push("Reversal candle (2 red bars → green close in upper 40% of range)");
    executionFactors.negative.push("No reversal candle yet");
  }
  if (rsi5mUp) {
    triggers.push(`5m RSI turning up (${id!.rsi5m!.toFixed(0)})`);
    executionFactors.positive.push(`5m RSI turning up (${id!.rsi5m!.toFixed(0)})`);
  } else if (rsiTurning) {
    watching.push(`5m RSI to cross back above 30 (now ${id!.rsi5m!.toFixed(0)})`);
    executionFactors.negative.push(`5m RSI still falling (${id!.rsi5m!.toFixed(0)})`);
  } else {
    watching.push("5m RSI to drop below 30, then curl up");
  }
  if (bouncing) {
    triggers.push(`Bouncing ${id!.bounceFromLowPct.toFixed(2)}% off session low`);
    executionFactors.positive.push(`Bouncing ${id!.bounceFromLowPct.toFixed(2)}% off session low`);
  } else if (id) {
    watching.push("Price to hold above session low for 2 bars");
    executionFactors.negative.push("No bounce from session low yet");
  }
  if (atSupport) {
    triggers.push("At major support (200-SMA)");
    executionFactors.positive.push("At 200-SMA support");
  }
  if (dailyOversold) {
    triggers.push(`Daily RSI oversold (${rsiDaily!.toFixed(0)})`);
    executionFactors.positive.push(`Daily RSI oversold (${rsiDaily!.toFixed(0)})`);
  }

  const needed =
    regime === "FAST_CRASH" || regime === "SUPPORT_TEST" ? 1 :
    regime === "V_BOUNCE_LIKELY" ? 1 : 2;

  // ─── Probe eligibility ───
  const dailyBig = s.change1d <= -2;
  const intradayBig = !!(id && id.dropFromOpenPct <= -2);
  const oneAtrDrop = !!(id && s.atr14 > 0 && (id.sessionOpen - id.currentPrice) >= s.atr14);
  const dailyDown = s.change1d <= -1.2;
  const meaningfulDip = (dailyBig || (dailyDown && (intradayBig || oneAtrDrop))) && regime !== "NO_DIP";

  // ─── Decision path ───
  const decisionPath: DecisionStep[] = [
    { label: "Real dip detected", done: regime !== "NO_DIP" && dailyDown },
    { label: `${REGIME_META[regime].label} regime`, done: regime !== "NO_DIP" },
    { label: "Meaningful dip → probe eligible", done: meaningfulDip },
    { label: "Probe initiated", done: meaningfulDip },
    { label: "Confirmation achieved", done: triggers.length >= needed },
    { label: "BUY STARTER (deploy remaining capital)", done: triggers.length >= needed },
  ];

  let execution = Math.min(100, Math.round(20 + triggers.length * 25 + (bouncing ? 10 : 0) + (reversal ? 10 : 0)));

  // ─── Historical analog contribution (execution side) ───
  // Bottom-in evidence adds confirmation weight; failure/continued-decline
  // evidence pulls it down. Bounded to ±15 pts.
  if (analog && analog.confidence >= 45 && analog.sampleSize >= 3) {
    let d = 0;
    if (analog.probBottomIn >= 0.6) {
      const pts = analog.probBottomIn >= 0.75 ? 12 : 8;
      d += pts;
      executionFactors.positive.push(`History: ${Math.round(analog.probBottomIn * 100)}% of analogs had already bottomed here (+${pts} pts)`);
    }
    if (analog.probReversal >= 0.6 && analog.confidence >= 55) {
      d += 5;
      executionFactors.positive.push(`History: ${Math.round(analog.probReversal * 100)}% reversal rate (+5 pts)`);
    }
    if (analog.probContinuedDecline >= 0.55 && analog.confidence >= 55) {
      d -= 8;
      executionFactors.negative.push(`History: ${Math.round(analog.probContinuedDecline * 100)}% kept declining after similar setups (−8 pts)`);
    }
    if (analog.failureRate >= 0.5) {
      d -= 7;
      executionFactors.negative.push(`History: ${Math.round(analog.failureRate * 100)}% of analogs failed within 90d (−7 pts)`);
    }
    d = Math.max(-15, Math.min(15, d));
    execution = Math.max(0, Math.min(100, execution + d));
  }


  if (regime === "NO_DIP") {
    return {
      status: "WATCH",
      reason: "No qualifying setup — tape is flat or green.",
      watchingFor: ["Meaningful intraday drop (>1%)", "Break below 20-day support", "Daily RSI < 40"],
      setupQuality: setup,
      executionConfidence: 15,
      decisionPath,
      setupFactors,
      executionFactors,
    };
  }

  if (triggers.length >= needed) {
    return {
      status: "BUY_STARTER",
      reason: `Confirmation met (${triggers.length}/${needed}): ${triggers.join("; ")}. If a probe was placed, deploy the remaining allocation now.`,
      watchingFor: watching,
      setupQuality: setup,
      executionConfidence: execution,
      decisionPath,
      setupFactors,
      executionFactors,
    };
  }

  if (meaningfulDip) {
    const why: string[] = [];
    if (dailyBig) why.push(`daily −${Math.abs(s.change1d).toFixed(2)}%`);
    if (intradayBig) why.push(`intraday −${Math.abs(id!.dropFromOpenPct).toFixed(2)}% from open`);
    if (oneAtrDrop) why.push("≥1 ATR intraday drop");
    return {
      status: "PROBE",
      reason: `Meaningful dip (${why.join(", ")}). Deploy a small 10% probe now; wait for ${needed - triggers.length} more confirmation${needed - triggers.length > 1 ? "s" : ""} before the starter.`,
      watchingFor: watching,
      setupQuality: setup,
      executionConfidence: execution,
      decisionPath,
      setupFactors,
      executionFactors,
    };
  }

  return {
    status: "WATCH",
    reason: `Dip forming but not yet meaningful — only ${triggers.length}/${needed} confirmations. Lower limit orders are safe; hold off on the probe.`,
    watchingFor: watching.length ? watching : ["Additional confirmation"],
    setupQuality: setup,
    executionConfidence: execution,
    decisionPath,
    setupFactors,
    executionFactors,
  };
}

// ─── Risk level ─────────────────────────────────────────────────
export function assessRisk(args: {
  regime: Regime;
  snapshot: Snapshot;
  intraday: IntradayMetrics | null;
  spyChangePct: number | null;
  distSma200Pct: number;
  analog?: import("./analog-search.functions").AnalogEvidence | null;
}): { level: RiskLevel; reasons: string[] } {
  const { regime, snapshot: s, intraday: id, spyChangePct, distSma200Pct, analog } = args;
  const reasons: string[] = [];
  let score = 0; // higher = riskier

  if (regime === "FAST_CRASH") { score += 2; reasons.push("Fast crash in progress"); }
  if (regime === "SLOW_BLEED") { score += 1; reasons.push("Persistent multi-day weakness"); }
  if (regime === "SUPPORT_TEST") { score -= 1; reasons.push("At known support level"); }
  if (regime === "V_BOUNCE_LIKELY") { score -= 1; reasons.push("Reversal already underway"); }

  if (id) {
    if (id.dropSpeedPctPerHour < -0.6) { score += 2; reasons.push(`Selling speed ${id.dropSpeedPctPerHour.toFixed(2)}%/hr`); }
    else if (id.dropSpeedPctPerHour < -0.3) { score += 1; reasons.push("Selling accelerating"); }
    if (id.volumeRatioVsAvg !== null && id.volumeRatioVsAvg > 1.5) { score += 1; reasons.push(`Volume ${id.volumeRatioVsAvg.toFixed(1)}× avg`); }
    if (id.bounceFromLowPct < 0.15 && id.dropFromHighPct < -1) { score += 1; reasons.push("No bounce from lows"); }
    if (id.reversalCandle || id.bounceFromLowPct > 0.6) { score -= 1; reasons.push("Buyers appearing intraday"); }
  }

  if (spyChangePct !== null && spyChangePct < -1) { score += 2; reasons.push(`Broad selloff (SPY ${spyChangePct.toFixed(2)}%)`); }
  else if (spyChangePct !== null && spyChangePct < -0.5) { score += 1; reasons.push("Market weak"); }

  if (distSma200Pct < -8) { score += 1; reasons.push(`${distSma200Pct.toFixed(1)}% below 200-SMA (no floor)`); }

  const atrPct = s.atr14 > 0 ? (s.atr14 / s.price) * 100 : 0;
  if (atrPct > 3) { score += 1; reasons.push(`High volatility (ATR ${atrPct.toFixed(1)}%)`); }

  // Historical-analog risk contribution — only when confidence is meaningful.
  if (analog && analog.confidence >= 45 && analog.sampleSize >= 3) {
    if (analog.failureRate >= 0.5) {
      score += 2;
      reasons.push(`History: ${Math.round(analog.failureRate * 100)}% analog failure rate`);
    } else if (analog.failureRate >= 0.3) {
      score += 1;
      reasons.push(`History: ${Math.round(analog.failureRate * 100)}% analogs failed`);
    }
    if (analog.probContinuedDecline >= 0.55 && analog.confidence >= 55) {
      score += 1;
      reasons.push(`History: ${Math.round(analog.probContinuedDecline * 100)}% kept declining`);
    }
    if (analog.expectedRemainingDownsidePct <= -6) {
      score += 1;
      reasons.push(`History: est. ${analog.expectedRemainingDownsidePct.toFixed(1)}% more downside`);
    }
    if (analog.probBottomIn >= 0.65 && analog.confidence >= 55) {
      score -= 1;
      reasons.push(`History: ${Math.round(analog.probBottomIn * 100)}% of analogs had bottomed`);
    }
    if (analog.probReversal >= 0.65 && analog.confidence >= 55 && analog.recoveryRate >= 0.6) {
      score -= 1;
      reasons.push(`History: strong reversal pattern (${Math.round(analog.recoveryRate * 100)}% recovered)`);
    }
  }

  const level: RiskLevel = score >= 3 ? "HIGH" : score <= 0 ? "LOW" : "MEDIUM";
  return { level, reasons: reasons.slice(0, 5) };
}



// ─── Market context ─────────────────────────────────────────────
export function assessMarketContext(args: {
  spyChangePct: number | null;
  symbolChange1d: number;
}): { context: MarketContext; note: string } {
  const { spyChangePct, symbolChange1d } = args;
  if (spyChangePct === null) return { context: "NEUTRAL", note: "Broad-market data unavailable." };

  if (spyChangePct < -1) {
    return {
      context: "BROAD_SELLOFF",
      note: `SPY ${spyChangePct.toFixed(2)}% — broad selloff. Weakness is market-wide, not isolated.`,
    };
  }
  if (spyChangePct < -0.3) {
    return {
      context: "WEAK",
      note: symbolChange1d < spyChangePct - 0.5
        ? `SPY ${spyChangePct.toFixed(2)}% — market soft, and this name is underperforming.`
        : `SPY ${spyChangePct.toFixed(2)}% — market is soft.`,
    };
  }
  if (spyChangePct > 0.3) {
    return {
      context: "STRONG",
      note: symbolChange1d < -0.5
        ? `SPY +${spyChangePct.toFixed(2)}% — this name's weakness is isolated from the broader market.`
        : `SPY +${spyChangePct.toFixed(2)}% — broad market steady.`,
    };
  }
  return { context: "NEUTRAL", note: `SPY ${spyChangePct >= 0 ? "+" : ""}${spyChangePct.toFixed(2)}% — mixed tape.` };
}

// ─── Scenario mapping (regime → user-facing playbook) ───────────
export const SCENARIO_META: Record<ScenarioKey, { title: string; why: string }> = {
  HEAVY_SUPPORT: {
    title: "Heavy Support Test",
    why: "Price has fallen into a well-known support level (200-SMA or macro floor) where big buyers historically defend. Load the largest tranche at the anchor.",
  },
  BASELINE_FLUSH: {
    title: "Baseline Flush",
    why: "A fast intraday drop that looks like an algorithmic stop-run, not a real breakdown. Deploy quickly with bids stacked close together to catch the bounce.",
  },
  SLOW_BLEED: {
    title: "Slow Bleed",
    why: "Low-volume grind lower. No panic — just steady weakness. Space bids widely so you only fill on real breakdown.",
  },
  V_BOUNCE: {
    title: "V-Bounce Setup",
    why: "Oversold and already reversing off the session low. Front-load if you want to catch the snap-back.",
  },
  WAITING: {
    title: "Waiting for Pullback",
    why: "Nothing meaningful is falling right now. The best trade is patience.",
  },
};

export function regimeToScenario(regime: Regime, change5d: number, distSma200Pct: number): ScenarioKey {
  if (regime === "NO_DIP") return "WAITING";
  if (regime === "SUPPORT_TEST" || Math.abs(distSma200Pct) <= 2 || change5d <= -5) return "HEAVY_SUPPORT";
  if (regime === "SLOW_BLEED") return "SLOW_BLEED";
  if (regime === "V_BOUNCE_LIKELY") return "V_BOUNCE";
  return "BASELINE_FLUSH";
}



