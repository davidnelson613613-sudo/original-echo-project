// Session-scoped cache for the primary market scan.
//
// Why this exists: `scanUniverse()` takes several seconds on a cold fetch
// (server function → Yahoo/Twelve/Finnhub fan-out). Without a cache, every
// time the user returns to the terminal tab they stare at a skeleton until
// the round-trip completes. With this cache, we show the last scan
// immediately and revalidate in the background — the app feels instant on
// re-entry.
//
// sessionStorage (not localStorage) intentionally: scan data is
// short-lived and per-tab. A one-hour hard TTL keeps overnight/next-day
// tabs from showing wildly stale prices as "instant" data.

import type { ScanResult } from "@/lib/market.functions";

const KEY = "laddrx:scan:v1";
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour hard ceiling

type Cached = { data: ScanResult; savedAt: number };

export function readCachedScan(): Cached | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed?.data || !parsed?.savedAt) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedScan(data: ScanResult): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ data, savedAt: Date.now() } satisfies Cached),
    );
  } catch {
    /* quota exceeded — ignore, next paint will just be a skeleton */
  }
}
