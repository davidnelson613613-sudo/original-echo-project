// Server functions for the Momentum Rockets scanner.
// Mirrors future-leaders/scan.functions.ts but with rocket-specific types
// and points at momentum_rockets_* tables.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// --- Types (safe for client import) ---
export type RocketRow = {
  symbol: string;
  name: string;
  sector: string;
  rank: number;
  composite: number;
  confidence: number;
  components: {
    breakout: number;
    momentum: number;
    volumeSurge: number;
    volatilityFuel: number;
    risk: number;
  };
  reasons: {
    breakout: string[];
    momentum: string[];
    volumeSurge: string[];
    volatilityFuel: string[];
    risk: string[];
  };
  features: {
    price: number;
    asOf: string;
    ret1m: number | null;
    ret3m: number | null;
    distFromHigh52wPct: number | null;
    distFrom20dHighPct: number | null;
    distFrom50dHighPct: number | null;
    barsSince20dHigh: number | null;
    upDayRatio20: number | null;
    upDayRatio60: number | null;
    volAnn20: number | null;
    volAnn60: number | null;
    dollarVolThrust5v60: number | null;
    volumeTrendRatio: number | null;
    avgDollarVol20: number | null;
    maxDrawdown1y: number | null;
  };
  aiThesis: {
    thesis: string;
    bullCase: string[];
    bearCase: string[];
    invalidation: string[];
    watchFor: string[];
    notes: string;
  } | null;
};

export type RocketSnapshot = {
  scannedAt: string;
  universeSize: number;
  eligibleSize: number;
  succeeded: number;
  failed: string[];
  spyChangePct: number | null;
  regime: string;
  weights: Record<string, number>;
  rows: RocketRow[];
};

// --- Read latest snapshot ---
export const getLatestMomentumRockets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RocketSnapshot | null> => {
    const { supabase } = context;
    const { data: snapshot, error: snapErr } = await supabase
      .from("momentum_rockets_snapshots")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapErr) throw new Error(snapErr.message);
    if (!snapshot) return null;

    const { data: rows, error: rowsErr } = await supabase
      .from("momentum_rockets_rankings")
      .select("*")
      .eq("snapshot_id", snapshot.id)
      .order("rank", { ascending: true });
    if (rowsErr) throw new Error(rowsErr.message);

    return {
      scannedAt: snapshot.scanned_at,
      universeSize: snapshot.universe_size,
      eligibleSize: snapshot.eligible_size ?? (rows ?? []).length,
      succeeded: (rows ?? []).length,
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
        components: r.component_scores as RocketRow["components"],
        reasons: (r.evidence as { reasons?: RocketRow["reasons"] }).reasons ?? {
          breakout: [], momentum: [], volumeSurge: [], volatilityFuel: [], risk: [],
        },
        features: (r.evidence as { features?: RocketRow["features"] }).features as RocketRow["features"],
        aiThesis: r.ai_thesis as RocketRow["aiThesis"],
      })),
    };
  });

// --- Run scan (any authenticated user; actor is logged) ---
const runInput = z.object({
  aiTopN: z.number().int().min(0).max(50).optional(),
  limit: z.number().int().min(10).max(5000).optional(),
});

export const runMomentumRocketsScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => runInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<{ ok: true; snapshotId: string; ranked: number; failed: number }> => {
    const { userId } = context;
    const { runRocketsScanImpl } = await import("./scan-impl.server");
    const result = await runRocketsScanImpl({
      aiTopN: data.aiTopN ?? 15,
      limit: data.limit,
      actor: userId ?? "auth",
    });
    return { ok: true, snapshotId: result.snapshotId, ranked: result.ranked, failed: result.failed };
  });
