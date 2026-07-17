// Server-function surface for the Systemic Risk engine.
//
// Public-safe reads (getLatestSnapshot, getBacktest) do not require auth.
// The refresh/backtest triggers use the admin client to write snapshots
// after computing. The compute path is heavy — ~30 Yahoo fetches plus
// ~200 feature evaluations — and is cached in-memory + in Postgres.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RefreshInput = z.object({ force: z.boolean().optional() });
const BacktestInput = z.object({ windowBefore: z.number().min(30).max(365).optional(), stride: z.number().min(1).max(20).optional() });

export const getLatestSystemicSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("systemic_risk_snapshots")
    .select("*")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
});

export const refreshSystemicSnapshot = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => RefreshInput.parse(v ?? {}))
  .handler(async ({ data }) => {
    const { computeSnapshot } = await import("./systemic-risk/engine.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!data.force) {
      const { data: existing } = await supabaseAdmin
        .from("systemic_risk_snapshots")
        .select("as_of, updated_at")
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        const ageMs = Date.now() - new Date(existing.updated_at).getTime();
        if (ageMs < 6 * 60 * 60 * 1000) {
          return { skipped: true, reason: "recent snapshot exists", as_of: existing.as_of };
        }
      }
    }

    const snap = await computeSnapshot();
    const row = {
      as_of: snap.as_of,
      early_warning_score: snap.early_warning_score,
      regime: snap.regime,
      probabilities: snap.probabilities,
      indicators: { raw: snap.features_raw, z: snap.features_z, meta: snap.meta },
      top_analogs: snap.top_analogs,
      drivers: snap.drivers,
      disagreements: snap.disagreements,
      data_coverage: snap.data_coverage,
    };
    const { error } = await supabaseAdmin
      .from("systemic_risk_snapshots")
      .upsert(row, { onConflict: "as_of" });
    if (error) throw new Error(error.message);
    return { skipped: false, as_of: snap.as_of, ews: snap.early_warning_score, regime: snap.regime };
  });

export const getSystemicBacktest = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("systemic_risk_backtest_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
});

export const runSystemicBacktest = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => BacktestInput.parse(v ?? {}))
  .handler(async ({ data }) => {
    const { runBacktest } = await import("./systemic-risk/engine.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await runBacktest({ windowBefore: data.windowBefore, stride: data.stride });
    const label = `backtest_${new Date().toISOString().slice(0, 19)}`;
    const { error } = await supabaseAdmin.from("systemic_risk_backtest_runs").insert({
      run_label: label,
      summary: result.summary,
      per_event: result.per_event,
      timeline: result.timeline,
    });
    if (error) throw new Error(error.message);
    return { label, summary: result.summary };
  });
