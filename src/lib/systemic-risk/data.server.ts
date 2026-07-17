// Long-history multi-asset daily fetcher for the Systemic Risk engine.
//
// Uses Yahoo's chart API with range=max&interval=1d to pull decades of
// data for a curated universe. Cached in-memory per worker instance
// (server functions get warm reuse across calls in the same worker).
//
// We intentionally do NOT depend on twelvedata here — free tier can't
// serve the volume of history we need, and we want the entire engine
// self-contained on Yahoo.

import { YAHOO_IDENTITIES, withYahooPace } from "../yahoo-identities.server";

export type DailyBar = {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
};

// Yahoo symbol mapping — the engine keys everything by these logical names.
export const SYSTEMIC_SYMBOLS = {
  SPY: "SPY",
  QQQ: "QQQ",
  IWM: "IWM", // small caps
  VIX: "^VIX",
  VIX3M: "^VIX3M",
  // sector ETFs (broad coverage of US equity market)
  XLK: "XLK", XLF: "XLF", XLE: "XLE", XLU: "XLU", XLV: "XLV",
  XLY: "XLY", XLP: "XLP", XLI: "XLI", XLB: "XLB", XLC: "XLC", XLRE: "XLRE",
  // credit / rates proxies
  HYG: "HYG", // high yield
  LQD: "LQD", // investment grade
  TLT: "TLT", // long treasury
  IEF: "IEF", // 7-10y treasury
  SHY: "SHY", // 1-3y treasury
  // FX / commodities
  UUP: "UUP", // dollar bull
  GLD: "GLD", // gold
  USO: "USO", // oil
  // international
  EFA: "EFA",
  EEM: "EEM",
} as const;

export type SystemicSymbol = keyof typeof SYSTEMIC_SYMBOLS;

type FetchOpts = { range?: string };

let RR = 0;

async function yahooFetch(symbol: string, range = "max"): Promise<DailyBar[]> {
  const attempts = 24;
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    const id = YAHOO_IDENTITIES[(RR + i) % YAHOO_IDENTITIES.length];
    const url = new URL(
      `https://${id.host}/v8/finance/chart/${encodeURIComponent(symbol)}`,
    );
    url.searchParams.set("range", range);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("events", "div,split");
    url.searchParams.set("includeAdjustedClose", "true");
    try {
      const r = await withYahooPace(() =>
        fetch(url.toString(), {
          headers: {
            "User-Agent": id.ua,
            Accept: "application/json,text/plain,*/*",
            "Accept-Language": id.lang,
            "Cache-Control": "no-cache",
          },
        }),
      );
      if (!r.ok) {
        lastErr = new Error(`Yahoo HTTP ${r.status} for ${symbol}`);
        if (r.status === 429 || r.status === 503) {
          await new Promise((res) => setTimeout(res, 250 + Math.random() * 500));
        }
        continue;
      }
      const j = (await r.json()) as any;
      RR = (RR + 1) % YAHOO_IDENTITIES.length;
      const res = j?.chart?.result?.[0];
      const ts: number[] = res?.timestamp ?? [];
      const q = res?.indicators?.quote?.[0];
      const adj = res?.indicators?.adjclose?.[0]?.adjclose ?? [];
      if (!q || !ts.length) return [];
      const out: DailyBar[] = [];
      for (let k = 0; k < ts.length; k++) {
        const o = q.open?.[k], h = q.high?.[k], l = q.low?.[k], c = q.close?.[k];
        if (o == null || h == null || l == null || c == null) continue;
        const d = new Date(ts[k] * 1000).toISOString().slice(0, 10);
        out.push({
          date: d,
          open: o, high: h, low: l, close: c,
          adjClose: adj?.[k] ?? c,
          volume: q.volume?.[k] ?? 0,
        });
      }
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`Yahoo unreachable for ${symbol}`);
}

// ── In-memory cache (per worker instance) ───────────────────────────
type CacheEntry = { data: DailyBar[]; ts: number };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export async function fetchDailyHistory(
  symbol: SystemicSymbol,
  opts: FetchOpts = {},
): Promise<DailyBar[]> {
  const key = `${symbol}:${opts.range ?? "max"}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  const bars = await yahooFetch(SYSTEMIC_SYMBOLS[symbol], opts.range ?? "max");
  CACHE.set(key, { data: bars, ts: Date.now() });
  return bars;
}

// Fetch the full universe with a small concurrency cap so Yahoo doesn't
// throttle us. Missing symbols are returned as empty arrays — features
// downstream degrade gracefully.
export async function fetchUniverse(
  symbols: SystemicSymbol[],
): Promise<Record<SystemicSymbol, DailyBar[]>> {
  const out = {} as Record<SystemicSymbol, DailyBar[]>;
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const s = symbols[idx++];
      try {
        out[s] = await fetchDailyHistory(s);
      } catch (e) {
        console.warn(`[systemic-risk] fetch failed for ${s}:`, (e as Error).message);
        out[s] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

// Utility: return the closest bar on or before target date.
export function barOnOrBefore(bars: DailyBar[], date: string): DailyBar | null {
  if (!bars.length) return null;
  // binary search
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans >= 0 ? bars[ans] : null;
}

export function indexOnOrBefore(bars: DailyBar[], date: string): number {
  if (!bars.length) return -1;
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}
