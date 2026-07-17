// Resumable Future Leaders scan implementation.
//
// A full ~4,200-symbol scan cannot safely run as one long worker request. This
// file turns it into small chunks: start a snapshot immediately, process the
// next slice, persist the current top list, then let the UI/server call the next
// slice. Users see stocks appear within seconds instead of waiting for the end.

import { FUTURE_LEADERS_UNIVERSE, UNIVERSE_META, UNIVERSE_SYMBOLS } from "./universe";
import { computeFeatureVector, type FeatureVector } from "./features.server";
import { computeComposite, type ComponentScores } from "./models.server";
import { generateThesis, type AiThesis } from "./ai-thesis.server";
import type { Bar } from "../market.server";
import { fetchYahooDaily } from "../yahoo.server";
import { readBarCache, writeBarCache } from "./bar-cache.server";

type ScanStatus = "running" | "completed" | "failed";

type ScoredRow = {
  symbol: string;
  name: string;
  sector: string;
  composite: number;
  confidence: number;
  weights: Record<string, number>;
  components: ComponentScores;
  features: FeatureVector;
  aiThesis: AiThesis | null;
};

// Per-chunk sizing. Each chunk runs inside one server-fn invocation, which on
// Cloudflare Workers has a ~30s CPU budget. 40 symbols × ~1-2s each (parallel
// fetch with 20-way concurrency) fits comfortably; cache hits are near-free.
const CHUNK_SYMBOLS = 40;
const FETCH_CONCURRENCY = 20;
// Hard per-symbol network timeout. Without this a single hung Yahoo connection
// stalled entire chunks (root cause of the 296/4211 stall the user reported).
const FETCH_TIMEOUT_MS = 12_000;
// Data-freshness guard: reject bars whose newest timestamp is older than N
// calendar days. 10 covers a long weekend + Monday holiday.
const MAX_STALENESS_DAYS = 10;
const TOP_KEEP = 250;
const AI_CONCURRENCY = 4;

type FetchOutcome =
  | { ok: true; bars: Bar[]; source: "yahoo"; ms: number }
  | { ok: false; reason: string; ms: number };

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function isFresh(bars: Bar[]): boolean {
  const newest = bars[0]?.datetime;
  if (!newest) return false;
  const t = new Date(newest).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= MAX_STALENESS_DAYS * 24 * 60 * 60 * 1000;
}

async function fetchBars(symbol: string): Promise<FetchOutcome> {
  const start = Date.now();
  try {
    const bars = await withTimeout(fetchYahooDaily(symbol, 1300), FETCH_TIMEOUT_MS, symbol);
    const ms = Date.now() - start;
    if (!bars.length) return { ok: false, reason: "empty", ms };
    const oriented = bars.slice(-1300).reverse();
    if (!isFresh(oriented)) return { ok: false, reason: `stale:${oriented[0]?.datetime ?? "?"}`, ms };
    return { ok: true, bars: oriented, source: "yahoo", ms };
  } catch (err) {
    const ms = Date.now() - start;
    const reason = err instanceof Error ? (err.message.startsWith("timeout:") ? "timeout" : err.message.slice(0, 60)) : "unknown";
    return { ok: false, reason, ms };
  }
}

async function getSpyBars(): Promise<Bar[] | null> {
  const cached = await readBarCache(["SPY"]);
  const hit = cached.get("SPY");
  if (hit?.length) return hit;
  const outcome = await fetchBars("SPY");
  if (outcome.ok) {
    await writeBarCache([{ symbol: "SPY", bars: outcome.bars }]);
    return outcome.bars;
  }
  console.error(`[future-leaders] SPY fetch failed: ${outcome.reason}`);
  return null;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
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
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length));
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

function scoreOne(sym: string, bars: Bar[] | null, spyBars: Bar[] | null): ScoredRow | null {
  if (!bars || bars.length < 60) return null;
  const f = computeFeatureVector(sym, bars, spyBars);
  if (!f) return null;
  const c = computeComposite(f);
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
    aiThesis: null,
  };
}

function keepBestRows(rows: ScoredRow[]): ScoredRow[] {
  const bySymbol = new Map<string, ScoredRow>();
  for (const row of rows) bySymbol.set(row.symbol, row);
  const out = Array.from(bySymbol.values()).sort((a, b) => b.composite - a.composite);
  if (out.length > TOP_KEEP) out.length = TOP_KEEP;
  return out;
}

