// Yahoo Finance daily bar fetcher — free, no API key. Primary data source for
// the Historical Analog Scanner (with Stooq as the sole fallback).
//
// ─── Split/Dividend Adjustment (CRITICAL) ────────────────────────────────
// Yahoo's chart API returns TWO price series:
//   • indicators.quote[0].{open,high,low,close}  → RAW, unadjusted OHLC.
//   • indicators.adjclose[0].adjclose            → split + dividend adjusted
//                                                  close (Yahoo-computed).
//
// TwelveData's default `time_series` endpoint returns SPLIT+DIVIDEND ADJUSTED
// OHLC. If the analog scanner consumed Yahoo's raw `close` field, every stock
// with a historical split (NVDA 2021 4:1 & 2024 10:1, TSLA 2020 5:1 & 2022 3:1,
// AAPL 2020 4:1, GOOG 2022 20:1, AMZN 2022 20:1, SHOP 2022 10:1, NFLX, etc.)
// would appear to have a massive fake crash on the split date, and the analog
// engine would fire on split-day gaps instead of real market behavior.
//
// The adjustment methodology below matches TwelveData's output:
//   1. Compute per-bar ratio r_i = adjclose_i / close_i. This encodes the
//      combined cumulative split+dividend adjustment for that bar's date.
//   2. Adjusted OHLC:
//         adjOpen_i  = open_i  * r_i
//         adjHigh_i  = high_i  * r_i
//         adjLow_i   = low_i   * r_i
//         adjClose_i = adjclose_i                (already adjusted)
//   3. Adjusted volume uses SPLIT-ONLY cumulative factor from `events.splits`
//      (dividends do not change share count). For bar i:
//         splitFactor_i = ∏ (split.numerator / split.denominator) for every
//                         split whose date > bar_i.date.
//         adjVolume_i   = volume_i * splitFactor_i
//      This keeps historical share counts comparable to post-split share
//      counts (a 4:1 split quadruples the number of shares outstanding, so
//      pre-split volume must be multiplied by 4 to be comparable).
//
// ─── Identity Rotation ───────────────────────────────────────────────────
// 2 hosts × 14 UAs × 7 Accept-Language = 196 unique fingerprints indexed to
// 170 slots. See REBUILD.md §7.6. Uses `period1=0` (NOT `range=max`) because
// Yahoo silently caps `range=max` at ~1yr for many symbols (SMH → ~314 bars).

import type { Bar } from "./market.server";

const YAHOO_SYMBOL: Record<string, string> = {
  NDX: "^NDX",
  SPX: "^GSPC",
  DJI: "^DJI",
  IXIC: "^IXIC",
  VIX: "^VIX",
};

function toYahooSymbol(symbol: string): string {
  return YAHOO_SYMBOL[symbol.toUpperCase()] ?? symbol.toUpperCase();
}

// Fingerprint pool (2 hosts × 100 UAs × 50 langs = 10,000 identities) is
// shared with market.server.ts / yahoo-quote.server.ts via
// yahoo-identities.server.ts so the hot paths can never drift.
import {
  YAHOO_IDENTITIES,
  withYahooPace,
  recordYahooResult,
  isYahooCircuitOpen,
  type YahooIdentity,
} from "./yahoo-identities.server";
import { recordProvider } from "./provider-stats.server";
let yahooRR = 0;
const MAX_YAHOO_ATTEMPTS = 64;


type YahooSplitEvent = {
  date?: number;
  numerator?: number;
  denominator?: number;
  splitRatio?: string;
};

type YahooChartJson = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      events?: {
        splits?: Record<string, YahooSplitEvent>;
      };
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
        adjclose?: Array<{
          adjclose?: (number | null)[];
        }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
};

