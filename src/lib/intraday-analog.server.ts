// Intraday historical-analog projection.
//
// For a given symbol we pull ~65 trading days of 5-minute bars, extract
// today's "morning shape so far" (gap, cumulative return, range, volume,
// momentum, position in day range), then search prior sessions for the
// closest matching morning shapes. The remainder of each matched day
// (from the same minutes-from-open to the 4pm close) is aligned to
// today's current price and aggregated to a median path plus p25/p75
// band. No forecasting — every projected point is the empirical median
// of what real historical days did next from the same shape.

import type { Bar } from "./market.server";
import { fetchIntradayBatch, fetchYahooIntraday } from "./market.server";
import { withAnalogKey, hasAnalogKey } from "./twelvedata-analog-keys.server";
import { withRotatingKey, hasAnyKey } from "./twelvedata-keys.server";

// ── Types ──

export type IntradayProjectionPoint = {
  minutesFromOpen: number;
  medianPct: number;
  p25Pct: number;
  p75Pct: number;
  medianPrice: number;
  p25Price: number;
  p75Price: number;
};

export type IntradayAnalogMatch = {
  date: string;
  similarity: number;
  fromPricePct: number; // % move from anchor minute to session close on that day
  sessionRangePct: number;
};

export type IntradayActualBar = {
  minutesFromOpen: number;
  time: string; // "HH:MM"
  price: number;
};

export type IntradayProjectionResult =
  | {
      status: "ok";
      symbol: string;
      asOfIso: string;
      currentMinutesFromOpen: number;
      currentPrice: number;
      priorClose: number;
      actual: IntradayActualBar[];
      projection: IntradayProjectionPoint[];
      sampleSize: number;
      meanSimilarity: number;
      confidence: number;
      matches: IntradayAnalogMatch[];
      medianCloseByEod: number;
      p25CloseByEod: number;
      p75CloseByEod: number;
      medianPctByEod: number;
      probUpByEod: number;
      note: string;
    }
  | { status: "empty"; reason: "market_closed" | "no_history" | "no_matches" | "no_keys"; note: string };

// ── Cache ──

type HistEntry = { at: number; goodUntil: number; bars: Bar[] };
const histCache = new Map<string, HistEntry>();
const inFlight = new Map<string, Promise<Bar[]>>();

function nextIntradayRefreshMs(now = Date.now()): number {
  // Refresh intraday history after each session close.
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const marchSecondSun = (() => {
    const m = new Date(Date.UTC(y, 2, 1));
    const firstSun = 1 + ((7 - m.getUTCDay()) % 7);
    return Date.UTC(y, 2, firstSun + 7, 7, 0, 0);
  })();
  const novFirstSun = (() => {
    const m = new Date(Date.UTC(y, 10, 1));
    const firstSun = 1 + ((7 - m.getUTCDay()) % 7);
    return Date.UTC(y, 10, firstSun, 6, 0, 0);
  })();
  const isEDT = now >= marchSecondSun && now < novFirstSun;
  const closeUTCHour = isEDT ? 20 : 21;
  let close = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), closeUTCHour, 10, 0);
  if (close <= now) close += 24 * 60 * 60 * 1000;
  return close;
}

