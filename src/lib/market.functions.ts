import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Focused watchlist: NASDAQ 100 + semiconductor ETFs.
export const UNIVERSE_SYMBOLS = [
  "NDX",   // NASDAQ 100 Index (spot)
  "QQQ",   // NASDAQ 100 ETF
  "SMH",   // VanEck Semi
  "SOXX",  // iShares Semi
  "SOXQ",  // Invesco Semi
  "NVDA",  // NVIDIA Corp.
] as const;

// Additional context symbols (fetched but not scored/sorted)
const CONTEXT_SYMBOLS = ["SPY"] as const;

export type UniverseSymbol = (typeof UNIVERSE_SYMBOLS)[number];

const inputSchema = z.object({
  symbol: z.enum(UNIVERSE_SYMBOLS),
});

export type MarketSnapshotDTO = {
  symbol: string;
  price: number;
  change1d: number;
  change3d: number;
  change5d: number;
  atr14: number;
  ema9: number;
  sma20: number;
  sma50: number;
  sma200: number;
  high20: number;
  high60: number;
  asOf: string;
};

export type IntradayDTO = {
  currentPrice: number;
  sessionOpen: number;
  sessionHigh: number;
  sessionLow: number;
  dropFromOpenPct: number;
  dropFromHighPct: number;
  bounceFromLowPct: number;
  dropSpeedPctPerHour: number;
  rsi5m: number | null;
  volumeRatioVsAvg: number | null;
  lastCandleGreen: boolean;
  reversalCandle: boolean;
  redBarStreak: number;
  minutesElapsed: number;
  asOf: string;
} | null;

export type RegimeDTO =
  | "NO_DIP"
  | "FAKE_OUT"
  | "FAST_CRASH"
  | "SLOW_BLEED"
  | "V_BOUNCE_LIKELY"
  | "SUPPORT_TEST";

export type SignalStatusDTO = "WATCH" | "PROBE" | "BUY_STARTER" | "BUY_LADDER";
export type RiskLevelDTO = "LOW" | "MEDIUM" | "HIGH";
export type MarketContextDTO = "STRONG" | "NEUTRAL" | "WEAK" | "BROAD_SELLOFF";
export type ScenarioKeyDTO = "HEAVY_SUPPORT" | "BASELINE_FLUSH" | "SLOW_BLEED" | "V_BOUNCE" | "WAITING";

export type DecisionStepDTO = { label: string; done: boolean };

export type RungDTO = { pct: number; price: number; label: string; reason: string };

export type FactorListDTO = { positive: string[]; negative: string[] };

// Why the analog search for a row is missing evidence. Used by the UI to
// distinguish "no comparable dip exists" from "we couldn't run the search".
export type AnalogStatusDTO =
  | "ok"
  | "empty_no_matches"
  | "empty_insufficient_history"
  | "error_rate_limited"
  | "error_timeout"
  | "error_no_keys"
  | "skipped_quiet";

// Ladder-level guards. Consumers show these badges on the row and use them
// to short-circuit auto-fill (earnings) or reason about spacing (gap).
export type LadderFlagsDTO = {
  gapAdjusted: boolean;
  gapPct: number | null; // signed % (negative = gap down)
  earningsBlocked: boolean;
  earningsWithinDays: number | null;
  earningsDate: string | null;
};

