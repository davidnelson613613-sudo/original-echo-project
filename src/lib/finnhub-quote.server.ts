// Finnhub quote fallback. Called when TwelveData is rate-limited or missing.
// Finnhub free tier: 60 calls/min — plenty of headroom.
// Endpoint: https://finnhub.io/api/v1/quote?symbol=AAPL&token=...
// Response: { c, d, dp, h, l, o, pc, t }  (c=current price, pc=prev close)

import type { Quote } from "./quote.server";
import { recordProvider } from "./provider-stats.server";

export function hasFinnhubKey(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

async function fetchOne(symbol: string, key: string): Promise<Quote | null> {
  const started = Date.now();
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
  } catch (e) {
    recordProvider("finnhub", false, Date.now() - started, e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    recordProvider("finnhub", false, Date.now() - started, `HTTP ${res.status}`);
    return null;
  }
  const j = (await res.json()) as {
    c?: number; d?: number; dp?: number; h?: number; l?: number; o?: number; pc?: number; t?: number;
  };
  if (!j || typeof j.c !== "number" || j.c <= 0) {
    recordProvider("finnhub", false, Date.now() - started, "no price");
    return null;
  }
  recordProvider("finnhub", true, Date.now() - started);
  return {
    symbol,
    price: j.c,
    open: typeof j.o === "number" ? j.o : null,
    previousClose: typeof j.pc === "number" ? j.pc : null,
    change: typeof j.d === "number" ? j.d : null,
    changePct: typeof j.dp === "number" ? j.dp : null,
    ts: typeof j.t === "number" ? j.t * 1000 : Date.now(),
  };
}


export async function fetchFinnhubQuoteBatch(symbols: string[]): Promise<Record<string, Quote>> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return {};
  const out: Record<string, Quote> = {};
  // Finnhub quote endpoint is per-symbol; fan out in parallel with modest concurrency.
  const results = await Promise.allSettled(symbols.map((s) => fetchOne(s, key)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) out[symbols[i]] = r.value;
  });
  return out;
}
