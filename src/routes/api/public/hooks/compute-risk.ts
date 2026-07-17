// Cron endpoint — nightly systemic risk recompute + FRED refresh.
// Runs FRED incremental (last 90 days) then recomputes today's snapshot.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/compute-risk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        try {
          const { ingestAllFredStarter } = await import("@/lib/market-data/fred-ingest.server");
          const ingest = await ingestAllFredStarter({ sinceDays: 90 });

          const { loadSeriesMap, computeFeatureVector, computeVectorSeries, FEATURE_DEFS } = await import("@/lib/market-data/features.server");
          const { runAllModels, composite, findAnalogs } = await import("@/lib/market-data/scoring.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const sm = await loadSeriesMap();
          const asOf = new Date().toISOString().slice(0, 10);
          const today = computeFeatureVector(asOf, sm);
          const models = runAllModels(today);
          const comp = composite(today, models);
          const history = (sm.get("DGS10")?.length ?? 0) ? computeVectorSeries(sm, "1962-01-01", asOf) : [];
          const { data: events } = await supabaseAdmin
            .from("market_events")
            .select("slug, name, category, start_date, end_date");
          const analogs = findAnalogs(today, history, (events ?? []) as {
            slug: string; name: string; category: string; start_date: string; end_date: string | null;
          }[], 8);

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
            feature_snapshot: { values: today.values, coverage: today.coverage },
            computed_at: new Date().toISOString(),
          };
          await supabaseAdmin.from("systemic_risk_v2_snapshots").upsert(snapshot, { onConflict: "as_of" });

          return new Response(
            JSON.stringify({ ok: true, ingest_rows: ingest.total_rows, ingest_errors: ingest.errors, score: comp.composite, regime: comp.regime }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[compute-risk] failed:", msg);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
      GET: async () =>
        new Response(JSON.stringify({ ok: true, hint: "POST with apikey to run" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  },
});
