// Simulation server function — sandboxed pattern-scanner validation.
//
// Isolation guarantees:
//   • Never calls TwelveData (no API keys used, no rotating-key path).
//   • Never reads/writes the production analog cache or history cache.
//   • Never mutates any live-market state, watchlist, alert, or DB row.
//   • Only imports the *pure* production analysis functions so simulation
//     runs exercise the exact same engine that live scans use.
//
// Input:  a SimulationRequest describing a fully synthetic scenario.
// Output: full AnalogSearchResult plus diagnostics (timings, candidate
//         counts, feature snapshot, contributing symbols, decision path).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import type { AnalogSearchResult } from "./analog-search.server";
import type { SimulationRequest, SimulationBundle } from "./simulation";
import { generateSimulation } from "./simulation";

const scenarioEnum = z.enum([
  "strong_rally",
  "sharp_decline",
  "consolidation",
  "recovery",
  "volatility_spike",
  "trend_reversal",
  "sector_weakness",
  "flat_market",
  "low_volatility",
  "high_volatility",
  "gap_up",
  "gap_down",
  "prolonged_bear",
  "prolonged_bull",
  "contradictory",
  "sudden_reversal",
  "minimum_history",
  "custom",
]);

const inputSchema = z.object({
  scenario: scenarioEnum,
  seed: z.number().int().min(0).max(2 ** 31 - 1),
  length: z.number().int().min(400).max(3000),
  symbolLabel: z.string().min(1).max(24),
  custom: z
    .object({
      driftPctPerDay: z.number().min(-2).max(2),
      volPctPerDay: z.number().min(0.05).max(10),
      shockPct: z.number().min(-40).max(40),
      shockOffsetFromEnd: z.number().int().min(1).max(500),
    })
    .optional(),
});

export type SimulationDiagnostics = {
  timings: { generateMs: number; featuresMs: number; contextMs: number; searchMs: number; totalMs: number };
  bars: { primary: number; spy: number; sector: number };
  featureCoverage: { total: number; usable: number };
  scenarioMeta: SimulationBundle["meta"];
  warnings: string[];
  currentSnapshot: {
    price: number;
    dd60: number;
    dd20: number;
    dd252: number;
    ret5: number;
    ret20: number;
    ret60: number;
    rsi14: number;
    atrPct: number;
    realizedVol20: number;
    distSma50: number;
    distSma200: number;
    rsVsSpy60: number;
    corrVsSpy60: number;
    spyDd60: number;
  } | null;
};

export type SimulationResponse = {
  ok: boolean;
  result: AnalogSearchResult | null;
  diagnostics: SimulationDiagnostics;
  previewPrices: { date: string; close: number }[];
  isolation: {
    usedLiveApi: false;
    touchedProductionCache: false;
    sandbox: true;
  };
};

