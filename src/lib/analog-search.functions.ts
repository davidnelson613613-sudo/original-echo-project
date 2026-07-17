import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AnalogSearchResult, MarketPhase } from "./analog-search.server";
import { buildProbabilityReport } from "./analog-probabilities";
import { buildWaitVsBuy } from "./wait-vs-buy";
import { buildScenarios } from "./analog-scenarios";

const inputSchema = z.object({
  symbol: z.string().min(1).max(12),
});

type CacheEntry = { at: number; goodUntil: number; outcome: AnalogOutcome };
const cache = new Map<string, CacheEntry>();
const CACHE_VERSION = "provider-v4-real-path";
// Short retry window for transient errors so a rate-limited scan recovers
// on the next tick instead of being frozen for hours.
const ERROR_TTL_MS = 60 * 1000;
// Empty results (symbol genuinely has no comparable dip or no data) are
// stable for the whole session — cache for 12h to stop re-burning credits
// probing something TwelveData can't help with.
const EMPTY_TTL_MS = 12 * 60 * 60 * 1000;

type Bars = Awaited<ReturnType<typeof import("./analog-search.server").fetchLongHistory>>;
export type BarSource = "yahoo" | "stooq" | "cache";
type HistoryEntry = { at: number; bars: Bars; goodUntil: number; source: BarSource };
const historyCache = new Map<string, HistoryEntry>();
// A tagged outcome from the long-history fetcher lets callers distinguish
// "TwelveData genuinely has no bars" from "our fetch failed / rate-limited".
type BarsOutcome =
  | { kind: "ok"; bars: Bars; source: BarSource }
  | { kind: "stale"; bars: Bars; source: BarSource }
  | { kind: "empty" }
  | { kind: "error" };
// Coalesce concurrent fetches for the same symbol so parallel scans share
// a single upstream request instead of racing and each burning a credit.
const inFlight = new Map<string, Promise<BarsOutcome>>();

// Daily bars only finalize once per trading day (after 4pm ET). Cache each
// symbol until the *next* US market close so within a session we hit
// TwelveData at most once per symbol. If the worker cold-starts mid-day
// the cache repopulates lazily on first use.
function nextMarketCloseMs(now = Date.now()): number {
  // 4:05pm ET (small buffer for late prints). ET = UTC-5 (EST) / UTC-4 (EDT).
  // Use a simple DST heuristic: Mar 2nd Sun .. Nov 1st Sun => EDT.
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
  const closeUTCHour = isEDT ? 20 : 21; // 16:05 ET
  let close = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), closeUTCHour, 5, 0);
  if (close <= now) close += 24 * 60 * 60 * 1000; // roll to next day
  // Skip weekends: Sat=6, Sun=0
  while (true) {
    const dow = new Date(close).getUTCDay();
    if (dow === 6) close += 2 * 24 * 60 * 60 * 1000;
    else if (dow === 0) close += 1 * 24 * 60 * 60 * 1000;
    else break;
  }
  return close;
}

// True when US regular session is open (9:30–16:00 ET, Mon–Fri).
function isUsMarketOpen(now = Date.now()): boolean {
  const et = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const m = et.getHours() * 60 + et.getMinutes();
  return m >= 9 * 60 + 30 && m < 16 * 60;
}

// Refresh cadence for intraday analog re-scans. During market hours we want
// the current-day fingerprint (which folds in today's live price) to be
// re-evaluated every 60s so the closest historical match tracks live conditions.
// After the close, daily bars are final — cache until the next session close.
function analogCacheUntil(now = Date.now()): number {
  return isUsMarketOpen(now) ? now + 60_000 : nextMarketCloseMs(now);
}

// Negative cache for symbols TwelveData doesn't cover / rate-limits repeatedly.
// Without this, every 60-second scanner tick would re-hit the deep-history
// endpoint for the same missing symbol and keep burning credits.
type NegEntry = { until: number; kind: "empty" | "error" };
const negCache = new Map<string, NegEntry>();
const NEG_EMPTY_TTL_MS = 12 * 60 * 60 * 1000; // 12h — symbol has no history
const NEG_ERROR_TTL_MS = 5 * 60 * 1000;       // 5m — transient fetch failure