export type ScanRow = MarketSnapshotDTO & {
  name: string;
  group: string;
  score: number;
  reasons: string[];
  distSma50Pct: number;
  distSma200Pct: number;
  drawdown20Pct: number;
  drawdown60Pct: number;
  intraday: IntradayDTO;
  rsiDaily: number | null;
  regime: RegimeDTO;
  regimeLabel: string;
  regimeExplanation: string;
  regimeReasons: string[];
  confidence: number;
  setupQuality: number;
  executionConfidence: number;
  secondaryRegime: RegimeDTO | null;
  secondaryRegimeLabel: string | null;
  decisionPath: DecisionStepDTO[];
  status: SignalStatusDTO;
  statusReason: string;
  watchingFor: string[];
  adaptiveLadder: RungDTO[];
  spyChangePct: number | null;
  // ── Unified engine additions ──
  riskLevel: RiskLevelDTO;
  riskReasons: string[];
  marketContext: MarketContextDTO;
  marketContextNote: string;
  setupFactors: FactorListDTO;
  executionFactors: FactorListDTO;
  scenarioKey: ScenarioKeyDTO;
  scenarioTitle: string;
  scenarioWhy: string;
  decisionId: string;
  analog: import("./analog-search.functions").AnalogEvidence | null;
  analogStatus: AnalogStatusDTO;
  ladderFlags: LadderFlagsDTO;
  isQualifiedDip: boolean;

};

export type ScanResult = {
  rows: ScanRow[];
  scannedAt: string;
  failed: string[];
  spyChangePct: number | null;
  warning?: string;
};