export const runSimulation = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<SimulationResponse> => {
    const warnings: string[] = [];
    const t0 = performance.now();

    // 1) Generate synthetic bundle — deterministic, no I/O.
    const bundle = generateSimulation(data as SimulationRequest);
    const t1 = performance.now();

    // 2) Import the *production* analog-search engine functions and run
    //    exactly the same pipeline `findHistoricalAnalog` runs — but on
    //    the synthetic bundle instead of live-fetched bars, and using
    //    LOCAL variables only (no shared caches).
    const {
      computeAllFeatures,
      attachMarketContext,
      buildBenchmarkIndex,
      buildSectorIndex,
      searchAnalogs,
    } = await import("./analog-search.server");

    const primaryBars = bundle.primary;
    const spyBars = bundle.spy;
    const sectorBars = bundle.sector;

    const primaryFeatures = computeAllFeatures(primaryBars);
    const t2 = performance.now();

    const spyIdx = buildBenchmarkIndex(spyBars);
    const secIdx = buildSectorIndex(sectorBars);
    attachMarketContext(primaryFeatures, primaryBars, {
      spy: spyIdx.quick,
      sector: secIdx,
      spyReturns: spyIdx.dailyRet,
      symReturns: () => undefined,
    });
    const t3 = performance.now();

    // No extra sibling instruments in the sandbox — a single synthetic
    // series is enough to exercise every scoring / regime / phase branch.
    const result = searchAnalogs(
      data.symbolLabel,
      { bars: primaryBars, features: primaryFeatures },
      [],
      { topK: 8, excludeRecentDays: 120 },
    );
    const t4 = performance.now();

    const usable = primaryFeatures.filter((f) => f !== null).length;
    if (usable < 300) warnings.push(`Only ${usable} usable feature rows — increase length for stability.`);
    if (!result) warnings.push("Scanner returned no analog — check regime gate or similarity floor.");

    const cur = primaryFeatures[primaryFeatures.length - 1];
    const snapshot = cur
      ? {
          price: cur.price,
          dd60: cur.dd60,
          dd20: cur.dd20,
          dd252: cur.dd252,
          ret5: cur.ret5,
          ret20: cur.ret20,
          ret60: cur.ret60,
          rsi14: cur.rsi14,
          atrPct: cur.atrPct,
          realizedVol20: cur.realizedVol20,
          distSma50: cur.distSma50,
          distSma200: cur.distSma200,
          rsVsSpy60: cur.rsVsSpy60,
          corrVsSpy60: cur.corrVsSpy60,
          spyDd60: cur.spyDd60,
        }
      : null;

    // Downsample to at most 260 points for the client preview chart.
    const step = Math.max(1, Math.floor(primaryBars.length / 260));
    const previewPrices: { date: string; close: number }[] = [];
    for (let i = 0; i < primaryBars.length; i += step) {
      previewPrices.push({ date: primaryBars[i].datetime, close: primaryBars[i].close });
    }

    return {
      ok: true,
      result,
      diagnostics: {
        timings: {
          generateMs: +(t1 - t0).toFixed(2),
          featuresMs: +(t2 - t1).toFixed(2),
          contextMs: +(t3 - t2).toFixed(2),
          searchMs: +(t4 - t3).toFixed(2),
          totalMs: +(t4 - t0).toFixed(2),
        },
        bars: { primary: primaryBars.length, spy: spyBars.length, sector: sectorBars.length },
        featureCoverage: { total: primaryFeatures.length, usable },
        scenarioMeta: bundle.meta,
        warnings,
        currentSnapshot: snapshot,
      },
      previewPrices,
      isolation: { usedLiveApi: false, touchedProductionCache: false, sandbox: true },
    };
  });

// ============================================================================
// AI-edited report analysis — takes a full sandbox report (current run + all
// rows in the report table) and produces a detailed, professionally written
// markdown document that explains every chart, metric, and table row in plain
// language so a reader never has to look at the raw UI.
// ============================================================================

const analyzeInputSchema = z.object({
  current: z.any().nullable(),
  rows: z.array(z.any()).max(50),
  meta: z
    .object({
      symbolLabel: z.string().max(64).optional(),
      generatedAt: z.string().max(64).optional(),
    })
    .optional(),
});

