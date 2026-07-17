// Real-time quote endpoint for TwelveData. Independent of the daily/intraday
// bar fetch so a quote failure never kills a scan. Uses the same rotating
// key pool. In-memory 15s TTL — every scan cycle gets fresh prices.

export type Quote = {
  symbol: string;
  price: number;         // last trade
  open: number | null;   // session open
  previousClose: number | null;
  change: number | null; // absolute
  changePct: number | null;
  ts: number;            // epoch ms
};

type CacheEntry = { at: number; quote: Quote };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 4_000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function fetchQuoteBatch(
  symbols: string[],
  apiKey: string,
): Promise<Record<string, Quote>> {
  const wanted = Array.from(new Set(symbols));
  if (wanted.length === 0) return {};
  const now = Date.now();

  // Serve fresh cache entries directly; only fetch symbols with stale/no cache.
  const out: Record<string, Quote> = {};
  const stale: string[] = [];
  for (const s of wanted) {
    const hit = cache.get(s);
    if (hit && now - hit.at < TTL_MS) out[s] = hit.quote;
    else stale.push(s);
  }
  if (stale.length === 0) return out;

  const url = new URL("https://api.twelvedata.com/quote");
  url.searchParams.set("symbol", stale.join(","));
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("format", "JSON");

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`TwelveData quote HTTP ${res.status}`);
  const raw = (await res.json()) as unknown;

  // Rate-limit envelope check
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const top = raw as { code?: number; status?: string; message?: string };
    if (top.status === "error" || (typeof top.code === "number" && top.code >= 400)) {
      if (top.code === 429) throw new Error("RATE_LIMIT");
      // Single-symbol success responses also have `symbol` — only bail if there's no per-symbol data.
      if (!("symbol" in (raw as Record<string, unknown>))) {
        throw new Error(top.message || `TwelveData quote error ${top.code ?? "?"}`);
      }
    }
  }

  // Response shape: single symbol → flat object; multiple → keyed by symbol.
  const parseOne = (obj: Record<string, unknown>): Quote | null => {
    const sym = typeof obj.symbol === "string" ? obj.symbol : null;
    const price = num(obj.close) ?? num(obj.price) ?? num((obj as { last?: unknown }).last);
    if (!sym || price == null) return null;
    const open = num(obj.open);
    const prev = num((obj as { previous_close?: unknown }).previous_close);
    const change = num(obj.change);
    const pct = num((obj as { percent_change?: unknown }).percent_change);
    return {
      symbol: sym,
      price,
      open,
      previousClose: prev,
      change,
      changePct: pct,
      ts: Date.now(),
    };
  };

  if (raw && typeof raw === "object" && "symbol" in (raw as Record<string, unknown>)) {
    const q = parseOne(raw as Record<string, unknown>);
    if (q) {
      cache.set(q.symbol, { at: Date.now(), quote: q });
      out[q.symbol] = q;
    }
    return out;
  }
  const obj = raw as Record<string, Record<string, unknown>>;
  for (const s of stale) {
    const entry = obj[s];
    if (!entry) continue;
    const q = parseOne(entry);
    if (q) {
      cache.set(s, { at: Date.now(), quote: q });
      out[s] = q;
    }
  }
  return out;
}