export const getMarketSnapshot = createServerFn({ method: "GET" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<MarketSnapshotDTO> => {
    const { withRotatingKey, hasAnyKey } = await import("./twelvedata-keys.server");
    if (!hasAnyKey()) throw new Error("Server is missing TWELVEDATA_API_KEY.");
    const { fetchTimeSeries, computeSnapshot } = await import("./market.server");
    const bars = await withRotatingKey((key) => fetchTimeSeries(data.symbol, key));
    return computeSnapshot(data.symbol, bars);
  });

// Module-level cache
type CachedBars = Record<string, Awaited<ReturnType<typeof import("./market.server").fetchTimeSeriesBatch>>[string]>;
let barsCache: { at: number; data: CachedBars } | null = null;
let intradayCache: { at: number; data: CachedBars } | null = null;
const DAILY_TTL_MS = 60_000;
const INTRADAY_TTL_MS = 60_000; // Refresh intraday every 60s during use

const scanInputSchema = z.object({ force: z.boolean().optional() }).optional();

// ── Stale-while-revalidate cache for scanUniverse ────────────────────────
// Cold scans take ~8–12s (Yahoo + intraday + analog gating). Without this,
// every fresh browser tab pays that full cost before first paint. With SWR:
// if a cached scan exists we return it in microseconds and re-run the scan
// in the background so the next request already has fresh data.
//
// FRESH_MS: return cache without triggering revalidation.
// STALE_MS: return cache immediately, kick off background refresh.
// After STALE_MS: caller has to await a real scan.
let scanCache: { at: number; data: ScanResult } | null = null;
let scanInFlight: Promise<ScanResult> | null = null;
const SCAN_FRESH_MS = 15_000;
const SCAN_STALE_MS = 5 * 60_000;

export const scanUniverse = createServerFn({ method: "GET" })
  .inputValidator((data) => scanInputSchema.parse(data))
  .handler(async ({ data }): Promise<ScanResult> => {
    const force = data?.force === true;
    if (!force && scanCache) {
      const age = Date.now() - scanCache.at;
      if (age < SCAN_FRESH_MS) return scanCache.data;
      if (age < SCAN_STALE_MS) {
        // Background revalidate; do not await.
        if (!scanInFlight) {
          scanInFlight = runScan(false).then((r) => { scanCache = { at: Date.now(), data: r }; scanInFlight = null; return r; })
            .catch((e) => { scanInFlight = null; throw e; });
          scanInFlight.catch(() => {});
        }
        return scanCache.data;
      }
    }
    // Coalesce concurrent cold requests onto a single in-flight scan.
    if (!force && scanInFlight) return scanInFlight;
    const p = runScan(force).then((r) => { scanCache = { at: Date.now(), data: r }; scanInFlight = null; return r; })
      .catch((e) => { scanInFlight = null; throw e; });
    scanInFlight = p;
    return p;
  });

async function runScan(force: boolean): Promise<ScanResult> {
  {
    const { withRotatingKey, hasAnyKey } = await import("./twelvedata-keys.server");
    // TwelveData is now a fallback only; Yahoo Finance serves the primary
    // path. Missing TD keys no longer blocks the scan.
    void hasAnyKey;
    const {
      fetchTimeSeriesBatch,
      fetchIntradayBatch,
      fetchYahooDaily,
      fetchYahooIntraday,
      isYahooOnly,
      computeSnapshot,
      computeIntradayMetrics,
      rsiWilder,
      scoreDip,
      classifyRegime,
      buildAdaptiveLadder,
      evaluateSignal,
      assessRisk,
      assessMarketContext,
      regimeToScenario,
      SCENARIO_META,
      REGIME_META,
      ASSET_META,
    } = await import("./market.server");

    const universe = [...UNIVERSE_SYMBOLS];
    const allSymbols = [...universe, ...CONTEXT_SYMBOLS];
    // Yahoo is the primary source for daily bars, intraday bars, and live
    // quotes. TwelveData is used only for symbols Yahoo failed to deliver.
    // This preserves the exact bar/quote shape (Yahoo has been the fallback
    // path for months) while dramatically reducing TwelveData rate-limit
    // pressure so the always-on scan loop keeps running overnight.
    const fetchYahooDailyMap = async (symbols: string[]): Promise<CachedBars> => {
      const entries = await Promise.all(
        Array.from(new Set(symbols)).map(async (s) => {
          try { return [s, await fetchYahooDaily(s, 250)] as const; }
          catch { return [s, null] as const; }
        }),
      );
      const out: CachedBars = {};
      for (const [s, bars] of entries) if (bars && bars.length) out[s] = bars;
      return out;
    };
    const fetchYahooIntradayMap = async (symbols: string[]): Promise<CachedBars> => {
      const entries = await Promise.all(
        Array.from(new Set(symbols)).map(async (s) => {
          try { return [s, await fetchYahooIntraday(s, "5min", 90)] as const; }
          catch { return [s, null] as const; }
        }),
      );
      const out: CachedBars = {};
      for (const [s, bars] of entries) if (bars && bars.length) out[s] = bars;
      return out;
    };

    let rateLimitWarning: string | null = null;
    const isRateLimited = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return msg.includes("429") || msg === "RATE_LIMIT" || /rate limit/i.test(msg);
    };

    const dailyPromise = (async (): Promise<CachedBars> => {
      if (!force && barsCache && Date.now() - barsCache.at < DAILY_TTL_MS) return barsCache.data;
      // Yahoo first, for every symbol.
      const fresh: CachedBars = await fetchYahooDailyMap(allSymbols);
      // TwelveData covers only what Yahoo couldn't, and only for symbols TD
      // can serve (skips index symbols like ^NDX).
      const missing = allSymbols.filter((s) => !fresh[s]?.length && !isYahooOnly(s));
      if (missing.length) {
        try {
          const td = await withRotatingKey((key) => fetchTimeSeriesBatch(missing, key));
          Object.assign(fresh, td);
        } catch (e) {
          if (isRateLimited(e)) rateLimitWarning = "Twelve Data rate limit hit — using Yahoo only.";
        }
      }
      if (Object.keys(fresh).length > 0) {
        const merged = { ...(barsCache?.data ?? {}), ...fresh };
        barsCache = { at: Date.now(), data: merged };
        return merged;
      }
      return barsCache?.data ?? {};
    })();

    const intradayPromise = (async (): Promise<CachedBars> => {
      if (!force && intradayCache && Date.now() - intradayCache.at < INTRADAY_TTL_MS) return intradayCache.data;
      const fresh: CachedBars = await fetchYahooIntradayMap(allSymbols);
      const missing = allSymbols.filter((s) => !fresh[s]?.length && !isYahooOnly(s));
      if (missing.length) {
        try {
          const td = await withRotatingKey((key) => fetchIntradayBatch(missing, key, "5min", 90));
          Object.assign(fresh, td);
        } catch (e) {
          if (isRateLimited(e)) rateLimitWarning = "Twelve Data rate limit hit — using Yahoo only.";
        }
      }
      if (Object.keys(fresh).length > 0) {
        const merged = { ...(intradayCache?.data ?? {}), ...fresh };
        intradayCache = { at: Date.now(), data: merged };
        return merged;
      }
      return intradayCache?.data ?? {};
    })();

    const quotePromise = (async (): Promise<Record<string, import("./quote.server").Quote>> => {
      const out: Record<string, import("./quote.server").Quote> = {};
      // Yahoo first for every symbol (indices and equities alike).
      try {
        const { fetchYahooQuoteBatch } = await import("./yahoo-quote.server");
        Object.assign(out, await fetchYahooQuoteBatch(allSymbols));
      } catch { /* fall through */ }
      // Finnhub fills equity gaps (indices are Yahoo-only).
      const missingAfterYahoo = allSymbols.filter((s) => !out[s] && !isYahooOnly(s));
      if (missingAfterYahoo.length) {
        try {
          const { fetchFinnhubQuoteBatch, hasFinnhubKey } = await import("./finnhub-quote.server");
          if (hasFinnhubKey()) Object.assign(out, await fetchFinnhubQuoteBatch(missingAfterYahoo));
        } catch { /* optional */ }
      }
      // TwelveData last resort.
      const stillMissing = allSymbols.filter((s) => !out[s] && !isYahooOnly(s));
      if (stillMissing.length) {
        try {
          const { fetchQuoteBatch } = await import("./quote.server");
          Object.assign(out, await withRotatingKey((key) => fetchQuoteBatch(stillMissing, key)));
        } catch (e) {
          if (isRateLimited(e)) rateLimitWarning = "Twelve Data rate limit hit — quotes from Yahoo only.";
        }
      }
      return out;
    })();

    let barsMap: CachedBars = {};
    let intradayMap: CachedBars = {};
    let quoteMap: Record<string, import("./quote.server").Quote> = {};
    try {
      [barsMap, intradayMap, quoteMap] = await Promise.all([dailyPromise, intradayPromise, quotePromise]);
    } catch (e) {
      if (isRateLimited(e)) {
        return {
          rows: [],
          scannedAt: new Date().toISOString(),
          failed: [...universe],
          spyChangePct: null,
          warning:
            "Twelve Data rate limit hit. Free tier allows 8 requests/minute — wait ~60 seconds and retry.",
        };
      }
      throw e instanceof Error ? e : new Error(String(e));
    }


    // SPY context
    let spyChangePct: number | null = null;
    const spyQuote = quoteMap["SPY"];
    const spyId = intradayMap["SPY"];
    const spyDaily = barsMap["SPY"];
    if (spyQuote && spyDaily && spyDaily.length >= 2) {
      spyChangePct = ((spyQuote.price - spyDaily[1].close) / spyDaily[1].close) * 100;
    } else if (spyId && spyDaily && spyDaily.length >= 2) {
      const spyMetrics = computeIntradayMetrics(spyId, spyDaily[1].close);
      spyChangePct = spyMetrics ? ((spyMetrics.currentPrice - spyDaily[1].close) / spyDaily[1].close) * 100 : null;
    } else if (spyDaily && spyDaily.length >= 2) {
      spyChangePct = ((spyDaily[0].close - spyDaily[1].close) / spyDaily[1].close) * 100;
    }

    const rows: ScanRow[] = [];
    const failed: string[] = [];
    const scannedAtIso = new Date().toISOString();

    // ── Pass 1: compute base snapshot / regime / scored for every symbol ──
    type Pending = {
      sym: string;
      snap: ReturnType<typeof computeSnapshot>;
      scored: ReturnType<typeof scoreDip>;
      intraday: ReturnType<typeof computeIntradayMetrics> | null;
      rsiDaily: number | null;
      cls: ReturnType<typeof classifyRegime>;
      meta: { name: string; group: string };
    };
    const pending: Pending[] = [];

    for (const sym of universe) {
      try {
        const bars = barsMap[sym];
        if (!bars || bars.length < 201) { failed.push(sym); continue; }
        const snap = computeSnapshot(sym, bars);

        // Overlay a live quote onto the daily snapshot when available.
        // We refresh snap.price + change1d and let scoreDip's already-computed
        // structural fields (distSma*, drawdown*, high20/60) stand — those
        // rely on the trailing bars and don't change on a 15s cadence.
        const q = quoteMap[sym];
        const priorCloseDaily = bars[1]?.close ?? snap.price;
        if (q && priorCloseDaily > 0) {
          snap.price = q.price;
          snap.change1d = ((q.price - priorCloseDaily) / priorCloseDaily) * 100;
        }

        const scored = scoreDip(snap);

        const meta = ASSET_META[sym] ?? { name: sym, group: "Other" };

        const idBars = intradayMap[sym];
        const priorClose = bars[1]?.close ?? snap.price;
        const intraday = idBars ? computeIntradayMetrics(idBars, priorClose) : null;
        if (intraday && q) {
          // Refresh live-derived fields; keep session extremes from the bar data
          // and only widen them if the live price is outside the recorded range.
          intraday.currentPrice = q.price;
          intraday.sessionHigh = Math.max(intraday.sessionHigh, q.price);
          intraday.sessionLow = Math.min(intraday.sessionLow, q.price);
          if (intraday.sessionOpen > 0) {
            intraday.dropFromOpenPct = ((q.price - intraday.sessionOpen) / intraday.sessionOpen) * 100;
          }
          if (intraday.sessionHigh > 0) {
            intraday.dropFromHighPct = ((q.price - intraday.sessionHigh) / intraday.sessionHigh) * 100;
          }
          if (intraday.sessionLow > 0) {
            intraday.bounceFromLowPct = ((q.price - intraday.sessionLow) / intraday.sessionLow) * 100;
          }
        }

        const dailyClosesAsc = [...bars].reverse().map((b) => b.close);
        const rsiDaily = rsiWilder(dailyClosesAsc, 14);

        const cls = classifyRegime({
          snapshot: snap,
          intraday,
          rsiDaily,
          spyChangePct,
          drawdown20Pct: scored.drawdown20Pct,
          drawdown60Pct: scored.drawdown60Pct,
          distSma50Pct: scored.distSma50Pct,
          distSma200Pct: scored.distSma200Pct,
        });
        pending.push({ sym, snap, scored, intraday, rsiDaily, cls, meta });
      } catch {
        failed.push(sym);
      }
    }

    // ── Historical analog gate ──
    // Run the pattern-recognition scanner for symbols that show a meaningful
    // move or non-flat regime. Skip flat/quiet symbols to conserve rate limits
    // on the deep-history endpoint. Results are cached inside computeAnalogFor
    // (60s result / 12h history) so the second scan warms instantly.
    const shouldAnalog = (p: Pending): boolean => {
      const greenOrFlatToday = p.snap.change1d >= -0.05;
      const notSellingOffIntraday = !p.intraday || p.intraday.dropFromOpenPct >= -0.4;
      if (greenOrFlatToday && notSellingOffIntraday) return false;
      if (p.cls.regime !== "NO_DIP") return true;
      if (Math.abs(p.snap.change1d) >= 1.5) return true;
      if (Math.abs(p.snap.change5d) >= 4) return true;
      if (p.scored.drawdown60Pct <= -4) return true;
      // Broad-market stress lifts the gate for everything (rotation / regime shift)
      if (spyChangePct !== null && spyChangePct <= -1) return true;
      return false;
    };
    const analogTargets = pending.filter(shouldAnalog);
    type AnalogRow = {
      evidence: import("./analog-search.functions").AnalogEvidence | null;
      status: AnalogStatusDTO;
    };
    const analogByS = new Map<string, AnalogRow>();
    if (analogTargets.length) {
      const { computeAnalogFor, evidenceFromResult } = await import("./analog-search.functions");
      // Time-box each analog so a slow cold fetch never stalls the scan.
      // 12s is enough for a cold long-history fetch; subsequent scans hit
      // the in-memory cache (valid until next market close) instantly.
      // The old 4s cap was timing out on cold starts and leaving row.analog
      // null, which silently disabled the analog-derived ladder/probability
      // chips even though the standalone panel later loaded fine.
      const TIMED_OUT = Symbol("timed_out");
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> =>
        Promise.race<T | typeof TIMED_OUT>([
          p,
          new Promise<typeof TIMED_OUT>((res) => setTimeout(() => res(TIMED_OUT), ms)),
        ]);
      const results = await Promise.all(
        analogTargets.map(async (p) => {
          try {
            const r = await withTimeout(computeAnalogFor(p.sym), 12_000);
            if (r === TIMED_OUT) {
              return [p.sym, { evidence: null, status: "error_timeout" as const }] as const;
            }
            if (r.status === "ok") {
              return [p.sym, { evidence: evidenceFromResult(r.result), status: "ok" as const }] as const;
            }
            if (r.status === "empty") {
              const status: AnalogStatusDTO =
                r.reason === "insufficient_history"
                  ? "empty_insufficient_history"
                  : "empty_no_matches";
              return [p.sym, { evidence: null, status }] as const;
            }
            // status === "error"
            const status: AnalogStatusDTO =
              r.reason === "no_keys" ? "error_no_keys" : "error_rate_limited";
            return [p.sym, { evidence: null, status }] as const;
          } catch {
            return [p.sym, { evidence: null, status: "error_rate_limited" as const }] as const;
          }
        }),
      );
      for (const [sym, row] of results) analogByS.set(sym, row);
    }

    // ── Earnings guard (best-effort, Yahoo) ──
    // Any equity in the universe with earnings within the next 5 trading
    // days gets its ladder blocked. ETFs and indexes correctly resolve to
    // no upcoming earnings and are unaffected. Failures are silent.
    const earningsByS = new Map<string, { info: import("./earnings.server").EarningsInfo | null }>();
    try {
      const { fetchNextEarnings } = await import("./earnings.server");
      const results = await Promise.all(
        pending.map(async (p) => {
          try {
            const info = await fetchNextEarnings(p.sym);
            return [p.sym, { info }] as const;
          } catch {
            return [p.sym, { info: null }] as const;
          }
        }),
      );
      for (const [sym, row] of results) earningsByS.set(sym, row);
    } catch {
      /* earnings guard optional — silent skip on module load failure */
    }

    // ── Pass 2: evaluate signal + risk (with analog evidence) and emit row ──
    for (const p of pending) {
      try {
        const { sym, snap, scored, intraday, rsiDaily, cls, meta } = p;
        const regMeta = REGIME_META[cls.regime];
        const analogRow = analogByS.get(sym);
        const analog = analogRow?.evidence ?? null;
        const analogStatus: AnalogStatusDTO = analogRow?.status ?? "skipped_quiet";

        // ── Gap-down detection ──
        // Compare today's session open (from intraday bars) to yesterday's close.
        // A gap ≤ -1.5*ATR14 relative to prior close is treated as an overnight
        // shock; ladder rungs get widened and the "now" rung is capped.
        const priorClose = snap.price / (1 + snap.change1d / 100);
        let gapPct: number | null = null;
        let gapAdjusted = false;
        if (intraday && priorClose > 0 && snap.atr14 > 0) {
          const gapAbs = intraday.sessionOpen - priorClose;
          gapPct = (gapAbs / priorClose) * 100;
          if (gapAbs <= -1.5 * snap.atr14) gapAdjusted = true;
        }

        // ── Earnings guard ──
        const earn = earningsByS.get(sym)?.info ?? null;
        const earningsWithinDays = earn?.daysUntil ?? null;
        const earningsDate = earn?.nextEarningsDate ?? null;
        const earningsBlocked = earn !== null && earn.daysUntil <= 5;

        const sig = evaluateSignal({
          regime: cls.regime,
          snapshot: snap,
          intraday,
          rsiDaily,
          distSma200Pct: scored.distSma200Pct,
          distSma50Pct: scored.distSma50Pct,
          drawdown20Pct: scored.drawdown20Pct,
          drawdown60Pct: scored.drawdown60Pct,
          regimeConfidence: cls.confidence,
          spyChangePct,
          analog,
        });
        const ladder = buildAdaptiveLadder(cls.regime, snap, intraday, sig.status, {
          gapAdjusted,
          earningsBlocked,
        });
        const risk = assessRisk({
          regime: cls.regime,
          snapshot: snap,
          intraday,
          spyChangePct,
          distSma200Pct: scored.distSma200Pct,
          analog,
        });
        const marketCtx = assessMarketContext({ spyChangePct, symbolChange1d: snap.change1d });
        const scenarioKey = regimeToScenario(cls.regime, snap.change5d, scored.distSma200Pct);
        const scenarioMeta = SCENARIO_META[scenarioKey];
        const isQualifiedDip =
          cls.regime !== "NO_DIP" &&
          snap.change1d <= -1.2;
        const qualifiedScore = isQualifiedDip ? Math.max(1, scored.score) : 0;

        rows.push({
          ...snap,
          name: meta.name,
          group: meta.group,
          ...scored,
          score: qualifiedScore,
          reasons: isQualifiedDip ? scored.reasons : ["No qualified dip: not down at least 1.2% today"],
          intraday: intraday as IntradayDTO,
          rsiDaily,
          regime: cls.regime,
          regimeLabel: regMeta.label,
          regimeExplanation: regMeta.explanation,
          regimeReasons: cls.reasons,
          confidence: cls.confidence,
          setupQuality: sig.setupQuality,
          executionConfidence: sig.executionConfidence,
          secondaryRegime: cls.secondaryRegime,
          secondaryRegimeLabel: cls.secondaryRegime ? REGIME_META[cls.secondaryRegime].label : null,
          decisionPath: sig.decisionPath,
          status: sig.status,
          statusReason: sig.reason,
          watchingFor: sig.watchingFor,
          adaptiveLadder: ladder,
          spyChangePct,
          riskLevel: risk.level,
          riskReasons: risk.reasons,
          marketContext: marketCtx.context,
          marketContextNote: marketCtx.note,
          setupFactors: sig.setupFactors,
          executionFactors: sig.executionFactors,
          scenarioKey,
          scenarioTitle: scenarioMeta.title,
          scenarioWhy: scenarioMeta.why,
          analog,
          analogStatus,
          ladderFlags: {
            gapAdjusted,
            gapPct,
            earningsBlocked,
            earningsWithinDays,
            earningsDate,
          },
          isQualifiedDip,
          decisionId: `${sym}-${scannedAtIso}-${cls.regime}-${sig.status}`,
        });
      } catch {
        failed.push(p.sym);
      }
    }


    rows.sort((a, b) => b.score - a.score);
    const missingUniverseRows = universe.filter((sym) => !rows.some((row) => row.symbol === sym));
    return {
      rows,
      scannedAt: scannedAtIso,
      failed,
      spyChangePct,
      ...(rateLimitWarning && missingUniverseRows.length ? { warning: rateLimitWarning } : {}),
    };
  }
}

