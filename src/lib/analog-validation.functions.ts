import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  walkForwardSymbol,
  rollupMetrics,
  type SymbolMetrics,
} from "./analog-validation.server";

const DEFAULT_UNIVERSE = [
  // Mega-cap tech
  "AAPL", "MSFT", "GOOGL", "NVDA", "META", "AMZN", "TSLA",
  // Software / SaaS
  "CRM", "ADBE", "NOW", "SNOW",
  // Semis
  "AMD", "AVGO", "TSM", "ASML",
  // Consumer / retail
  "COST", "WMT", "NKE",
  // Finance
  "JPM", "GS", "BAC",
  // Energy / defensive
  "XOM", "JNJ", "PG",
  // Broad market
  "SPY", "QQQ",
];

const inputSchema = z.object({
  universe: z.array(z.string().min(1).max(12)).optional(),
  testDatesPerSymbol: z.number().int().min(5).max(200).optional(),
  windowYears: z.number().int().min(2).max(20).optional(),
  persist: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export type WalkForwardRunResult = {
  ranAt: string;
  universe: string[];
  symbolCount: number;
  testDatesPerSymbol: number;
  windowYears: number;
  totalPredictions: number;
  suite: ReturnType<typeof rollupMetrics>;
  perSymbol: SymbolMetrics[];
  runId?: string;
};

export const runAnalogWalkForward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<WalkForwardRunResult> => {
    const universe = data.universe && data.universe.length > 0 ? data.universe : DEFAULT_UNIVERSE;
    const testDatesPerSymbol = data.testDatesPerSymbol ?? 40;
    const windowYears = data.windowYears ?? 8;
    const persist = data.persist ?? true;

    // Import server-only modules lazily so this .functions.ts stays client-safe.
    const [{ fetchYahooDaily }, { fetchStooqDaily }, analog] = await Promise.all([
      import("./yahoo.server"),
      import("./stooq.server"),
      import("./analog-search.server"),
    ]);

    const perSymbol: SymbolMetrics[] = [];

    // Cap concurrency to keep memory / provider pressure bounded.
    const concurrency = 4;
    let cursor = 0;
    const worker = async () => {
      while (cursor < universe.length) {
        const i = cursor++;
        const symbol = universe[i];
        try {
          let bars = await fetchYahooDaily(symbol).catch(() => [] as Awaited<ReturnType<typeof fetchYahooDaily>>);
          if (!bars || bars.length < 600) {
            const stooq = await fetchStooqDaily(symbol).catch(() => [] as Awaited<ReturnType<typeof fetchStooqDaily>>);
            if (stooq && stooq.length > bars.length) bars = stooq;
          }
          if (!bars || bars.length < 600) {
            perSymbol.push({
              symbol,
              predictions: 0,
              matchCountMedian: 0,
              meanSim: 0,
              fwd30: { n: 0, mae: 0, mdae: 0, hitRate: 0, bias: 0, coverageP25P75: 0 },
              fwd90: { n: 0, mae: 0, mdae: 0, hitRate: 0, bias: 0, coverageP25P75: 0 },
            });
            continue;
          }
          const features = analog.computeAllFeatures(bars);
          const { metrics } = walkForwardSymbol(
            { symbol, bars, features },
            (sym, primary, _extras, opts) => analog.searchAnalogs(sym, primary, [], opts),
            { testDatesPerSymbol, windowYears },
          );
          perSymbol.push(metrics);
        } catch {
          perSymbol.push({
            symbol,
            predictions: 0,
            matchCountMedian: 0,
            meanSim: 0,
            fwd30: { n: 0, mae: 0, mdae: 0, hitRate: 0, bias: 0, coverageP25P75: 0 },
            fwd90: { n: 0, mae: 0, mdae: 0, hitRate: 0, bias: 0, coverageP25P75: 0 },
          });
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const suite = rollupMetrics(perSymbol);
    const totalPredictions = suite.totalPredictions;
    const ranAt = new Date().toISOString();

    let runId: string | undefined;
    if (persist) {
      // Only admins should be able to persist, but at minimum we require an
      // authenticated session (requireSupabaseAuth). Use service role to
      // insert since our RLS policy on analog_validation_runs is service-role
      // write only.
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: inserted } = await supabaseAdmin
          .from("analog_validation_runs")
          .insert({
            universe,
            symbol_count: universe.length,
            test_dates_per_symbol: testDatesPerSymbol,
            total_predictions: totalPredictions,
            metrics: suite,
            per_symbol: perSymbol,
            config: { windowYears, testDatesPerSymbol, minMatches: 4 },
            notes: data.notes ?? null,
          })
          .select("id")
          .single();
        runId = inserted?.id;
        void context;
      } catch {
        // Persistence failure shouldn't fail the run — caller still sees metrics.
      }
    }

    return {
      ranAt,
      universe,
      symbolCount: universe.length,
      testDatesPerSymbol,
      windowYears,
      totalPredictions,
      suite,
      perSymbol,
      runId,
    };
  });

// Single-symbol variant so the UI can loop and show live progress/logs
// without holding the whole batch open in a single long-running request.
// Does NOT persist a run row on its own — the driver aggregates and calls
// `persistWalkForwardRun` when the batch finishes.
const singleInputSchema = z.object({
  symbol: z.string().min(1).max(12),
  testDatesPerSymbol: z.number().int().min(5).max(200).optional(),
  windowYears: z.number().int().min(2).max(20).optional(),
});

export type WalkForwardSymbolResult = {
  symbol: string;
  ranAt: string;
  dataSource: "yahoo" | "stooq" | "none";
  barCount: number;
  metrics: SymbolMetrics;
  error?: string;
};

export const runAnalogWalkForwardSymbol = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => singleInputSchema.parse(data))
  .handler(async ({ data }): Promise<WalkForwardSymbolResult> => {
    const symbol = data.symbol.toUpperCase();
    const testDatesPerSymbol = data.testDatesPerSymbol ?? 40;
    const windowYears = data.windowYears ?? 8;
    const ranAt = new Date().toISOString();

    const emptyMetrics: SymbolMetrics = {
      symbol,
      predictions: 0,
      matchCountMedian: 0,
      meanSim: 0,
      fwd30: { n: 0, mae: 0, mdae: 0, hitRate: 0, bias: 0, coverageP25P75: 0 },
      fwd90: { n: 0, mae: 0, mdae: 0, hitRate: 0, bias: 0, coverageP25P75: 0 },
    };

    try {
      const [{ fetchYahooDaily }, { fetchStooqDaily }, analog] = await Promise.all([
        import("./yahoo.server"),
        import("./stooq.server"),
        import("./analog-search.server"),
      ]);

      let bars = await fetchYahooDaily(symbol).catch(() => [] as Awaited<ReturnType<typeof fetchYahooDaily>>);
      let dataSource: "yahoo" | "stooq" | "none" = bars && bars.length > 0 ? "yahoo" : "none";
      if (!bars || bars.length < 600) {
        const stooq = await fetchStooqDaily(symbol).catch(() => [] as Awaited<ReturnType<typeof fetchStooqDaily>>);
        if (stooq && stooq.length > bars.length) { bars = stooq; dataSource = "stooq"; }
      }

      if (!bars || bars.length < 600) {
        return { symbol, ranAt, dataSource, barCount: bars?.length ?? 0, metrics: emptyMetrics, error: "insufficient_history" };
      }

      const features = analog.computeAllFeatures(bars);
      const { metrics } = walkForwardSymbol(
        { symbol, bars, features },
        (sym, primary, _extras, opts) => analog.searchAnalogs(sym, primary, [], opts),
        { testDatesPerSymbol, windowYears },
      );
      return { symbol, ranAt, dataSource, barCount: bars.length, metrics };
    } catch (e) {
      return {
        symbol, ranAt, dataSource: "none", barCount: 0, metrics: emptyMetrics,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

// Persist a completed multi-symbol run (used by the UI after the loop completes).
const persistInputSchema = z.object({
  universe: z.array(z.string().min(1).max(12)),
  testDatesPerSymbol: z.number().int().min(5).max(200),
  windowYears: z.number().int().min(2).max(20),
  perSymbol: z.array(z.any()),
  notes: z.string().max(500).optional(),
});

export const persistWalkForwardRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => persistInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ runId?: string; error?: string }> => {
    try {
      const perSymbol = data.perSymbol as SymbolMetrics[];
      const suite = rollupMetrics(perSymbol);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: inserted, error } = await supabaseAdmin
        .from("analog_validation_runs")
        .insert({
          universe: data.universe,
          symbol_count: data.universe.length,
          test_dates_per_symbol: data.testDatesPerSymbol,
          total_predictions: suite.totalPredictions,
          metrics: suite,
          per_symbol: perSymbol,
          config: { windowYears: data.windowYears, testDatesPerSymbol: data.testDatesPerSymbol, minMatches: 4 },
          notes: data.notes ?? null,
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      return { runId: inserted?.id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

export const DEFAULT_ANALOG_VALIDATION_UNIVERSE = DEFAULT_UNIVERSE;
