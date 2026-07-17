// Daily-bar cache for the Future Leaders Scanner.
//
// Yahoo daily bars change once/day after the US market close. Re-downloading
// 5y of history for ~4,200 tickers on every scan is ~99% wasted work.
//
// Cache strategy: one row per symbol, keyed on `symbol`, holding the full
// adjusted bar array as JSONB. A cache hit means the row was fetched within
// TTL_MS (18h, ≥ one trading session but < 24h so overnight scans still get
// yesterday's close). Cache miss → fall back to Yahoo, then upsert.
//
// Only the service role touches this table (RLS denies all client access).

import type { Bar } from "../market.server";

// 18h TTL: covers a full trading session + after-hours settlement, but any
// scan run the next morning refreshes.
const TTL_MS = 18 * 60 * 60 * 1000;

type CacheRow = {
  symbol: string;
  as_of: string;
  bars: Bar[];
  bar_count: number;
  fetched_at: string;
};

function isFresh(fetchedAt: string): boolean {
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < TTL_MS;
}

/**
 * Bulk-read cached bars for a list of symbols. Returns a Map of symbol →
 * bars for only the fresh entries. Stale/missing entries are omitted so the
 * caller re-fetches them.
 */
export async function readBarCache(symbols: string[]): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>();
  if (symbols.length === 0) return out;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Chunk to avoid oversized IN clauses.
  const CHUNK = 500;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("future_leaders_bar_cache")
      .select("symbol, as_of, bars, bar_count, fetched_at")
      .in("symbol", chunk);
    if (error) {
      console.error("[bar-cache] read failed:", error.message);
      continue;
    }
    for (const row of (data ?? []) as CacheRow[]) {
      if (!row?.symbol || !Array.isArray(row.bars)) continue;
      if (!isFresh(row.fetched_at)) continue;
      out.set(row.symbol, row.bars);
    }
  }
  return out;
}

/**
 * Bulk upsert cache rows. Chunked to keep each Postgres call small.
 */
export async function writeBarCache(entries: Array<{ symbol: string; bars: Bar[] }>): Promise<void> {
  if (entries.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();
  const rows = entries
    .filter((e) => e.bars.length > 0)
    .map((e) => ({
      symbol: e.symbol,
      as_of: e.bars[0]?.datetime ?? new Date().toISOString().slice(0, 10),
      bars: e.bars,
      bar_count: e.bars.length,
      fetched_at: now,
    }));

  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from("future_leaders_bar_cache")
      .upsert(chunk, { onConflict: "symbol" });
    if (error) console.error(`[bar-cache] upsert chunk ${i} failed:`, error.message);
  }
}
