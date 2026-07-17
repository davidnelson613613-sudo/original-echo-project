// Momentum Rockets scan implementation. Same streaming, memory-safe
// pipeline as the Future Leaders scanner: SPY once, cached bars in chunks,
// uncached bars in small parallel batches, scored inline and discarded.
// Reuses future_leaders_bar_cache — bars are just bars.
//
// Differs from Future Leaders in:
//   1. Eligibility filter (small-cap / lower-liq only)
//   2. Feature extras (breakout / thrust) and a different 5-model composite
//   3. Its own persistence tables

import { UNIVERSE_META, UNIVERSE_SYMBOLS } from "@/lib/future-leaders/universe";
import { computeFeatureVector, type FeatureVector } from "@/lib/future-leaders/features.server";
import { readBarCache, writeBarCache } from "@/lib/future-leaders/bar-cache.server";
import { fetchYahooDaily } from "@/lib/market.server";
import type { Bar } from "@/lib/market.server";
import { computeRocketExtras, type RocketExtras } from "./features-extra.server";
import { computeRocketComposite, isRocketEligible, type RocketComponents } from "./models.server";
import { generateRocketThesis, type RocketThesis } from "./ai-thesis.server";

type ScoredRow = {
  symbol: string;
  name: string;
  sector: string;
  composite: number;
  confidence: number;
  weights: Record<string, number>;
  components: RocketComponents;
  features: FeatureVector;
  extras: RocketExtras;
  aiThesis: RocketThesis | null;
};

const BATCH_SIZE = 30;
const BATCH_DELAY_MS = 120;
const AI_CONCURRENCY = 5;
const CACHE_CHUNK = 200;

