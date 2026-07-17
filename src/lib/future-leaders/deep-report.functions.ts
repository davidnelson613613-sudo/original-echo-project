// Client-callable wrapper for the deep report.
// Loads (and caches) an in-depth per-symbol analysis for a given snapshot row.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DeepReport } from "./deep-report.server";
import type { FeatureVector } from "./features.server";

export type { DeepReport } from "./deep-report.server";

const inputSchema = z.object({
  snapshotId: z.string().uuid(),
  symbol: z.string().min(1).max(10),
  regenerate: z.boolean().optional(),
});

export const getFutureLeaderDeepReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => inputSchema.parse(raw))
  .handler(async ({ data, context }): Promise<DeepReport> => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("future_leaders_rankings")
      .select("symbol, composite_score, confidence, component_scores, evidence, deep_report")
      .eq("snapshot_id", data.snapshotId)
      .eq("symbol", data.symbol.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(`Ranking not found: ${data.symbol} in snapshot ${data.snapshotId}`);

    // Cache invalidation: older cached reports predate the enriched AI schema
    // (whyRankedHere / historicalPatternExplained / keyMetricsExplained / oneYearOutlook / whatToWatch).
    // Force a regeneration when any of those fields are missing so users see the upgraded report.
    const cached = row.deep_report as DeepReport | null;
    const cachedIsFresh =
      !!cached &&
      !!cached.aiThesis &&
      cached.aiSucceeded === true &&
      Array.isArray((cached.aiThesis as { whyRankedHere?: unknown }).whyRankedHere) &&
      ((cached.aiThesis as { whyRankedHere?: unknown[] }).whyRankedHere as unknown[]).length > 0 &&
      typeof (cached.aiThesis as { historicalPatternExplained?: unknown }).historicalPatternExplained === "string" &&
      Array.isArray((cached.aiThesis as { keyMetricsExplained?: unknown }).keyMetricsExplained);
    if (cached && cachedIsFresh && !data.regenerate) {
      return cached;
    }

    // Load snapshot weights so score breakdown honors regime-adjusted weights.
    const { data: snap } = await supabase
      .from("future_leaders_snapshots")
      .select("weights")
      .eq("id", data.snapshotId)
      .maybeSingle();
    const weights = (snap?.weights as Record<string, number>) ?? {};

    const evidence = row.evidence as { name?: string; sector?: string; features?: FeatureVector } | null;
    const features = evidence?.features;
    if (!features) throw new Error(`Ranking has no feature vector: ${data.symbol}`);

    const componentScores = row.component_scores as Record<string, number> | null;
    if (!componentScores) throw new Error(`Ranking has no component scores: ${data.symbol}`);

    const { generateDeepReport } = await import("./deep-report.server");
    const report = await generateDeepReport({
      symbol: row.symbol,
      name: evidence?.name ?? row.symbol,
      sector: evidence?.sector ?? "—",
      features,
      composite: Number(row.composite_score),
      confidence: Number(row.confidence),
      components: {
        historical: Number(componentScores.historical ?? 0),
        momentum: Number(componentScores.momentum ?? 0),
        quality: Number(componentScores.quality ?? 0),
        relativeStrength: Number(componentScores.relativeStrength ?? 0),
        risk: Number(componentScores.risk ?? 0),
      },
      weights,
    });

    // Persist cache (best-effort — service role via admin so RLS is not a blocker)
    // Only cache successful AI generations; retry-on-next-click otherwise.
    if (report.aiSucceeded) try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("future_leaders_rankings")
        .update({ deep_report: report })
        .eq("snapshot_id", data.snapshotId)
        .eq("symbol", row.symbol);
    } catch (err) {
      console.error(`[deep-report] cache write failed for ${row.symbol}:`, err);
    }

    return report;
  });