async function loadIntradayHistory(symbol: string): Promise<Bar[]> {
  const key = symbol.toUpperCase();
  const hit = histCache.get(key);
  const now = Date.now();
  if (hit && now < hit.goodUntil) return hit.bars;
  const p = inFlight.get(key);
  if (p) return p;

  const fetchP = (async (): Promise<Bar[]> => {
    try {
      let bars: Bar[] = [];
      // Primary: Yahoo — free, no key, ~60 days of 5-min bars (≈54 sessions).
      try {
        const yh = await fetchYahooIntraday(symbol, "5min", 6000);
        if (yh.length > bars.length) bars = yh;
      } catch { /* fall through to TwelveData */ }
      // Top-up: TwelveData analog keys (adds detail if quota available).
      if (bars.length < 500 && hasAnalogKey()) {
        try {
          const res = await withAnalogKey((k) => fetchIntradayBatch([symbol], k, "5min", 5000));
          const alt = res[symbol] ?? [];
          if (alt.length > bars.length) bars = alt;
        } catch { /* ignore */ }
      }
      if (bars.length < 500 && hasAnyKey()) {
        try {
          const res = await withRotatingKey((k) => fetchIntradayBatch([symbol], k, "5min", 5000));
          const alt = res[symbol] ?? [];
          if (alt.length > bars.length) bars = alt;
        } catch { /* ignore */ }
      }
      if (bars.length > 0) {
        histCache.set(key, { at: now, goodUntil: nextIntradayRefreshMs(now), bars });
      }
      return bars;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, fetchP);
  return fetchP;
}

// ── Parsing helpers ──

// Yahoo intraday bars are UTC. Twelve Data returns bars already in ET.
// Detect the source timezone once for the whole bar set (not per bar). A
// per-bar heuristic is unsafe because Yahoo UTC bars from 13:30–15:55 overlap
// valid ET session times; parsing only those bars as ET made partial sessions
// appear to run through 15:55 ET and left zero forward bars for matching.
type IntradayTimestampMode = "utc" | "et";

function rawTimeMinutes(datetime: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(datetime);
  if (!m) return null;
  return parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

function detectIntradayTimestampMode(barsNewestFirst: Bar[]): IntradayTimestampMode {
  let total = 0;
  let outsideEtSession = 0;
  let insideUtcSession = 0;
  for (const b of barsNewestFirst) {
    const mins = rawTimeMinutes(b.datetime);
    if (mins === null) continue;
    total++;
    const inEtSession = mins >= OPEN_MIN && mins < CLOSE_MIN;
    const inUtcRegularSession = mins >= 13 * 60 + 30 && mins <= 20 * 60 + 5;
    if (!inEtSession) outsideEtSession++;
    if (inUtcRegularSession) insideUtcSession++;
  }
  if (total === 0) return "et";
  // Yahoo 5m data has a large block of raw 16:00–20:00 UTC bars every full
  // day. TwelveData regular-hours ET data has at most an occasional 16:00
  // print, so require both a meaningful outside-ET share and UTC-session shape.
  return outsideEtSession / total > 0.2 && insideUtcSession / total > 0.8 ? "utc" : "et";
}

function parseBarET(datetime: string, mode: IntradayTimestampMode): { date: string; minutes: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(datetime);
  if (!m) return null;
  const [, ymd, hh, mm] = m;
  const rawH = parseInt(hh, 10);
  const rawM = parseInt(mm, 10);
  if (mode === "et") {
    return { date: ymd, minutes: rawH * 60 + rawM };
  }
  // Convert UTC → ET (EST=UTC-5, EDT=UTC-4). Determine DST from the date.
  const [y, mo, d] = ymd.split("-").map((n) => parseInt(n, 10));
  const asUtc = Date.UTC(y, mo - 1, d, rawH, rawM);
  // US DST: 2nd Sunday of March 07:00 UTC → 1st Sunday of November 06:00 UTC.
  const marchSecondSun = (() => {
    const first = new Date(Date.UTC(y, 2, 1));
    const off = (7 - first.getUTCDay()) % 7;
    return Date.UTC(y, 2, 1 + off + 7, 7, 0, 0);
  })();
  const novFirstSun = (() => {
    const first = new Date(Date.UTC(y, 10, 1));
    const off = (7 - first.getUTCDay()) % 7;
    return Date.UTC(y, 10, 1 + off, 6, 0, 0);
  })();
  const isEdt = asUtc >= marchSecondSun && asUtc < novFirstSun;
  const offsetHours = isEdt ? 4 : 5;
  const et = new Date(asUtc - offsetHours * 3600 * 1000);
  const etY = et.getUTCFullYear();
  const etMo = String(et.getUTCMonth() + 1).padStart(2, "0");
  const etD = String(et.getUTCDate()).padStart(2, "0");
  return {
    date: `${etY}-${etMo}-${etD}`,
    minutes: et.getUTCHours() * 60 + et.getUTCMinutes(),
  };
}

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const CLOSE_MIN = 16 * 60;    // 16:00 ET

type Session = {
  date: string;
  bars: Array<{ minutes: number; open: number; high: number; low: number; close: number; volume: number }>;
  priorClose: number;
};

function groupSessions(barsNewestFirst: Bar[]): Session[] {
  // Bars are newest-first. Filter to regular-hours only and group by date.
  const timestampMode = detectIntradayTimestampMode(barsNewestFirst);
  const byDate = new Map<string, Session["bars"]>();
  for (const b of barsNewestFirst) {
    const p = parseBarET(b.datetime, timestampMode);
    if (!p) continue;
    if (p.minutes < OPEN_MIN || p.minutes >= CLOSE_MIN) continue;
    const arr = byDate.get(p.date) ?? [];
    arr.push({ minutes: p.minutes, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 });
    byDate.set(p.date, arr);
  }
  const dates = [...byDate.keys()].sort(); // ascending
  const sessions: Session[] = [];
  let prevClose = 0;
  for (const date of dates) {
    const bars = byDate.get(date)!.sort((a, b) => a.minutes - b.minutes);
    const s: Session = { date, bars, priorClose: prevClose };
    sessions.push(s);
    prevClose = bars[bars.length - 1].close;
  }
  return sessions;
}

// Features of a partial session up to `anchorMinutes` (inclusive).
type PartialShape = {
  anchorClose: number;
  gapPct: number;         // (open - priorClose)/priorClose *100 (0 if no prior)
  cumRetPct: number;      // (anchorClose - open)/open *100
  rangePct: number;       // (hi-lo)/open *100 over bars so far
  volShare: number;       // cumVolume / (typical fullDayVolume * fraction elapsed)
  momentumPct: number;    // last 30-min return %
  posInRange: number;     // (anchorClose - lo)/(hi-lo) 0..1
};

function partialShape(s: Session, anchorMinutes: number, avgDailyVolume: number): PartialShape | null {
  const bars = s.bars.filter((b) => b.minutes <= anchorMinutes);
  if (bars.length < 2) return null;
  const open = bars[0].open;
  const anchorClose = bars[bars.length - 1].close;
  let hi = -Infinity, lo = Infinity, vol = 0;
  for (const b of bars) {
    if (b.high > hi) hi = b.high;
    if (b.low < lo) lo = b.low;
    vol += b.volume;
  }
  const rangePct = open > 0 ? ((hi - lo) / open) * 100 : 0;
  const cumRetPct = open > 0 ? ((anchorClose - open) / open) * 100 : 0;
  const gapPct = s.priorClose > 0 ? ((open - s.priorClose) / s.priorClose) * 100 : 0;
  const elapsedMin = Math.max(5, anchorMinutes - OPEN_MIN + 5);
  const fraction = elapsedMin / (CLOSE_MIN - OPEN_MIN);
  const expectedVol = avgDailyVolume * fraction;
  const volShare = expectedVol > 0 ? vol / expectedVol : 1;
  // Momentum = return over last 6 bars (~30min) or since start if fewer.
  const tailStart = Math.max(0, bars.length - 6);
  const momOpen = bars[tailStart].open;
  const momentumPct = momOpen > 0 ? ((anchorClose - momOpen) / momOpen) * 100 : 0;
  const posInRange = hi > lo ? (anchorClose - lo) / (hi - lo) : 0.5;
  return { anchorClose, gapPct, cumRetPct, rangePct, volShare, momentumPct, posInRange };
}

function similarity(a: PartialShape, b: PartialShape): number {
  // Gaussian across weighted features. Tolerances tuned for typical US equity
  // intraday scale. Weights emphasize what drives the rest of the day: direction
  // & momentum > range > volume > gap.
  const specs: Array<{ av: number; bv: number; tol: number; w: number }> = [
    { av: a.cumRetPct,  bv: b.cumRetPct,  tol: 0.8, w: 2.0 },
    { av: a.momentumPct,bv: b.momentumPct,tol: 0.6, w: 1.6 },
    { av: a.rangePct,   bv: b.rangePct,   tol: 0.8, w: 1.2 },
    { av: a.gapPct,     bv: b.gapPct,     tol: 0.6, w: 1.0 },
    { av: a.volShare,   bv: b.volShare,   tol: 0.5, w: 0.9 },
    { av: a.posInRange, bv: b.posInRange, tol: 0.25,w: 0.8 },
  ];
  let acc = 0, tot = 0;
  for (const s of specs) {
    const d = s.av - s.bv;
    const g = Math.exp(-((d / s.tol) ** 2));
    acc += g * s.w;
    tot += s.w;
  }
  return tot > 0 ? (acc / tot) * 100 : 0;
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[i];
}

function median(arr: number[]): number {
  return percentile(arr, 50);
}

// ── Main entry ──

function isMarketOpenNow(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= OPEN_MIN && mins < CLOSE_MIN;
}

export async function computeIntradayProjection(symbol: string): Promise<IntradayProjectionResult> {
  let bars = await loadIntradayHistory(symbol);
  if (!bars || bars.length < 80) {
    return { status: "empty", reason: "no_history", note: "Intraday history not available for this symbol." };
  }

  let sessions = groupSessions(bars);
  if (sessions.length < 6) {
    return { status: "empty", reason: "no_history", note: "Not enough intraday sessions to build a projection." };
  }

  // Today's session = most recent date in the data.
  // Guard: if the market is open but the most recent session isn't actually
  // today's ET calendar date, Yahoo hasn't delivered today's bars yet. Bust
  // the intraday cache once and re-fetch before falling back to a clear
  // "waiting for live tape" message.
  const marketOpen = isMarketOpenNow();
  const todayEtStr = (() => {
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const y = et.getFullYear();
    const m = String(et.getMonth() + 1).padStart(2, "0");
    const d = String(et.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();
  const latestDate = sessions[sessions.length - 1].date;
  if (marketOpen && latestDate !== todayEtStr) {
    histCache.delete(symbol.toUpperCase());
    bars = await loadIntradayHistory(symbol);
    sessions = groupSessions(bars);
  }

  const today = sessions[sessions.length - 1];
  const history = sessions.slice(0, -1);
  if (marketOpen && today.date !== todayEtStr) {
    return {
      status: "empty",
      reason: "no_history",
      note: "Waiting for today's live 5-minute bars from Yahoo (usually 15–20 min delay after open).",
    };
  }

  // Average daily volume across recent history for normalization.
  const avgDailyVolume =
    history.slice(-30).reduce((a, s) => a + s.bars.reduce((x, b) => x + b.volume, 0), 0) /
    Math.max(1, Math.min(30, history.length));

  const anchorMinutes = today.bars.length ? today.bars[today.bars.length - 1].minutes : 0;
  if (anchorMinutes < OPEN_MIN + 15) {
    return {
      status: "empty",
      reason: "market_closed",
      note: marketOpen
        ? "Waiting for ~15 minutes of live tape before matching historical mornings."
        : "Market is closed — intraday projection resumes when the session opens.",
    };
  }
  // If the market is closed and the "anchor" is at/near the session close,
  // there's no remaining intraday path to project — say so clearly instead
  // of falling through to a misleading "shape doesn't match" message.
  if (!marketOpen && anchorMinutes >= CLOSE_MIN - 20) {
    return {
      status: "empty",
      reason: "market_closed",
      note: "Market is closed — intraday projection resumes at the next open (9:30 AM ET).",
    };
  }

  const nowShape = partialShape(today, anchorMinutes, avgDailyVolume);
  if (!nowShape) {
    return { status: "empty", reason: "no_matches", note: "Live session data is too thin to project." };
  }

  // Score all historical sessions.
  type Scored = { s: Session; sim: number };
  const scored: Scored[] = [];
  for (const s of history) {
    // Require the historical session to reach at least the anchor time and
    // have data beyond it (so we have "what happened next" to align).
    const lastMin = s.bars[s.bars.length - 1]?.minutes ?? 0;
    if (lastMin < anchorMinutes + 5) continue;
    const shape = partialShape(s, anchorMinutes, avgDailyVolume);
    if (!shape) continue;
    scored.push({ s, sim: similarity(nowShape, shape) });
  }
  scored.sort((a, b) => b.sim - a.sim);
  const K = Math.min(20, scored.length);
  const top = scored.slice(0, K);
  if (top.length < 3) {
    return { status: "empty", reason: "no_matches", note: "Not enough historical mornings match today's shape yet." };
  }

  const currentPrice = nowShape.anchorClose;
  const priorClose = today.priorClose || currentPrice;

  // Build per-minute % moves relative to the anchor bar in each matched day.
  // Grid = every 5 min from anchor+5 to close (16:00).
  const gridMinutes: number[] = [];
  for (let m = anchorMinutes + 5; m <= CLOSE_MIN; m += 5) gridMinutes.push(m);

  const projection: IntradayProjectionPoint[] = [];
  for (const gm of gridMinutes) {
    const pcts: number[] = [];
    for (const { s } of top) {
      // Anchor price in this historical session = last close at or before anchorMinutes.
      const anchorBar = [...s.bars].reverse().find((b) => b.minutes <= anchorMinutes);
      if (!anchorBar) continue;
      const gridBar = [...s.bars].reverse().find((b) => b.minutes <= gm);
      if (!gridBar || gridBar.minutes < anchorMinutes) continue;
      const pct = anchorBar.close > 0 ? ((gridBar.close - anchorBar.close) / anchorBar.close) * 100 : 0;
      pcts.push(pct);
    }
    if (pcts.length < 3) continue;
    const med = median(pcts);
    const p25 = percentile(pcts, 25);
    const p75 = percentile(pcts, 75);
    projection.push({
      minutesFromOpen: gm,
      medianPct: med,
      p25Pct: p25,
      p75Pct: p75,
      medianPrice: currentPrice * (1 + med / 100),
      p25Price: currentPrice * (1 + p25 / 100),
      p75Price: currentPrice * (1 + p75 / 100),
    });
  }

  if (projection.length === 0) {
    return { status: "empty", reason: "no_matches", note: "No forward path data across matched sessions." };
  }

  // EOD statistics from matches.
  const eodPcts: number[] = [];
  for (const { s } of top) {
    const anchorBar = [...s.bars].reverse().find((b) => b.minutes <= anchorMinutes);
    const closeBar = s.bars[s.bars.length - 1];
    if (!anchorBar || !closeBar) continue;
    if (anchorBar.close <= 0) continue;
    eodPcts.push(((closeBar.close - anchorBar.close) / anchorBar.close) * 100);
  }
  const medianPctByEod = median(eodPcts);
  const p25ByEod = percentile(eodPcts, 25);
  const p75ByEod = percentile(eodPcts, 75);
  const probUpByEod = eodPcts.filter((p) => p > 0).length / Math.max(1, eodPcts.length);

  const meanSim = top.reduce((a, b) => a + b.sim, 0) / top.length;
  // Confidence: similarity, sample, agreement (tighter p25/p75 → higher).
  const eodSpread = Math.abs(p75ByEod - p25ByEod);
  const agree = Math.max(0, 1 - Math.min(1, eodSpread / 2)); // 2% spread ≈ neutral
  const nBoost = Math.min(1, top.length / 15);
  const confidence = Math.round(100 * (0.45 * (meanSim / 100) + 0.35 * agree + 0.2 * nBoost));

  const actual: IntradayActualBar[] = today.bars.map((b) => ({
    minutesFromOpen: b.minutes,
    time: `${String(Math.floor(b.minutes / 60)).padStart(2, "0")}:${String(b.minutes % 60).padStart(2, "0")}`,
    price: b.close,
  }));

  const matches: IntradayAnalogMatch[] = top.map(({ s, sim }) => {
    const anchorBar = [...s.bars].reverse().find((b) => b.minutes <= anchorMinutes);
    const closeBar = s.bars[s.bars.length - 1];
    const dayOpen = s.bars[0]?.open ?? 0;
    const dayHi = Math.max(...s.bars.map((b) => b.high));
    const dayLo = Math.min(...s.bars.map((b) => b.low));
    return {
      date: s.date,
      similarity: Math.round(sim),
      fromPricePct: anchorBar && closeBar && anchorBar.close > 0
        ? ((closeBar.close - anchorBar.close) / anchorBar.close) * 100
        : 0,
      sessionRangePct: dayOpen > 0 ? ((dayHi - dayLo) / dayOpen) * 100 : 0,
    };
  });

  return {
    status: "ok",
    symbol: symbol.toUpperCase(),
    asOfIso: new Date().toISOString(),
    currentMinutesFromOpen: anchorMinutes,
    currentPrice,
    priorClose,
    actual,
    projection,
    sampleSize: top.length,
    meanSimilarity: Math.round(meanSim),
    confidence: Math.max(0, Math.min(100, confidence)),
    matches,
    medianCloseByEod: currentPrice * (1 + medianPctByEod / 100),
    p25CloseByEod: currentPrice * (1 + p25ByEod / 100),
    p75CloseByEod: currentPrice * (1 + p75ByEod / 100),
    medianPctByEod,
    probUpByEod,
    note: `Median path across ${top.length} historical days with the closest morning shape. Not a prediction — every point is the empirical median of what real prior sessions did next.`,
  };
}