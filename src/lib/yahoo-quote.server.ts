// Yahoo real-time quote fetcher. Free, no API key. Used for symbols that
// TwelveData's free tier does not serve (^NDX, ^GSPC, ^DJI, ^IXIC, ^VIX).
//
// Uses the same v8/finance/chart endpoint as fetchYahooDaily but pulls the
// `meta` block, which carries `regularMarketPrice` and
// `chartPreviousClose` — the exact fields we need for a live overlay on the
// daily snapshot. Round-trips through the shared identity pool so we stay
// under Yahoo's per-fingerprint rate limits.

import type { Quote } from "./quote.server";
import {
  YAHOO_IDENTITIES,
  withYahooPace,
  recordYahooResult,
  isYahooCircuitOpen,
  type YahooIdentity,
} from "./yahoo-identities.server";
import { recordProvider } from "./provider-stats.server";


const YAHOO_SYMBOL: Record<string, string> = {
  NDX: "^NDX",
  SPX: "^GSPC",
  DJI: "^DJI",
  IXIC: "^IXIC",
  VIX: "^VIX",
};

function toYahooSymbol(sym: string): string {
  return YAHOO_SYMBOL[sym.toUpperCase()] ?? sym.toUpperCase();
}

let rr = 0;
const cache = new Map<string, { at: number; quote: Quote }>();
const TTL_MS = 15_000;
const MAX_YAHOO_ATTEMPTS = 64;

type Meta = {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
};

async function fetchOne(symbol: string): Promise<Quote | null> {
  // Circuit breaker: skip Yahoo entirely during cooldown. Callers fall
  // through to Finnhub / TwelveData immediately.
  if (isYahooCircuitOpen()) return null;
  const started = Date.now();
  const attempts: YahooIdentity[] = [];
  for (let i = 0; i < Math.min(MAX_YAHOO_ATTEMPTS, YAHOO_IDENTITIES.length); i++) {
    attempts.push(YAHOO_IDENTITIES[(rr + i) % YAHOO_IDENTITIES.length]);
  }
  rr = (rr + 1) % YAHOO_IDENTITIES.length;


  let lastErr: unknown = null;
  for (const { host, ua, lang } of attempts) {
    const url = new URL(
      `https://${host}/v8/finance/chart/${encodeURIComponent(toYahooSymbol(symbol))}`,
    );
    url.searchParams.set("range", "1d");
    url.searchParams.set("interval", "1m");
    url.searchParams.set("includePrePost", "false");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3_500);
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
      if (!r.ok) {
        lastErr = new Error(`Yahoo quote HTTP ${r.status} for ${symbol} via ${host}`);
        if (r.status === 429 || r.status === 503) {
          await new Promise((res) => setTimeout(res, 200 + Math.random() * 400));
        }
        continue;
      }
      const j = (await r.json()) as {
        chart?: { result?: Array<{ meta?: Meta }>; error?: { description?: string } | null };
      };
      const meta = j.chart?.result?.[0]?.meta;
      if (!meta) {
        lastErr = new Error(`Yahoo quote no meta for ${symbol}`);
        continue;
      }
      const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
      if (price == null || !Number.isFinite(price) || price <= 0) {
        lastErr = new Error(`Yahoo quote invalid price for ${symbol}`);
        continue;
      }
      const prev =
        typeof meta.chartPreviousClose === "number"
          ? meta.chartPreviousClose
          : typeof meta.previousClose === "number"
          ? meta.previousClose
          : null;
      const change = prev != null ? price - prev : null;
      const pct = prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;
      const ts = typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : Date.now();
      recordYahooResult(true);
      recordProvider("yahoo", true, Date.now() - started);
      return {
        symbol,
        price,
        open: null,
        previousClose: prev,
        change,
        changePct: pct,
        ts,
      };
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  recordYahooResult(false);
  recordProvider("yahoo", false, Date.now() - started, lastErr instanceof Error ? lastErr.message : lastErr ? String(lastErr) : null);

  if (lastErr) console.warn("[yahoo-quote]", symbol, lastErr instanceof Error ? lastErr.message : lastErr);
  // Hard fallback for NDX: Nasdaq's official public index quote endpoint is
  // independent of Yahoo and keeps the dashboard from blanking when Yahoo 429s.
  try {
    const { fetchNasdaqIndexQuote } = await import("./nasdaq-index.server");
    return await fetchNasdaqIndexQuote(symbol);
  } catch {
    /* not a Nasdaq-supported index or fallback unavailable */
  }
  return null;
}

export async function fetchYahooQuoteBatch(symbols: string[]): Promise<Record<string, Quote>> {
  const wanted = Array.from(new Set(symbols));
  const now = Date.now();
  const out: Record<string, Quote> = {};
  const stale: string[] = [];
  for (const s of wanted) {
    const hit = cache.get(s);
    if (hit && now - hit.at < TTL_MS) out[s] = hit.quote;
    else stale.push(s);
  }
  if (stale.length === 0) return out;

  const results = await Promise.all(stale.map(async (s) => [s, await fetchOne(s)] as const));
  for (const [s, q] of results) {
    if (q) {
      cache.set(s, { at: Date.now(), quote: q });
      out[s] = q;
    }
  }
  return out;
}