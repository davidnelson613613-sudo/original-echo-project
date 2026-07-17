// Stooq daily bar fetcher — free, no API key, ~20+ years of history.
// Used as a fallback for the Historical Analog Scanner when TwelveData
// analog keys are missing, exhausted, or return insufficient history.
//
// Endpoint: https://stooq.com/q/d/l/?s=<symbol>.us&i=d
// Returns CSV: Date,Open,High,Low,Close,Volume  (ascending by date).

import type { Bar } from "./market.server";

function normalizeStooqSymbol(symbol: string): string {
  // Stooq US tickers are lowercase with a .us suffix. Indexes/ETFs work the same.
  return `${symbol.toLowerCase()}.us`;
}

export async function fetchStooqDaily(symbol: string): Promise<Bar[]> {
  const s = normalizeStooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LaddrxScanner/1.0; +https://laddrx.app)",
        Accept: "text/csv,text/plain,*/*",
      },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
  const text = await res.text();
  // Stooq returns "No data" (plain text, still 200) for unknown symbols.
  if (!text || text.trim().length === 0 || /no data/i.test(text.slice(0, 32))) {
    return [];
  }
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const bars: Bar[] = [];
  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 5) continue;
    const [date, open, high, low, close, volume] = parts;
    const o = parseFloat(open);
    const h = parseFloat(high);
    const l = parseFloat(low);
    const c = parseFloat(close);
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    bars.push({
      datetime: date,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: volume ? parseFloat(volume) || undefined : undefined,
    });
  }
  // Stooq is already ascending; fetchLongHistory returns ascending too.
  return bars;
}