async function loadBars(symbol: string): Promise<BarsOutcome> {
  const cacheKey = `${CACHE_VERSION}:${symbol.toUpperCase()}`;
  const now = Date.now();
  const hit = historyCache.get(cacheKey);
  if (hit && now < hit.goodUntil) return { kind: "ok", bars: hit.bars, source: hit.source };

  const neg = negCache.get(cacheKey);
  if (neg && now < neg.until) {
    return neg.kind === "empty"
      ? { kind: "empty" }
      : hit
        ? { kind: "stale", bars: hit.bars, source: hit.source }
        : { kind: "error" };
  }

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const p = (async (): Promise<BarsOutcome> => {
    let providerError = false;
    try {
      const mod = await import("./analog-search.server");
      let fresh: Awaited<ReturnType<typeof mod.fetchLongHistory>> | null = null;
      let freshSource: BarSource = "yahoo";
      try {
        const { fetchYahooDaily } = await import("./yahoo.server");
        const yh = await fetchYahooDaily(symbol);
        if (yh.length > 0) { fresh = yh; freshSource = "yahoo"; }
      } catch {
        providerError = true;
      }
      // Fallback to Stooq (free, no key, 20+ years) if Yahoo failed or was thin.
      if (!fresh || fresh.length < 300) {
        try {
          const { fetchStooqDaily } = await import("./stooq.server");
          const stooq = await fetchStooqDaily(symbol);
          if (stooq.length > (fresh?.length ?? 0)) { fresh = stooq; freshSource = "stooq"; }
        } catch {
          providerError = true;
          /* keep whatever Yahoo gave us */
        }
      }

      if (!fresh || fresh.length === 0) {
        if (providerError) {
          negCache.set(cacheKey, { until: now + NEG_ERROR_TTL_MS, kind: "error" });
          return hit ? { kind: "stale", bars: hit.bars, source: hit.source } : { kind: "error" };
        }
        negCache.set(cacheKey, { until: now + NEG_EMPTY_TTL_MS, kind: "empty" });
        return { kind: "empty" };
      }
      if (fresh.length < 300) {
        if (providerError) {
          negCache.set(cacheKey, { until: now + NEG_ERROR_TTL_MS, kind: "error" });
          return hit ? { kind: "stale", bars: hit.bars, source: hit.source } : { kind: "error" };
        }
        negCache.set(cacheKey, { until: now + NEG_EMPTY_TTL_MS, kind: "empty" });
        return { kind: "empty" };
      }
      historyCache.set(cacheKey, { at: now, bars: fresh, goodUntil: analogCacheUntil(now), source: freshSource });
      negCache.delete(cacheKey);
      return { kind: "ok", bars: fresh, source: freshSource };
    } catch {
      negCache.set(cacheKey, { until: now + NEG_ERROR_TTL_MS, kind: "error" });
      return hit ? { kind: "stale", bars: hit.bars, source: hit.source } : { kind: "error" };
    } finally {
      inFlight.delete(cacheKey);
    }
  })();
  inFlight.set(cacheKey, p);
  return p;

}

// Tagged outcome so the UI can distinguish a genuine "no comparable dip
// exists" from "we couldn't run the search right now" (rate limit, timeout,
// missing keys). Previously both collapsed into `null`.
export type AnalogOutcome =
  | { status: "ok"; result: AnalogSearchResult; dataSource: BarSource }
  | { status: "empty"; reason: "insufficient_history" | "no_matches" | "insufficient_evidence"; sampleSize?: number }
  | { status: "error"; reason: "no_keys" | "fetch_failed" };