export type AnalyzeReportResponse = {
  ok: boolean;
  markdown: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

export const analyzeSimulationReport = createServerFn({ method: "POST" })
  .inputValidator((data) => analyzeInputSchema.parse(data))
  .handler(async ({ data }): Promise<AnalyzeReportResponse> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const payload = JSON.stringify(
      {
        meta: data.meta ?? {},
        currentRun: data.current,
        allRuns: data.rows,
      },
      null,
      2,
    );

    const system = [
      "You are a senior quantitative-research analyst writing an internal report.",
      "You will receive the raw JSON output of a sandbox validation run of a Historical Pattern Recognition Scanner.",
      "Your job is to convert the entire report into a clean, professionally written, thoroughly explanatory Markdown document.",
      "",
      "Absolute rules:",
      "- Do NOT summarize away detail. Explain everything.",
      "- For every chart, table, metric, and diagnostic block in the source, describe in prose exactly what it is showing, what the numbers mean, and what a reader should conclude from them. A reader must not need to look at any image or chart to understand the report.",
      "- Preserve every numeric value from the source. Round only when it aids readability, and always keep the original precision alongside.",
      "- Structure with clear H1/H2/H3 headings, short paragraphs, and Markdown tables where it improves clarity. Use bullet lists for enumerations.",
      "- Include sections: Executive Overview, Scenario & Isolation Guarantees, Synthetic Price Behavior (describe the price chart in words), Scanner Diagnostics & Timings, Current Feature Snapshot, Best Historical Analog, Distance Breakdown (strongest similarities & biggest differences), Top Matches Table (walk through each match), Trader Answers & Forward Horizons, Cross-Scenario Testing Report (walk through every row), Warnings & Anomalies, Conclusions.",
      "- Never invent data. If a value is missing/null, say so explicitly.",
      "- Output ONLY the Markdown document. No preamble, no code fences around the entire document.",
    ].join("\n");

    const prompt = [
      "Here is the full sandbox report JSON. Convert it into the described Markdown document.",
      "",
      "```json",
      payload.length > 60_000 ? payload.slice(0, 60_000) + "\n/* truncated */" : payload,
      "```",
    ].join("\n");

    const { text, usage } = await generateText({
      model,
      system,
      prompt,
    });

    return {
      ok: true,
      markdown: text,
      model: "google/gemini-2.5-flash",
      usage: {
        promptTokens: usage?.inputTokens,
        completionTokens: usage?.outputTokens,
      },
    };
  });

// ============================================================================
// HISTORICAL REPLAY MODE
// ----------------------------------------------------------------------------
// Fetches REAL daily bars for a symbol via TwelveData (read-only — no cache
// writes, no watchlist/alert mutations, no analytics side-effects), then walks
// forward one bar at a time and re-runs the exact production analog search
// with ONLY the past bars available at each step. After the walk it also
// evaluates realized fwd-5/30/90 to score the scanner's accuracy at each step.
//
// Isolation guarantees identical to runSimulation:
//   • Uses withRotatingKey — no shared prod cache is touched.
//   • Never writes to production watchlists / alerts / DB.
//   • Never mixes results with live scan cache.
// ============================================================================

const replayInputSchema = z.object({
  symbol: z.string().min(1).max(12).regex(/^[A-Z0-9.\-]+$/i),
  startOffsetFromEnd: z.number().int().min(30).max(2500),
  steps: z.number().int().min(1).max(300),
  stride: z.number().int().min(1).max(20),
  outputsize: z.number().int().min(500).max(5000).optional(),
});

export type ReplayStep = {
  stepIdx: number;
  barIdx: number;
  date: string;
  price: number;
  // Scanner outputs at this step (no look-ahead — features[0..barIdx] only)
  hasResult: boolean;
  bestSymbol: string | null;
  bestAnalogDate: string | null;
  bestAnalogIdx: number | null;
  similarity: number | null;
  marketPhase: string | null;
  confidenceOverall: number | null;
  probBottomIn: number | null;
  probReversal: number | null;
  probContinuedDecline: number | null;
  meanFwd30: number | null;
  meanFwd90: number | null;
  meanMinLowPct: number | null;
  // Analog stability: has the analog identity changed vs previous step?
  analogSwitched: boolean;
  switchReason: string | null;
  // Feature contribution — top 3 strongest & top 2 weakest from best match.
  topFeatures: { label: string; delta: number; score: number }[];
  weakFeatures: { label: string; delta: number; score: number }[];
  // Realized forward (filled after walk finishes)
  actualFwd5: number | null;
  actualFwd30: number | null;
  actualFwd90: number | null;
  // Accuracy against the aggregate prediction (signed error, pp)
  fwd30Error: number | null;
  fwd90Error: number | null;
  // Whether prediction direction agreed with realized direction (fwd30)
  directionCorrect: boolean | null;
  warnings: string[];
};