function toRankingRow(snapshotId: string, row: ScoredRow, idx: number) {
  return {
    snapshot_id: snapshotId,
    symbol: row.symbol,
    rank: idx + 1,
    composite_score: row.composite,
    confidence: row.confidence,
    component_scores: {
      historical: row.components.historical.score,
      momentum: row.components.momentum.score,
      quality: row.components.quality.score,
      relativeStrength: row.components.relativeStrength.score,
      risk: row.components.risk.score,
    },
    evidence: {
      name: row.name,
      sector: row.sector,
      reasons: {
        historical: row.components.historical.reasons,
        momentum: row.components.momentum.reasons,
        quality: row.components.quality.reasons,
        relativeStrength: row.components.relativeStrength.reasons,
        risk: row.components.risk.reasons,
      },
      features: {
        price: row.features.price,
        asOf: row.features.asOf,
        ret12m: row.features.ret12m,
        ret6m: row.features.ret6m,
        cagr5y: row.features.cagr5y,
        distFromHigh52wPct: row.features.distFromHigh52wPct,
        distSma200Pct: row.features.distSma200Pct,
        sma200SlopePct: row.features.sma200SlopePct,
        stage2: row.features.stage2,
        volAnn250: row.features.volAnn250,
        maxDrawdown1y: row.features.maxDrawdown1y,
        beta250: row.features.beta250,
        rsMansfield: row.features.rsMansfield,
        avgDollarVol20: row.features.avgDollarVol20,
      },
    },
    ai_thesis: row.aiThesis,
  };
}

function fromRankingRow(row: {
  symbol: string;
  composite_score: number;
  confidence: number;
  component_scores: unknown;
  evidence: unknown;
  ai_thesis: unknown;
}, weights: Record<string, number>): ScoredRow | null {
  const evidence = row.evidence as { name?: string; sector?: string; reasons?: ScoredRow["components"]; features?: FeatureVector } | null;
  const componentScores = row.component_scores as Record<string, number> | null;
  const reasons = (evidence as { reasons?: Record<string, string[]> } | null)?.reasons ?? {};
  const features = evidence?.features;
  if (!componentScores || !features) return null;
  return {
    symbol: row.symbol,
    name: evidence?.name ?? row.symbol,
    sector: evidence?.sector ?? "—",
    composite: Number(row.composite_score),
    confidence: Number(row.confidence),
    weights,
    components: {
      historical: { score: Number(componentScores.historical ?? 0), reasons: reasons.historical ?? [], dataComplete: true },
      momentum: { score: Number(componentScores.momentum ?? 0), reasons: reasons.momentum ?? [], dataComplete: true },
      quality: { score: Number(componentScores.quality ?? 0), reasons: reasons.quality ?? [], dataComplete: true },
      relativeStrength: { score: Number(componentScores.relativeStrength ?? 0), reasons: reasons.relativeStrength ?? [], dataComplete: true },
      risk: { score: Number(componentScores.risk ?? 0), reasons: reasons.risk ?? [], dataComplete: true },
    },
    features,
    aiThesis: row.ai_thesis as AiThesis | null,
  };
}

async function loadRows(snapshotId: string, weights: Record<string, number>): Promise<ScoredRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("future_leaders_rankings")
    .select("symbol, composite_score, confidence, component_scores, evidence, ai_thesis")
    .eq("snapshot_id", snapshotId)
    .order("rank", { ascending: true })
    .limit(TOP_KEEP);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Parameters<typeof fromRankingRow>[0]>).map((r) => fromRankingRow(r, weights)).filter(Boolean) as ScoredRow[];
}