// Shared analog-search pipeline. Used by the exported ServerFn (UI panel) AND
// by scanUniverse to fold historical evidence into the live recommendation
// for each qualifying symbol.
export async function computeAnalogFor(symbol: string): Promise<AnalogOutcome> {
  // No key gate: Stooq provides keyless 20+ year daily history as fallback.
  const cacheKey = `${CACHE_VERSION}:${symbol.toUpperCase()}`;


  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.goodUntil) return cached.outcome;

  const now = Date.now();
  // Daily-bar analog outputs are stable until the next US market close;
  // successful results are cached that long instead of the old 60s window,
  // which used to re-run the full search every scanner tick even though
  // nothing could have changed. Empty/error outcomes get their own TTLs.
  const okUntil = analogCacheUntil(now);
  const store = (outcome: AnalogOutcome): AnalogOutcome => {
    const ttl =
      outcome.status === "ok"
        ? okUntil - now
        : outcome.status === "empty"
          ? EMPTY_TTL_MS
          : ERROR_TTL_MS;
    cache.set(cacheKey, { at: now, goodUntil: now + ttl, outcome });
    return outcome;
  };

  const mod = await import("./analog-search.server");
  const {
    computeAllFeatures, attachMarketContext, buildBenchmarkIndex, buildSectorIndex,
    searchAnalogs, SECTOR_PROXY, RELATED_SYMBOLS,
  } = mod;

  const sectorSym = SECTOR_PROXY[symbol] ?? "SPY";
  // Analog search is restricted to the primary symbol's OWN history.
  // Pooling sibling ETFs (e.g. SMH/SOXQ/XSD for SOXX) was producing
  // "best match" hits on the wrong ticker, which is misleading — a
  // "Full-History Analog · SOXX" panel must only surface SOXX dates.
  const relatedList: string[] = [];
  void RELATED_SYMBOLS;

  // Fan out every bar fetch in parallel — loadBars coalesces duplicates and
  // reuses the day-cache, so cold-start latency drops from ~N× to ~1× the
  // slowest fetch without spending any extra credits.
  const uniqueExtras = Array.from(new Set([sectorSym, ...relatedList].filter((s) => s !== symbol && s !== "SPY")));
  const [primary, spyOut, sectorOut, ...relatedOuts] = await Promise.all([
    loadBars(symbol),
    loadBars("SPY"),
    sectorSym === "SPY" ? Promise.resolve(null as BarsOutcome | null) : loadBars(sectorSym),
    ...relatedList.map((s) => loadBars(s)),
  ]);

  void uniqueExtras;

  if (primary.kind === "error") return store({ status: "error", reason: "fetch_failed" });
  if (primary.kind === "empty") return store({ status: "empty", reason: "insufficient_history" });
  const primaryBars = primary.bars;
  if (primaryBars.length < 300) return store({ status: "empty", reason: "insufficient_history" });

  const primaryFeatures = computeAllFeatures(primaryBars);
  const spyBars = spyOut.kind === "ok" || spyOut.kind === "stale" ? spyOut.bars : null;
  const sectorBars: Bars | null =
    sectorSym === "SPY"
      ? spyBars
      : sectorOut && (sectorOut.kind === "ok" || sectorOut.kind === "stale")
        ? sectorOut.bars
        : null;

  // Precompute market-context indices ONCE and reuse across primary + extras.
  let spyIdx: ReturnType<typeof buildBenchmarkIndex> | null = null;
  let secIdx: ReturnType<typeof buildSectorIndex> | null = null;
  if (spyBars && spyBars.length > 300) {
    spyIdx = buildBenchmarkIndex(spyBars);
    secIdx = sectorBars && sectorBars.length > 300 ? buildSectorIndex(sectorBars) : null;
    attachMarketContext(primaryFeatures, primaryBars, {
      spy: spyIdx.quick,
      sector: secIdx,
      spyReturns: spyIdx.dailyRet,
      symReturns: () => undefined,
    });
  }

  const extras: Array<{ symbol: string; bars: Bars; features: ReturnType<typeof computeAllFeatures>; isSameSymbol: boolean }> = [];
  for (let i = 0; i < relatedList.length; i++) {
    const relSym = relatedList[i];
    const relOut = relatedOuts[i];
    const relBars = relOut && (relOut.kind === "ok" || relOut.kind === "stale") ? relOut.bars : null;
    if (!relBars || relBars.length < 300) continue;
    const relFeatures = computeAllFeatures(relBars);
    if (spyIdx) {
      attachMarketContext(relFeatures, relBars, {
        spy: spyIdx.quick,
        sector: null,
        spyReturns: spyIdx.dailyRet,
        symReturns: () => undefined,
      });
    }
    extras.push({ symbol: relSym, bars: relBars, features: relFeatures, isSameSymbol: false });
  }

  const result = searchAnalogs(
    symbol,
    { bars: primaryBars, features: primaryFeatures },
    extras,
    { topK: 8, excludeRecentDays: 120 },
  );

  if (!result || result.aggregate.count === 0) {
    return store({ status: "empty", reason: "no_matches" });
  }
  // Phase-2 explicit low-evidence gate: require ≥4 qualifying analogs before
  // we surface probabilities and scenarios. Below that, distributions are
  // dominated by 1-2 idiosyncratic dates and misleadingly narrow.
  if (result.aggregate.count < 4) {
    return store({ status: "empty", reason: "insufficient_evidence", sampleSize: result.aggregate.count });
  }
  const dataSource: BarSource = primary.kind === "stale" ? primary.source : primary.source;
  return store({ status: "ok", result, dataSource });
}

