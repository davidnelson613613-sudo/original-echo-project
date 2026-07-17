// Earnings calendar lookup with a provider chain:
//   1. FMP (Financial Modeling Prep) if FMP_API_KEY is set
//   2. Finnhub if FINNHUB_API_KEY is set
//   3. Yahoo Finance (no key) as final fallback
//
// Any provider failure silently falls through to the next. Best-effort:
// if all providers fail the scan continues without an earnings guard for
// that symbol. Cache TTL is 12 hours — earnings dates rarely change intraday.

export type EarningsInfo = {
  nextEarningsDate: string; // ISO date (YYYY-MM-DD)
  daysUntil: number;
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 3_000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

type CacheEntry = { at: number; info: EarningsInfo | null };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 12 * 60 * 60 * 1000;

// A conservative mapping — most ETFs / indexes we scan never have earnings.
// We still hit the API for equities so the code is future-proof if the
// universe expands.
const NO_EARNINGS_SYMBOLS = new Set([
  "NDX", "QQQ", "SMH", "SOXX", "SOXQ", "SPY", "VIX", "IWM", "DIA", "IVV",
  "VTI", "VOO", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLU",
  "XLB", "XLRE", "XLC",
]);

function tradingDaysBetween(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  const oneDay = 86400_000;
  let count = 0;
  for (let t = fromMs; t < toMs; t += oneDay) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) count++;
  }
  return count;
}

function toInfo(dateIso: string): EarningsInfo | null {
  const targetMs = Date.parse(dateIso);
  if (!Number.isFinite(targetMs)) return null;
  const nowMs = Date.now();
  if (targetMs <= nowMs) return null;
  return {
    nextEarningsDate: dateIso.slice(0, 10),
    daysUntil: tradingDaysBetween(nowMs, targetMs),
  };
}

// ── FMP ───────────────────────────────────────────────────
async function fetchFmp(symbol: string): Promise<EarningsInfo | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  // Next 90 days of earnings for this ticker.
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const url = `https://financialmodelingprep.com/api/v3/earning_calendar?symbol=${encodeURIComponent(
    symbol,
  )}&from=${from}&to=${to}&apikey=${encodeURIComponent(key)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as Array<{ symbol?: string; date?: string }>;
  if (!Array.isArray(j) || j.length === 0) return null;
  const upcoming = j
    .filter((e) => e.symbol?.toUpperCase() === symbol.toUpperCase() && typeof e.date === "string")
    .map((e) => e.date as string)
    .filter((d) => Date.parse(d) > Date.now())
    .sort();
  if (upcoming.length === 0) return null;
  return toInfo(upcoming[0]);
}

// ── Finnhub ───────────────────────────────────────────────
async function fetchFinnhub(symbol: string): Promise<EarningsInfo | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(
    symbol,
  )}&token=${encodeURIComponent(key)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as { earningsCalendar?: Array<{ symbol?: string; date?: string }> };
  const list = j.earningsCalendar;
  if (!Array.isArray(list) || list.length === 0) return null;
  const upcoming = list
    .filter((e) => e.symbol?.toUpperCase() === symbol.toUpperCase() && typeof e.date === "string")
    .map((e) => e.date as string)
    .filter((d) => Date.parse(d) > Date.now())
    .sort();
  if (upcoming.length === 0) return null;
  return toInfo(upcoming[0]);
}

// ── Yahoo (no key) ────────────────────────────────────────
async function fetchYahoo(symbol: string): Promise<EarningsInfo | null> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    symbol,
  )}?modules=calendarEvents`;
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; LaddrxScanner/1.0; +https://laddrx.app)",
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    quoteSummary?: {
      result?: Array<{
        calendarEvents?: {
          earnings?: { earningsDate?: Array<{ raw?: number }> };
        };
      }>;
    };
  };
  const raw = j.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0]?.raw;
  if (!raw || typeof raw !== "number") return null;
  const iso = new Date(raw * 1000).toISOString();
  return toInfo(iso);
}

export async function fetchNextEarnings(symbol: string): Promise<EarningsInfo | null> {
  const upper = symbol.toUpperCase();
  if (NO_EARNINGS_SYMBOLS.has(upper)) return null;

  const hit = cache.get(upper);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;

  const providers: Array<() => Promise<EarningsInfo | null>> = [
    () => fetchFmp(upper),
    () => fetchFinnhub(upper),
    () => fetchYahoo(upper),
  ];
  for (const p of providers) {
    try {
      const info = await p();
      if (info) {
        cache.set(upper, { at: Date.now(), info });
        return info;
      }
    } catch {
      /* try next provider */
    }
  }
  cache.set(upper, { at: Date.now(), info: null });
  return null;
}