export type ReplayResponse = {
  ok: boolean;
  symbol: string;
  totalBars: number;
  steps: ReplayStep[];
  stability: {
    totalSteps: number;
    analogSwitches: number;
    switchRate: number;
    longestStableRun: number;
    unstableFlags: { fromDate: string; toDate: string; reason: string }[];
  };
  accuracy: {
    stepsWithResult: number;
    stepsWithActuals: number;
    meanAbsFwd30Error: number | null;
    meanAbsFwd90Error: number | null;
    fwd30DirectionAccuracy: number | null;
    fwd90DirectionAccuracy: number | null;
    meanSimilarity: number;
    meanConfidence: number;
  };
  featureCoverage: {
    featuresObservedInBestMatches: Record<string, { hits: number; meanScore: number; meanDelta: number }>;
    zeroInfluenceFeatures: string[];
    dominantFeatures: string[];
  };
  timings: { fetchMs: number; featuresMs: number; replayMs: number; totalMs: number };
  isolation: { usedLiveApi: true; touchedProductionCache: false; sandbox: true };
  warnings: string[];
};

export const runHistoricalReplay = createServerFn({ method: "POST" })
  .inputValidator((data) => replayInputSchema.parse(data))
  .handler(async ({ data }): Promise<ReplayResponse> => {
    const warnings: string[] = [];
    const t0 = performance.now();

    const { withRotatingKey, hasAnyKey } = await import("./twelvedata-keys.server");
    if (!hasAnyKey()) throw new Error("No TWELVEDATA_API_KEY configured for historical replay.");

    const {
      computeAllFeatures,
      attachMarketContext,
      buildBenchmarkIndex,
      buildSectorIndex,
      searchAnalogs,
      fetchLongHistory,
      SECTOR_PROXY,
    } = await import("./analog-search.server");

    const symbol = data.symbol.toUpperCase();
    const sectorSym = SECTOR_PROXY[symbol] ?? "SPY";
    const outputsize = data.outputsize ?? 5000;

    // Fetch symbol, SPY, sector — all read-only through the rotating key path.
    // Deliberately serial so we don't slam a single key with 3 concurrent hits.
    const primaryBars = await withRotatingKey((k) => fetchLongHistory(symbol, k, outputsize));
    const spyBars = await withRotatingKey((k) => fetchLongHistory("SPY", k, outputsize));
    const sectorBars =
      sectorSym === "SPY" ? spyBars : await withRotatingKey((k) => fetchLongHistory(sectorSym, k, outputsize));

    const tFetch = performance.now();

    if (primaryBars.length < 300) {
      throw new Error(`Only ${primaryBars.length} bars for ${symbol}; need ≥300 for replay.`);
    }

    // Compute features ONCE against the full history. Features at bar i only
    // depend on bars 0..i, so slicing preserves no-look-ahead. Market context
    // is attached the same way.
    const primaryFeatures = computeAllFeatures(primaryBars);
    const spyIdx = buildBenchmarkIndex(spyBars);
    const secIdx = buildSectorIndex(sectorBars);
    attachMarketContext(primaryFeatures, primaryBars, {
      spy: spyIdx.quick,
      sector: secIdx,
      spyReturns: spyIdx.dailyRet,
      symReturns: () => undefined,
    });

    const tFeat = performance.now();

    const N = primaryBars.length;
    const start = Math.max(300, N - data.startOffsetFromEnd);
    const end = Math.min(N - 1, start + data.steps * data.stride);

    const steps: ReplayStep[] = [];
    let prevAnalogKey: string | null = null;
    let prevSimilarity: number | null = null;
    let prevConfidence: number | null = null;

    for (let s = 0, barIdx = start; barIdx <= end; s++, barIdx += data.stride) {
      const stepWarnings: string[] = [];
      // Truncated views — this is the no-look-ahead guarantee.
      const barsUpTo = primaryBars.slice(0, barIdx + 1);
      const featsUpTo = primaryFeatures.slice(0, barIdx + 1);

      const res = searchAnalogs(
        symbol,
        { bars: barsUpTo, features: featsUpTo },
        [],
        { topK: 8, excludeRecentDays: 120 },
      );

      const price = primaryBars[barIdx].close;
      const date = primaryBars[barIdx].datetime;

      if (!res) {
        steps.push({
          stepIdx: s,
          barIdx,
          date,
          price,
          hasResult: false,
          bestSymbol: null,
          bestAnalogDate: null,
          bestAnalogIdx: null,
          similarity: null,
          marketPhase: null,
          confidenceOverall: null,
          probBottomIn: null,
          probReversal: null,
          probContinuedDecline: null,
          meanFwd30: null,
          meanFwd90: null,
          meanMinLowPct: null,
          analogSwitched: false,
          switchReason: null,
          topFeatures: [],
          weakFeatures: [],
          actualFwd5: null,
          actualFwd30: null,
          actualFwd90: null,
          fwd30Error: null,
          fwd90Error: null,
          directionCorrect: null,
          warnings: ["no_analog"],
        });
        prevAnalogKey = null;
        prevSimilarity = null;
        prevConfidence = null;
        continue;
      }

      const analogKey = `${res.best.symbol}:${res.best.idx}`;
      const switched = prevAnalogKey !== null && analogKey !== prevAnalogKey;
      let switchReason: string | null = null;
      if (switched && prevSimilarity !== null && prevConfidence !== null) {
        const simDelta = res.best.similarity - prevSimilarity;
        const confDelta = res.aggregate.confidenceOverall - prevConfidence;
        if (simDelta < 2 && confDelta < 2) {
          switchReason = `unstable_switch: similarity Δ${simDelta.toFixed(1)}pp, conf Δ${confDelta.toFixed(1)}pp — below materiality thresholds`;
          stepWarnings.push("unstable_switch");
        } else if (simDelta < 0) {
          switchReason = `regressive_switch: new analog similarity is LOWER (${simDelta.toFixed(1)}pp)`;
          stepWarnings.push("regressive_switch");
        } else {
          switchReason = `material_upgrade: similarity +${simDelta.toFixed(1)}pp, conf ${confDelta >= 0 ? "+" : ""}${confDelta.toFixed(1)}pp`;
        }
      }

      const sortedBd = [...res.best.distanceBreakdown].sort((a, b) => b.score - a.score);
      const topFeatures = sortedBd.slice(0, 3).map((f) => ({ label: f.label, delta: f.delta, score: f.score }));
      const weakFeatures = sortedBd.slice(-2).map((f) => ({ label: f.label, delta: f.delta, score: f.score }));

      steps.push({
        stepIdx: s,
        barIdx,
        date,
        price,
        hasResult: true,
        bestSymbol: res.best.symbol,
        bestAnalogDate: res.best.date,
        bestAnalogIdx: res.best.idx,
        similarity: res.best.similarity,
        marketPhase: res.marketPhase,
        confidenceOverall: res.aggregate.confidenceOverall,
        probBottomIn: res.aggregate.probBottomIn,
        probReversal: res.aggregate.probReversal,
        probContinuedDecline: res.aggregate.probContinuedDecline,
        meanFwd30: res.aggregate.meanFwd30,
        meanFwd90: res.aggregate.meanFwd90,
        meanMinLowPct: res.aggregate.meanMinLowPct,
        analogSwitched: switched,
        switchReason,
        topFeatures,
        weakFeatures,
        actualFwd5: null,
        actualFwd30: null,
        actualFwd90: null,
        fwd30Error: null,
        fwd90Error: null,
        directionCorrect: null,
        warnings: stepWarnings,
      });

      prevAnalogKey = analogKey;
      prevSimilarity = res.best.similarity;
      prevConfidence = res.aggregate.confidenceOverall;
    }

    // Fill realized forwards from bars that exist AFTER each step's barIdx.
    for (const step of steps) {
      const startClose = primaryBars[step.barIdx].close;
      const barAt = (offset: number) => primaryBars[step.barIdx + offset]?.close ?? null;
      const pct = (v: number | null) => (v === null ? null : ((v - startClose) / startClose) * 100);
      step.actualFwd5 = pct(barAt(5));
      step.actualFwd30 = pct(barAt(30));
      step.actualFwd90 = pct(barAt(90));
      if (step.actualFwd30 !== null && step.meanFwd30 !== null) {
        step.fwd30Error = step.actualFwd30 - step.meanFwd30;
      }
      if (step.actualFwd90 !== null && step.meanFwd90 !== null) {
        step.fwd90Error = step.actualFwd90 - step.meanFwd90;
      }
      if (step.actualFwd30 !== null && step.meanFwd30 !== null) {
        step.directionCorrect = Math.sign(step.actualFwd30) === Math.sign(step.meanFwd30);
      }
    }

    // Stability audit
    let analogSwitches = 0;
    let longestStableRun = 0;
    let currentRun = 0;
    const unstableFlags: { fromDate: string; toDate: string; reason: string }[] = [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (st.analogSwitched) {
        analogSwitches++;
        longestStableRun = Math.max(longestStableRun, currentRun);
        currentRun = 0;
        if (st.switchReason && (st.switchReason.startsWith("unstable_") || st.switchReason.startsWith("regressive_"))) {
          unstableFlags.push({
            fromDate: steps[i - 1]?.date ?? "?",
            toDate: st.date,
            reason: st.switchReason,
          });
        }
      } else {
        currentRun++;
      }
    }
    longestStableRun = Math.max(longestStableRun, currentRun);

    // Feature-usage coverage across all best-match distance breakdowns.
    const featStats = new Map<string, { hits: number; scoreSum: number; deltaSum: number }>();
    let stepsWithResult = 0;
    for (const st of steps) {
      if (!st.hasResult) continue;
      stepsWithResult++;
      for (const f of st.topFeatures.concat(st.weakFeatures)) {
        const cur = featStats.get(f.label) ?? { hits: 0, scoreSum: 0, deltaSum: 0 };
        cur.hits++;
        cur.scoreSum += f.score;
        cur.deltaSum += Math.abs(f.delta);
        featStats.set(f.label, cur);
      }
    }
    const featCoverage: Record<string, { hits: number; meanScore: number; meanDelta: number }> = {};
    featStats.forEach((v, k) => {
      featCoverage[k] = { hits: v.hits, meanScore: +(v.scoreSum / v.hits).toFixed(2), meanDelta: +(v.deltaSum / v.hits).toFixed(3) };
    });
    // A feature that never appears in ANY top/weak list across replay steps is
    // effectively inert. A feature that always appears with a very high score
    // may be dominating disproportionately.
    const zeroInfluenceFeatures: string[] = [];
    const dominantFeatures: string[] = [];
    Object.entries(featCoverage).forEach(([label, v]) => {
      if (v.hits === 0) zeroInfluenceFeatures.push(label);
      if (stepsWithResult > 0 && v.hits / stepsWithResult > 0.8 && v.meanScore > 12) {
        dominantFeatures.push(label);
      }
    });

    const withFwd = steps.filter((s) => s.actualFwd30 !== null && s.fwd30Error !== null);
    const withFwd90 = steps.filter((s) => s.actualFwd90 !== null && s.fwd90Error !== null);
    const withDir = steps.filter((s) => s.directionCorrect !== null);
    const meanAbs = (arr: number[]) =>
      arr.length === 0 ? null : +(arr.reduce((s, v) => s + Math.abs(v), 0) / arr.length).toFixed(3);
    const meanSim =
      stepsWithResult === 0
        ? 0
        : steps.reduce((s, st) => s + (st.similarity ?? 0), 0) / stepsWithResult;
    const meanConf =
      stepsWithResult === 0
        ? 0
        : steps.reduce((s, st) => s + (st.confidenceOverall ?? 0), 0) / stepsWithResult;

    const tReplay = performance.now();

    return {
      ok: true,
      symbol,
      totalBars: N,
      steps,
      stability: {
        totalSteps: steps.length,
        analogSwitches,
        switchRate: steps.length ? +(analogSwitches / steps.length).toFixed(3) : 0,
        longestStableRun,
        unstableFlags,
      },
      accuracy: {
        stepsWithResult,
        stepsWithActuals: withFwd.length,
        meanAbsFwd30Error: meanAbs(withFwd.map((s) => s.fwd30Error!)),
        meanAbsFwd90Error: meanAbs(withFwd90.map((s) => s.fwd90Error!)),
        fwd30DirectionAccuracy: withDir.length
          ? +(withDir.filter((s) => s.directionCorrect).length / withDir.length).toFixed(3)
          : null,
        fwd90DirectionAccuracy: null,
        meanSimilarity: +meanSim.toFixed(2),
        meanConfidence: +meanConf.toFixed(2),
      },
      featureCoverage: {
        featuresObservedInBestMatches: featCoverage,
        zeroInfluenceFeatures,
        dominantFeatures,
      },
      timings: {
        fetchMs: +(tFetch - t0).toFixed(1),
        featuresMs: +(tFeat - tFetch).toFixed(1),
        replayMs: +(tReplay - tFeat).toFixed(1),
        totalMs: +(tReplay - t0).toFixed(1),
      },
      isolation: { usedLiveApi: true, touchedProductionCache: false, sandbox: true },
      warnings,
    };
  });