async function fetchBars(symbol: string): Promise<Bar[] | null> {
  try {
    // 3y is plenty for a short-horizon momentum model; keeps memory smaller.
    const bars = await fetchYahooDaily(symbol, 800);
    return bars.length ? bars : null;
  } catch {
    return null;
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

function detectRegime(spyBars: Bar[] | null): string {
  if (!spyBars || spyBars.length < 200) return "unknown";
  const closes = spyBars.map((b) => b.close);
  const price = closes[0];
  const sma200 = closes.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
  const sma200Prev = closes.length >= 260
    ? closes.slice(60, 260).reduce((a, b) => a + b, 0) / 200
    : sma200;
  const slope = ((sma200 - sma200Prev) / sma200Prev) * 100;
  const rets: number[] = [];
  for (let i = 0; i < 60 && i + 1 < closes.length; i++) rets.push(Math.log(closes[i] / closes[i + 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const volAnn = sd * Math.sqrt(252) * 100;
  const bullish = price > sma200 && slope > 1;
  const bearish = price < sma200 && slope < -1;
  const highVol = volAnn > 22;
  if (bullish && !highVol) return "bull-low-vol";
  if (bullish && highVol) return "bull-high-vol";
  if (bearish && highVol) return "bear-high-vol";
  if (bearish) return "bear";
  return highVol ? "neutral-high-vol" : "neutral";
}

function scoreOne(
  sym: string,
  bars: Bar[] | null,
  spyBars: Bar[] | null,
): ScoredRow | "ineligible" | null {
  if (!bars || bars.length < 60) return null;
  const f = computeFeatureVector(sym, bars, spyBars);
  if (!f) return null;
  if (!isRocketEligible(f)) return "ineligible";
  const x = computeRocketExtras(bars);
  const c = computeRocketComposite(f, x);
  const meta = UNIVERSE_META[sym] ?? { symbol: sym, name: sym, sector: "—" };
  return {
    symbol: sym,
    name: meta.name,
    sector: meta.sector,
    composite: c.composite,
    confidence: c.confidence,
    weights: c.weights,
    components: c.components,
    features: f,
    extras: x,
    aiThesis: null,
  };
}

export async function runRocketsScanImpl(opts: {
  aiTopN: number;
  limit?: number;
  actor: string;
}): Promise<{ snapshotId: string; ranked: number; eligible: number; failed: number }> {
  const startedAt = new Date();
  const symbols = (opts.limit ? UNIVERSE_SYMBOLS.slice(0, opts.limit) : UNIVERSE_SYMBOLS).slice();

  // 1. SPY (fresh) for regime + beta if the features want it.
  const spyBars = await fetchBars("SPY");
  const regime = detectRegime(spyBars);
  const spyChangePct =
    spyBars && spyBars.length >= 2
      ? ((spyBars[0].close - spyBars[1].close) / spyBars[1].close) * 100
      : null;

  const scored: ScoredRow[] = [];
  const failed: string[] = [];
  let ineligibleCount = 0;
  let cachedCount = 0;
  let fetchedCount = 0;

  // 2. Score cached symbols in small chunks.
  const remaining = new Set(symbols);
  for (let i = 0; i < symbols.length; i += CACHE_CHUNK) {
    const chunk = symbols.slice(i, i + CACHE_CHUNK);
    const cached = await readBarCache(chunk);
    for (const [sym, bars] of cached) {
      const row = scoreOne(sym, bars, spyBars);
      if (row === "ineligible") ineligibleCount++;
      else if (row) { scored.push(row); cachedCount++; }
      else failed.push(sym);
      remaining.delete(sym);
    }
  }

  // 3. Fetch + score the rest.
  const toFetch = Array.from(remaining);
  const fetchStart = Date.now();
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (sym) => ({ sym, bars: await fetchBars(sym) })));

    const cacheWrites: Array<{ symbol: string; bars: Bar[] }> = [];
    for (const { sym, bars } of results) {
      const row = scoreOne(sym, bars, spyBars);
      if (row === "ineligible") ineligibleCount++;
      else if (row) { scored.push(row); fetchedCount++; }
      else failed.push(sym);
      if (bars && bars.length >= 60) cacheWrites.push({ symbol: sym, bars });
    }
    if (cacheWrites.length) await writeBarCache(cacheWrites);
    if (i + BATCH_SIZE < toFetch.length) await new Promise((res) => setTimeout(res, BATCH_DELAY_MS));
  }
  console.log(
    `[momentum-rockets] eligible ${scored.length} (cache ${cachedCount}, fetched ${fetchedCount}, ineligible ${ineligibleCount}, failed ${failed.length}) in ${Date.now() - fetchStart}ms`,
  );

  scored.sort((a, b) => b.composite - a.composite);

  // 4. AI thesis for top N — parallel.
  const topN = Math.min(opts.aiTopN, scored.length);
  const topRows = scored.slice(0, topN);
  await runWithConcurrency(topRows, AI_CONCURRENCY, async (row) => {
    try {
      row.aiThesis = await generateRocketThesis(
        row.symbol, row.name, row.sector, row.features, row.extras, row.components, row.composite, row.confidence,
      );
    } catch (err) {
      console.error(`[momentum-rockets] AI thesis failed for ${row.symbol}:`, err);
      row.aiThesis = null;
    }
  });

  // 5. Persist.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const scannedAt = new Date().toISOString();

  const { data: snapRow, error: snapErr } = await supabaseAdmin
    .from("momentum_rockets_snapshots")
    .insert({
      scanned_at: scannedAt,
      universe_size: symbols.length,
      eligible_size: scored.length,
      failed_symbols: failed,
      spy_change_pct: spyChangePct,
      regime,
      weights: scored[0]?.weights ?? {},
      duration_ms: Date.now() - startedAt.getTime(),
      triggered_by: opts.actor,
    })
    .select("id")
    .single();
  if (snapErr || !snapRow) throw new Error(snapErr?.message ?? "Failed to insert rockets snapshot");

  const snapshotId = snapRow.id as string;

  const rankingRows = scored.map((row, idx) => ({
    snapshot_id: snapshotId,
    symbol: row.symbol,
    rank: idx + 1,
    composite_score: row.composite,
    confidence: row.confidence,
    component_scores: {
      breakout: row.components.breakout.score,
      momentum: row.components.momentum.score,
      volumeSurge: row.components.volumeSurge.score,
      volatilityFuel: row.components.volatilityFuel.score,
      risk: row.components.risk.score,
    },
    evidence: {
      name: row.name,
      sector: row.sector,
      reasons: {
        breakout: row.components.breakout.reasons,
        momentum: row.components.momentum.reasons,
        volumeSurge: row.components.volumeSurge.reasons,
        volatilityFuel: row.components.volatilityFuel.reasons,
        risk: row.components.risk.reasons,
      },
      features: {
        price: row.features.price,
        asOf: row.features.asOf,
        ret1m: row.features.ret1m,
        ret3m: row.extras.ret3mPct ?? row.features.ret3m,
        distFromHigh52wPct: row.features.distFromHigh52wPct,
        distFrom20dHighPct: row.extras.distFrom20dHighPct,
        distFrom50dHighPct: row.extras.distFrom50dHighPct,
        barsSince20dHigh: row.extras.barsSince20dHigh,
        upDayRatio20: row.extras.upDayRatio20,
        upDayRatio60: row.extras.upDayRatio60,
        volAnn20: row.extras.volAnn20,
        volAnn60: row.features.volAnn60,
        dollarVolThrust5v60: row.extras.dollarVolThrust5v60,
        volumeTrendRatio: row.features.volumeTrendRatio,
        avgDollarVol20: row.features.avgDollarVol20,
        maxDrawdown1y: row.features.maxDrawdown1y,
      },
    },
    ai_thesis: row.aiThesis,
  }));

  const CHUNK = 100;
  for (let i = 0; i < rankingRows.length; i += CHUNK) {
    const chunk = rankingRows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin.from("momentum_rockets_rankings").insert(chunk);
    if (error) throw new Error(`Rockets rankings insert failed at chunk ${i}: ${error.message}`);
  }

  return { snapshotId, ranked: scored.length, eligible: scored.length, failed: failed.length };
}
