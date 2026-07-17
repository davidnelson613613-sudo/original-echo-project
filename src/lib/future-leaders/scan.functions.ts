// Server functions for the Future Leaders Scanner.
//
// - runFutureLeadersScan: full sweep across the curated universe. Fetches
//   Yahoo daily bars (500-identity rotation, no keys), computes features,
//   runs the 5 component models, ranks, generates AI theses for the top 25,
//   and writes a snapshot + rankings rows via the admin client.
// - getLatestFutureLeaders: read newest snapshot with all rankings.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// --- Types (safe for client import) ---
export type LeaderRow = {
  symbol: string;
  name: string;
  sector: string;
  rank: number;
  composite: number;
  confidence: number;
  components: {
    historical: number;
    momentum: number;
    quality: number;
    relativeStrength: number;
    risk: number;
  };
  reasons: {
    historical: string[];
    momentum: string[];
    quality: string[];
    relativeStrength: string[];
    risk: string[];
  };
  features: {
    price: number;
    asOf: string;
    ret12m: number | null;
    ret6m: number | null;
    cagr5y: number | null;
    distFromHigh52wPct: number;
    distSma200Pct: number | null;
    sma200SlopePct: number | null;
    stage2: boolean;
    volAnn250: number | null;
    maxDrawdown1y: number;
    beta250: number | null;
    rsMansfield: number | null;
    avgDollarVol20: number | null;
  };
  aiThesis: {
    thesis: string;
    bullCase: string[];
    bearCase: string[];
    catalysts: string[];
    primaryAnalogs: string[];
    notes: string;
  } | null;
};

export type LeaderSnapshot = {
  snapshotId: string;
  scannedAt: string;
  universeSize: number;
  succeeded: number;
  processed: number;
  status: "running" | "completed" | "failed";
  errorMessage: string | null;
  failed: string[];
  spyChangePct: number | null;
  regime: string;
  weights: Record<string, number>;
  rows: LeaderRow[];
};

// --- Read: latest snapshot ---
export const getLatestFutureLeaders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeaderSnapshot | null> => {
    const { supabase } = context;
    const { data: snapshot, error: snapErr } = await supabase
      .from("future_leaders_snapshots")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapErr) throw new Error(snapErr.message);
    if (!snapshot) return null;

    const { data: rows, error: rowsErr } = await supabase
      .from("future_leaders_rankings")
      .select("*")
      .eq("snapshot_id", snapshot.id)
      .order("rank", { ascending: true });
    if (rowsErr) throw new Error(rowsErr.message);

    return {
      snapshotId: snapshot.id,
      scannedAt: snapshot.scanned_at,
      universeSize: snapshot.universe_size,
      succeeded: Number(snapshot.succeeded_count ?? (rows ?? []).length),
      processed: Number(snapshot.processed_count ?? snapshot.universe_size),
      status: (snapshot.status as LeaderSnapshot["status"] | null) ?? "completed",
      errorMessage: snapshot.error_message ?? null,
      failed: (snapshot.failed_symbols as string[] | null) ?? [],
      spyChangePct: snapshot.spy_change_pct != null ? Number(snapshot.spy_change_pct) : null,
      regime: snapshot.regime ?? "neutral",
      weights: (snapshot.weights as Record<string, number>) ?? {},
      rows: (rows ?? []).map((r) => ({
        symbol: r.symbol,
        name: (r.evidence as { name?: string })?.name ?? r.symbol,
        sector: (r.evidence as { sector?: string })?.sector ?? "—",
        rank: r.rank,
        composite: Number(r.composite_score),
        confidence: Number(r.confidence),
        components: r.component_scores as LeaderRow["components"],
        reasons: (r.evidence as { reasons?: LeaderRow["reasons"] }).reasons ?? {
          historical: [], momentum: [], quality: [], relativeStrength: [], risk: [],
        },
        features: (r.evidence as { features?: LeaderRow["features"] }).features as LeaderRow["features"],
        aiThesis: r.ai_thesis as LeaderRow["aiThesis"],
      })),
    };
  });

// --- Run scan (admin-triggered) ---
const runInput = z.object({
  aiTopN: z.number().int().min(0).max(50).optional(),
  limit: z.number().int().min(10).max(5000).optional(), // dev cap
});

export const runFutureLeadersScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw) => runInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<{ ok: true; snapshotId: string; ranked: number; failed: number }> => {
    const { supabase, userId } = context;
    // Any authenticated user may trigger a scan for MVP; log actor for audit.
    const { runScanImpl } = await import("./scan-impl.server");
    const result = await runScanImpl({ aiTopN: data.aiTopN ?? 25, limit: data.limit, actor: userId ?? "auth" });
    // The impl writes via supabaseAdmin; here we just return metadata.
    // Verify snapshot exists.
    const { data: snap } = await supabase
      .from("future_leaders_snapshots")
      .select("id")
      .eq("id", result.snapshotId)
      .maybeSingle();
    if (!snap) throw new Error("Snapshot write did not persist");
    return { ok: true, snapshotId: result.snapshotId, ranked: result.ranked, failed: result.failed };
  });

export const startFutureLeadersScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw) => runInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<{ ok: true; snapshotId: string; processed: number; ranked: number; failed: number; status: "running" | "completed" | "failed" }> => {
    const { startScanImpl, processScanChunkImpl } = await import("./scan-impl.server");
    const started = await startScanImpl({ limit: data.limit, actor: context.userId ?? "auth" });
    const firstChunk = await processScanChunkImpl({ snapshotId: started.snapshotId, aiTopN: data.aiTopN ?? 15 });
    return { ok: true, ...firstChunk };
  });

const continueInput = z.object({
  snapshotId: z.string().uuid(),
  aiTopN: z.number().int().min(0).max(50).optional(),
});

export const continueFutureLeadersScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw) => continueInput.parse(raw ?? {}))
  .handler(async ({ data }): Promise<{ ok: true; snapshotId: string; processed: number; ranked: number; failed: number; status: "running" | "completed" | "failed" }> => {
    const { processScanChunkImpl } = await import("./scan-impl.server");
    const result = await processScanChunkImpl({ snapshotId: data.snapshotId, aiTopN: data.aiTopN ?? 15 });
    return { ok: true, ...result };
  });