// Compact evidence digest consumed by the recommendation engine
// (evaluateSignal + assessRisk). Kept intentionally small and pure so it can
// be attached to ScanRow DTOs without ballooning payload size.
export type AnalogEvidence = {
  bestDate: string;
  bestSymbol: string;
  isSameSymbol: boolean;
  similarity: number;               // 0..100
  sampleSize: number;
  probBottomIn: number;             // 0..1
  probReversal: number;             // 0..1
  probContinuedDecline: number;     // 0..1
  recoveryRate: number;             // 0..1
  failureRate: number;              // 0..1
  expectedRemainingDownsidePct: number; // negative % (0 if bottom likely in)
  meanFwd30: number | null;
  meanFwd90: number | null;
  agreement: number;                // 0..1
  confidence: number;               // 0..100
  favorability: "favorable" | "mixed" | "unfavorable";
  favorabilityScore: number;        // -100..100
  phase: MarketPhase;
  // Enriched historical-probability report (Phase-1 upgrade — see
  // src/lib/analog-probabilities.ts, wait-vs-buy.ts, analog-scenarios.ts).
  // Optional so legacy consumers keep working.
  probabilityReport?: import("./analog-probabilities").ProbabilityReport;
  waitVsBuy?: import("./wait-vs-buy").WaitVsBuyReport;
  scenarios?: import("./analog-scenarios").ScenarioReport;
};

export function evidenceFromResult(r: AnalogSearchResult): AnalogEvidence {
  const a = r.aggregate;
  // Lazy build of the enriched report so payload growth is opt-in per caller
  // (we always build here — it's cheap, all in-memory over top-K matches).
  // Static imports live at module scope to keep the DTO synchronous.
  const probabilityReport = buildProbabilityReport(r);
  const waitVsBuy = buildWaitVsBuy(probabilityReport);
  const scenarios = buildScenarios(r);
  return {
    bestDate: r.best.date,
    bestSymbol: r.best.symbol,
    isSameSymbol: r.best.isSameSymbol,
    similarity: r.best.similarity,
    sampleSize: a.count,
    probBottomIn: a.probBottomIn,
    probReversal: a.probReversal,
    probContinuedDecline: a.probContinuedDecline,
    recoveryRate: a.recoveryRate,
    failureRate: r.failureAnalysis.failureRate,
    expectedRemainingDownsidePct: a.expectedRemainingDownside,
    meanFwd30: a.meanFwd30,
    meanFwd90: a.meanFwd90,
    agreement: a.agreement,
    confidence: a.confidenceOverall,
    favorability: r.traderAnswers.favorability,
    favorabilityScore: r.traderAnswers.favorabilityScore,
    phase: r.marketPhase,
    probabilityReport,
    waitVsBuy,
    scenarios,
  };
}

export const findHistoricalAnalog = createServerFn({ method: "GET" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<AnalogOutcome> => {
    return computeAnalogFor(data.symbol);

  });