// ============================================================================
// SENSITIVITY TESTING
// ----------------------------------------------------------------------------
// Take a base synthetic scenario, then perturb ONE feature at the current bar
// through a small range of deltas. Re-run searchAnalogs on the mutated feature
// vector so we can measure how sensitive the scanner is to that dimension.
// Sensible response: smooth, monotone-ish changes in similarity/confidence.
// Erratic response: large discontinuities → possible instability.
// ============================================================================

const sensitivityFeatureEnum = z.enum([
  "rsi14",
  "atrPct",
  "dd60",
  "realizedVol20",
  "rsVsSpy60",
  "distSma200",
  "corrVsSpy60",
  "ret20",
]);

const sensitivityInputSchema = z.object({
  scenario: scenarioEnum,
  seed: z.number().int().min(0).max(2 ** 31 - 1),
  length: z.number().int().min(400).max(3000),
  symbolLabel: z.string().min(1).max(24),
  feature: sensitivityFeatureEnum,
  deltas: z.array(z.number().min(-40).max(40)).min(2).max(21),
});

export type SensitivityPoint = {
  delta: number;
  perturbedValue: number;
  similarity: number | null;
  bestSymbol: string | null;
  bestAnalogDate: string | null;
  analogKey: string | null;
  marketPhase: string | null;
  confidenceOverall: number | null;
  probBottomIn: number | null;
  probReversal: number | null;
  probContinuedDecline: number | null;
  meanFwd30: number | null;
};