async function fetchYahooDailyChart(symbol: string, maxBars?: number): Promise<YahooChartJson> {
  if (isYahooCircuitOpen()) throw new Error(`Yahoo circuit open for ${symbol}`);
  const started = Date.now();
  const attempts: YahooIdentity[] = [];
  for (let i = 0; i < Math.min(MAX_YAHOO_ATTEMPTS, YAHOO_IDENTITIES.length); i++) {
    attempts.push(YAHOO_IDENTITIES[(yahooRR + i) % YAHOO_IDENTITIES.length]);
  }

  yahooRR = (yahooRR + 1) % YAHOO_IDENTITIES.length;

  let lastErr: unknown = null;
  for (const { host, ua, lang } of attempts) {
    const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(toYahooSymbol(symbol))}`);
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = maxBars
      ? period2 - Math.ceil(maxBars * 1.8 * 24 * 60 * 60)
      : 0;
    url.searchParams.set("period1", String(Math.max(0, period1)));
    url.searchParams.set("period2", String(period2));
    url.searchParams.set("interval", "1d");
    url.searchParams.set("includePrePost", "false");
    // events=div,splits ensures the response includes events.splits (needed
    // for volume adjustment) and enables the adjclose indicator array.
    url.searchParams.set("events", "div,splits");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4_000);
    try {
      const r = await withYahooPace(() => fetch(url.toString(), {
          signal: ac.signal,
          headers: {
            "User-Agent": ua,
            Accept: "application/json,text/plain,*/*",
            "Accept-Language": lang,
            "Cache-Control": "no-cache",
          },
        }));
      if (r.ok) {
        const text = await r.text();
        try {
          const parsed = JSON.parse(text) as YahooChartJson;
          recordYahooResult(true);
          recordProvider("yahoo", true, Date.now() - started);
          return parsed;
        } catch {
          lastErr = new Error(`Yahoo non-JSON via ${host}: ${text.slice(0, 80)}`);
          continue;
        }
      }
      lastErr = new Error(`Yahoo HTTP ${r.status} for ${symbol} via ${host}`);
      if (r.status === 429 || r.status === 503) {
        await new Promise((res) => setTimeout(res, 250 + Math.random() * 500));
      }
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  recordYahooResult(false);
  recordProvider("yahoo", false, Date.now() - started, lastErr instanceof Error ? lastErr.message : lastErr ? String(lastErr) : null);
  throw lastErr ?? new Error(`Yahoo unreachable for ${symbol}`);
}


/**
 * Build a per-bar cumulative split factor array for volume adjustment.
 *
 * splitFactor[i] = ∏ (numerator/denominator) for every split whose event
 * timestamp is STRICTLY AFTER bars[i]'s timestamp.
 *
 * Bars on/after the split date are already in post-split share terms and
 * receive factor 1 for that split. Bars strictly before receive the split's
 * ratio. Compounds across multiple splits (NVDA: 4:1 in 2021 then 10:1 in
 * 2024 → bars before 2021 get factor 40; bars between get factor 10; bars
 * after 2024 get factor 1).
 */
function buildSplitFactors(
  timestamps: number[],
  splits: Record<string, YahooSplitEvent> | undefined,
): number[] {
  const factors = new Array<number>(timestamps.length).fill(1);
  if (!splits) return factors;

  // Normalize splits to a sorted ascending list of {ts, ratio}.
  const events: Array<{ ts: number; ratio: number }> = [];
  for (const key of Object.keys(splits)) {
    const s = splits[key];
    const ts = typeof s.date === "number" ? s.date : Number(key);
    const num = typeof s.numerator === "number" ? s.numerator : NaN;
    const den = typeof s.denominator === "number" ? s.denominator : NaN;
    if (!Number.isFinite(ts) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) continue;
    const ratio = num / den;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    events.push({ ts, ratio });
  }
  if (events.length === 0) return factors;
  events.sort((a, b) => a.ts - b.ts);

  // Walk bars ascending; for each bar, cumulative factor = product of ratios
  // of splits with ts > bar.ts. Since events are ascending and bars ascend,
  // we can compute total product and divide out ratios as we cross each
  // split's timestamp.
  let remaining = events.reduce((acc, e) => acc * e.ratio, 1);
  let evIdx = 0;
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    // Advance past all splits whose date is <= this bar's date (those are
    // already reflected in the bar's share count, so drop them from the
    // "future splits" product).
    while (evIdx < events.length && events[evIdx].ts <= t) {
      remaining /= events[evIdx].ratio;
      evIdx++;
    }
    factors[i] = remaining;
  }
  return factors;
}

export async function fetchYahooDaily(symbol: string, maxBars?: number): Promise<Bar[]> {
  let j: YahooChartJson;
  try {
    j = await fetchYahooDailyChart(symbol, maxBars);
  } catch (e) {
    // NDX analogs must survive Yahoo 429/503 windows. Nasdaq official history
    // is the independent keyless fallback before the generic Stooq fallback.
    try {
      const { fetchNasdaqIndexDaily } = await import("./nasdaq-index.server");
      const bars = await fetchNasdaqIndexDaily(symbol, maxBars ?? 5000);
      if (bars.length) return bars;
    } catch {
      /* fall through to original Yahoo error */
    }
    throw e;
  }
  const err = j.chart?.error;
  if (err) throw new Error(`Yahoo ${err.code ?? "error"}: ${err.description ?? ""}`);
  const result = j.chart?.result?.[0];
  const ts = result?.timestamp;
  const q = result?.indicators?.quote?.[0];
  if (!ts || !q || !q.close) return [];

  const adjArr = result?.indicators?.adjclose?.[0]?.adjclose;
  const splitFactors = buildSplitFactors(ts, result?.events?.splits);

  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    if (c === 0) continue;

    // Split+dividend adjustment ratio derived from Yahoo's own adjclose.
    // Fall back to 1 when Yahoo omits adjclose for a bar (rare — usually
    // only on the very latest bar of some illiquid tickers).
    const adj = adjArr?.[i];
    const ratio = adj != null && Number.isFinite(adj) && c !== 0 ? (adj as number) / c : 1;

    // Clamp against floating-point noise on bars with no corporate action.
    const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

    const adjClose = adj != null && Number.isFinite(adj) ? (adj as number) : c;
    const adjOpen = o * safeRatio;
    const adjHigh = h * safeRatio;
    const adjLow = l * safeRatio;

    // Volume: split-only cumulative factor (dividends do not affect share
    // count). splitFactors[i] = 1 when no future splits.
    const sf = splitFactors[i] ?? 1;
    const adjVolume = v != null && Number.isFinite(v) ? (v as number) * sf : undefined;

    const d = new Date(ts[i] * 1000);
    const datetime = d.toISOString().slice(0, 10);
    bars.push({
      datetime,
      open: adjOpen,
      high: adjHigh,
      low: adjLow,
      close: adjClose,
      volume: adjVolume,
    });
  }
  // Yahoo returns ascending by timestamp already.
  return bars;
}
