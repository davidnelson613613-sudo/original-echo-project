// Public server functions for the v2 Systemic Risk Intelligence Engine.
// UI reads snapshots (fast, cached in DB) and can trigger recompute.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const computeRiskSnapshotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { asOf?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const started = Date.now();
    const { loadSeriesMap, computeFeatureVector, computeVectorSeries, FEATURE_DEFS } = await import("./features.server");
    const { runAllModels, composite, findAnalogs } = await import("./scoring.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const sm = await loadSeriesMap();
    const asOf = data.asOf ?? new Date().toISOString().slice(0, 10);
    const today = computeFeatureVector(asOf, sm);
    const models = runAllModels(today);
    const comp = composite(today, models);

    // Build historical vector series (monthly) back to 1962 for analog matching.
    // Guard: if no data yet, use a shallow window.
    let history: ReturnType<typeof computeVectorSeries> = [];
    const earliest = "1962-01-01";
    if (sm.get("DGS10")?.length ?? 0) {
      history = computeVectorSeries(sm, earliest, asOf);
    }

    const { data: events } = await supabaseAdmin
      .from("market_events")
      .select("slug, name, category, start_date, end_date");
    const analogs = findAnalogs(today, history, (events ?? []) as {
      slug: string; name: string; category: string; start_date: string; end_date: string | null;
    }[], 8);

    // Persist to feature store (upsert today's row for each feature)
    const featureRows = today.values.map((v) => ({
      date: today.as_of,
      feature_key: v.key,
      value: v.value,
      zscore: v.zscore,
      percentile: v.percentile,
      block: v.block,
      confidence_tier: v.confidence_tier,
      metadata: {
        risk_score: v.risk_score,
        risk_direction: FEATURE_DEFS.find((d) => d.key === v.key)?.risk_direction ?? 0,
      },
    }));
    if (featureRows.length) {
      await supabaseAdmin.from("market_features").upsert(featureRows, { onConflict: "date,feature_key" });
    }

    const snapshot = {
      as_of: today.as_of,
      composite_score: comp.composite,
      regime_label: comp.regime,
      confidence: comp.confidence,
      model_contributions: comp.models,
      top_contributors: comp.top_contributors,
      analog_matches: analogs,
      missing_data: today.missing,
      feature_snapshot: {
        values: today.values,
        coverage: today.coverage,
      },
      computed_at: new Date().toISOString(),
      computation_ms: Date.now() - started,
    };
    await supabaseAdmin.from("systemic_risk_v2_snapshots").upsert(snapshot, { onConflict: "as_of" });
    return snapshot;
  });

export const getLatestRiskSnapshotFn = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("systemic_risk_v2_snapshots")
    .select("*")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
});

export const listRiskTimelineFn = createServerFn({ method: "GET" })
  .inputValidator((input: { limit?: number } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("systemic_risk_v2_snapshots")
      .select("as_of, composite_score, regime_label, confidence")
      .order("as_of", { ascending: true })
      .limit(data.limit ?? 1000);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const runBacktestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { startIso?: string; endIso?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { runBacktest } = await import("./backtest.server");
    return runBacktest({ startIso: data.startIso, endIso: data.endIso });
  });

export const listBacktestRunsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("systemic_risk_v2_backtests")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