export type SensitivityResponse = {
  ok: boolean;
  feature: string;
  baseValue: number;
  points: SensitivityPoint[];
  // Simple smoothness metric — total variation of consecutive similarities.
  smoothness: {
    similarityTotalVariation: number;
    confidenceTotalVariation: number;
    analogSwitchesUnderPerturbation: number;
    monotoneScore: number; // 0..1
  };
  warnings: string[];
};

export const runSensitivity = createServerFn({ method: "POST" })
  .inputValidator((data) => sensitivityInputSchema.parse(data))
  .handler(async ({ data }): Promise<SensitivityResponse> => {
    const warnings: string[] = [];
    const bundle = generateSimulation({
      scenario: data.scenario as SimulationRequest["scenario"],
      seed: data.seed,
      length: data.length,
      symbolLabel: data.symbolLabel,
    });

    const {
      computeAllFeatures,
      attachMarketContext,
      buildBenchmarkIndex,
      buildSectorIndex,
      searchAnalogs,
    } = await import("./analog-search.server");

    const bars = bundle.primary;
    const features = computeAllFeatures(bars);
    const spyIdx = buildBenchmarkIndex(bundle.spy);
    const secIdx = buildSectorIndex(bundle.sector);
    attachMarketContext(features, bars, {
      spy: spyIdx.quick,
      sector: secIdx,
      spyReturns: spyIdx.dailyRet,
      symReturns: () => undefined,
    });

    const lastIdx = features.length - 1;
    const base = features[lastIdx];
    if (!base) throw new Error("Base feature snapshot unavailable — scenario may have too little data.");

    const featureKey = data.feature as keyof typeof base;
    const baseVal = base[featureKey] as number;

    const points: SensitivityPoint[] = [];
    let prevAnalogKey: string | null = null;
    let analogSwitches = 0;
    for (const delta of data.deltas) {
      // Clone features so we don't mutate the shared array across iterations.
      const cloned = features.map((f) => (f ? { ...f } : null));
      const target = cloned[lastIdx];
      if (!target) continue;
      const perturbedValue = baseVal + delta;
      (target as unknown as Record<string, number>)[featureKey as string] = perturbedValue;

      const res = searchAnalogs(
        data.symbolLabel,
        { bars, features: cloned },
        [],
        { topK: 8, excludeRecentDays: 120 },
      );

      if (!res) {
        points.push({
          delta,
          perturbedValue,
          similarity: null,
          bestSymbol: null,
          bestAnalogDate: null,
          analogKey: null,
          marketPhase: null,
          confidenceOverall: null,
          probBottomIn: null,
          probReversal: null,
          probContinuedDecline: null,
          meanFwd30: null,
        });
        continue;
      }
      const analogKey = `${res.best.symbol}:${res.best.idx}`;
      if (prevAnalogKey !== null && analogKey !== prevAnalogKey) analogSwitches++;
      prevAnalogKey = analogKey;
      points.push({
        delta,
        perturbedValue,
        similarity: res.best.similarity,
        bestSymbol: res.best.symbol,
        bestAnalogDate: res.best.date,
        analogKey,
        marketPhase: res.marketPhase,
        confidenceOverall: res.aggregate.confidenceOverall,
        probBottomIn: res.aggregate.probBottomIn,
        probReversal: res.aggregate.probReversal,
        probContinuedDecline: res.aggregate.probContinuedDecline,
        meanFwd30: res.aggregate.meanFwd30,
      });
    }

    // Smoothness — total variation of similarity & confidence sequences.
    const sims = points.map((p) => p.similarity).filter((v): v is number => v !== null);
    const confs = points.map((p) => p.confidenceOverall).filter((v): v is number => v !== null);
    const totalVar = (arr: number[]) => {
      let s = 0;
      for (let i = 1; i < arr.length; i++) s += Math.abs(arr[i] - arr[i - 1]);
      return +s.toFixed(2);
    };
    // Monotone score: fraction of consecutive pairs moving in same direction.
    let monoAgree = 0, monoTotal = 0;
    for (let i = 2; i < sims.length; i++) {
      const d1 = Math.sign(sims[i - 1] - sims[i - 2]);
      const d2 = Math.sign(sims[i] - sims[i - 1]);
      if (d1 !== 0 && d2 !== 0) {
        monoTotal++;
        if (d1 === d2) monoAgree++;
      }
    }
    const monotoneScore = monoTotal === 0 ? 0 : +(monoAgree / monoTotal).toFixed(3);

    if (analogSwitches > Math.max(1, Math.floor(data.deltas.length / 3))) {
      warnings.push(`Unusually many analog switches (${analogSwitches}) under mild perturbation — possible instability.`);
    }

    return {
      ok: true,
      feature: data.feature,
      baseValue: baseVal,
      points,
      smoothness: {
        similarityTotalVariation: totalVar(sims),
        confidenceTotalVariation: totalVar(confs),
        analogSwitchesUnderPerturbation: analogSwitches,
        monotoneScore,
      },
      warnings,
    };
  });