async function saveRows(args: {
  snapshotId: string;
  rows: ScoredRow[];
  failed: string[];
  processed: number;
  succeeded: number;
  status: ScanStatus;
  errorMessage?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ordered = keepBestRows(args.rows);
  const { error: deleteErr } = await supabaseAdmin.from("future_leaders_rankings").delete().eq("snapshot_id", args.snapshotId);
  if (deleteErr) throw new Error(`Rankings refresh failed: ${deleteErr.message}`);
  const rankingRows = ordered.map((row, idx) => toRankingRow(args.snapshotId, row, idx));
  for (let i = 0; i < rankingRows.length; i += 100) {
    const chunk = rankingRows.slice(i, i + 100);
    const { error } = await supabaseAdmin.from("future_leaders_rankings").insert(chunk);
    if (error) throw new Error(`Rankings insert failed at chunk ${i}: ${error.message}`);
  }
  const { error: snapErr } = await supabaseAdmin
    .from("future_leaders_snapshots")
    .update({
      status: args.status,
      processed_count: args.processed,
      succeeded_count: args.succeeded,
      failed_symbols: args.failed.slice(-500),
      weights: ordered[0]?.weights ?? {},
      duration_ms: 0,
      error_message: args.errorMessage ?? null,
    })
    .eq("id", args.snapshotId);
  if (snapErr) throw new Error(`Snapshot update failed: ${snapErr.message}`);
}

// ─── Future-leaders new-pick broadcast ─────────────────────────────────
// Sends one Telegram message per newly-appearing top-ranked ticker to every
// user with future_leaders_enabled. Dedup per (symbol, snapshot_date) via
// alert_deliveries so a symbol only alerts once per completed scan.
async function broadcastFutureLeaders(snapshotId: string, topRows: ScoredRow[]) {
  if (topRows.length === 0) return;
  const { loadLinkedRecipients, sendRaw, escapeHtml } = await import("../telegram-notify.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const recipients = await loadLinkedRecipients("future_leaders");
  if (recipients.length === 0) return;
  const sessionDate = new Date().toISOString().slice(0, 10);
  const TOP_ALERT = 10;
  const picks = topRows.slice(0, TOP_ALERT);
  for (const rec of recipients) {
    for (const row of picks) {
      const alertKey = `FUTURE_LEADER|${sessionDate}|${row.symbol}`;
      const { error } = await supabaseAdmin.from("alert_deliveries").insert({
        user_id: rec.userId,
        symbol: row.symbol,
        alert_key: alertKey,
        alert_kind: "FUTURE_LEADER",
        target_price: 0,
        live_price: 0,
        distance_pct: 0,
        message: `FUTURE_LEADER ${row.symbol}`,
      });
      if (error) continue; // dedup on unique-violation
      const sym = escapeHtml(row.symbol);
      const name = escapeHtml(row.name ?? "");
      const sector = escapeHtml(row.sector ?? "");
      const thesis = row.aiThesis?.thesis ? `\n${escapeHtml(row.aiThesis.thesis).slice(0, 240)}` : "";
      const msg =
        `🏆 <b>FUTURE LEADER · ${sym}</b>${name ? ` — ${name}` : ""}\n` +
        `Score ${Math.round(row.composite)} · Confidence ${Math.round(row.confidence * 100)}%` +
        (sector ? ` · ${sector}` : "") +
        thesis +
        `\n📊 https://www.tradingview.com/chart/?symbol=${sym}` +
        `\n<i>snapshot ${snapshotId.slice(0, 8)}</i>`;
      await sendRaw(rec.chatId, msg);
    }
  }
}

export async function startScanImpl(opts: {
  limit?: number;
  actor: string;
}): Promise<{ snapshotId: string; processed: number; ranked: number; failed: number; status: ScanStatus }> {
  const symbols = (opts.limit ? UNIVERSE_SYMBOLS.slice(0, opts.limit) : UNIVERSE_SYMBOLS).slice();
  const spyBars = await getSpyBars();
  const regime = detectRegime(spyBars);
  const spyChangePct = spyBars && spyBars.length >= 2 ? ((spyBars[0].close - spyBars[1].close) / spyBars[1].close) * 100 : null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("future_leaders_snapshots")
    .insert({
      scanned_at: new Date().toISOString(),
      universe_size: symbols.length,
      eligible_size: 0,
      failed_symbols: [],
      spy_change_pct: spyChangePct,
      regime,
      weights: {},
      duration_ms: 0,
      triggered_by: opts.actor,
      status: "running",
      processed_count: 0,
      succeeded_count: 0,
      error_message: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to start Future Leaders scan");
  return { snapshotId: data.id as string, processed: 0, ranked: 0, failed: 0, status: "running" };
}

export async function processScanChunkImpl(opts: {
  snapshotId: string;
  aiTopN?: number;
}): Promise<{ snapshotId: string; processed: number; ranked: number; failed: number; status: ScanStatus }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: snapshot, error: snapErr } = await supabaseAdmin
    .from("future_leaders_snapshots")
    .select("*")
    .eq("id", opts.snapshotId)
    .single();
  if (snapErr || !snapshot) throw new Error(snapErr?.message ?? "Future Leaders snapshot not found");
  if (snapshot.status !== "running") {
    return {
      snapshotId: opts.snapshotId,
      processed: Number(snapshot.processed_count ?? 0),
      ranked: Number(snapshot.succeeded_count ?? 0),
      failed: ((snapshot.failed_symbols as string[] | null) ?? []).length,
      status: snapshot.status as ScanStatus,
    };
  }

  const universeSize = Number(snapshot.universe_size ?? UNIVERSE_SYMBOLS.length);
  const processedStart = Number(snapshot.processed_count ?? 0);
  const symbols = UNIVERSE_SYMBOLS.slice(0, universeSize);
  const chunk = symbols.slice(processedStart, Math.min(universeSize, processedStart + CHUNK_SYMBOLS));
  const weights = (snapshot.weights as Record<string, number> | null) ?? {};
  const rows = await loadRows(opts.snapshotId, weights);
  const failed = ((snapshot.failed_symbols as string[] | null) ?? []).slice();
  const spyBars = await getSpyBars();

  let processed = processedStart;
  let succeeded = Number(snapshot.succeeded_count ?? rows.length);

  try {
    const cached = await readBarCache(chunk);
    const missing: string[] = [];
    let cacheHits = 0;
    for (const sym of chunk) {
      const bars = cached.get(sym);
      if (bars?.length) {
        cacheHits++;
        processed++;
        const row = scoreOne(sym, bars, spyBars);
        if (row) { rows.push(row); succeeded++; }
        else failed.push(sym);
      } else {
        missing.push(sym);
      }
    }

    // Wide-parallel fetch: pull all `missing` symbols concurrently with a
    // bounded worker pool. Per-symbol timeout guarantees the chunk finishes
    // in bounded time even if a Yahoo connection hangs.
    const chunkStart = Date.now();
    const failReasons: Record<string, number> = {};
    let netOk = 0;
    const cacheWrites: Array<{ symbol: string; bars: Bar[] }> = [];
    await runWithConcurrency(missing, FETCH_CONCURRENCY, async (sym) => {
      const outcome = await fetchBars(sym);
      processed++;
      if (outcome.ok) {
        netOk++;
        cacheWrites.push({ symbol: sym, bars: outcome.bars });
        const row = scoreOne(sym, outcome.bars, spyBars);
        if (row) { rows.push(row); succeeded++; }
        else { failed.push(sym); failReasons["score-null"] = (failReasons["score-null"] ?? 0) + 1; }
      } else {
        failed.push(sym);
        failReasons[outcome.reason] = (failReasons[outcome.reason] ?? 0) + 1;
      }
      return null;
    });
    if (cacheWrites.length) await writeBarCache(cacheWrites);
    const chunkMs = Date.now() - chunkStart;
    console.log(
      `[future-leaders] chunk done: ${chunk.length} symbols in ${chunkMs}ms ` +
      `(cache:${cacheHits} yahoo-ok:${netOk} failed:${chunk.length - cacheHits - netOk}) ` +
      `progress ${processed}/${universeSize} succeeded:${succeeded} ` +
      `reasons=${JSON.stringify(failReasons)}`,
    );

    let status: ScanStatus = processed >= universeSize ? "completed" : "running";
    const topRows = keepBestRows(rows);
    if (status === "completed" && opts.aiTopN && opts.aiTopN > 0) {
      const topN = Math.min(opts.aiTopN, topRows.length);
      await runWithConcurrency(topRows.slice(0, topN), AI_CONCURRENCY, async (row) => {
        if (row.aiThesis) return null;
        try {
          row.aiThesis = await generateThesis(row.symbol, row.name, row.sector, row.features, row.components, row.composite, row.confidence);
        } catch (err) {
          console.error(`[future-leaders] AI thesis failed for ${row.symbol}:`, err);
        }
        return null;
      });
    }
    await saveRows({ snapshotId: opts.snapshotId, rows: topRows, failed, processed, succeeded, status });
    if (status === "completed") {
      try { await broadcastFutureLeaders(opts.snapshotId, topRows); }
      catch (e) { console.error("[future-leaders] broadcast failed:", e); }
    }
    return { snapshotId: opts.snapshotId, processed, ranked: succeeded, failed: failed.length, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await saveRows({ snapshotId: opts.snapshotId, rows, failed, processed, succeeded, status: "failed", errorMessage: message });
    throw err;
  }
}

export async function runScanImpl(opts: {
  aiTopN: number;
  limit?: number;
  actor: string;
}): Promise<{ snapshotId: string; ranked: number; failed: number }> {
  const started = await startScanImpl({ limit: opts.limit, actor: opts.actor });
  let current = started;
  const maxChunks = Math.ceil((opts.limit ?? UNIVERSE_SYMBOLS.length) / CHUNK_SYMBOLS);
  for (let i = 0; i < maxChunks && current.status === "running"; i++) {
    current = await processScanChunkImpl({ snapshotId: started.snapshotId, aiTopN: opts.aiTopN });
  }
  void FUTURE_LEADERS_UNIVERSE.length;
  return { snapshotId: started.snapshotId, ranked: current.ranked, failed: current.failed };
}