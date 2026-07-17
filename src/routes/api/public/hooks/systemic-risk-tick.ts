// Nightly cron endpoint: refreshes the systemic risk snapshot.
// Called by pg_cron on the daily schedule. No auth beyond the anon apikey
// header — the route recomputes deterministic public data.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/systemic-risk-tick")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { computeSnapshot } = await import("@/lib/systemic-risk/engine.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const snap = await computeSnapshot();
          const { error } = await supabaseAdmin
            .from("systemic_risk_snapshots")
            .upsert(
              {
                as_of: snap.as_of,
                early_warning_score: snap.early_warning_score,
                regime: snap.regime,
                probabilities: snap.probabilities,
                indicators: { raw: snap.features_raw, z: snap.features_z, meta: snap.meta },
                top_analogs: snap.top_analogs,
                drivers: snap.drivers,
                disagreements: snap.disagreements,
                data_coverage: snap.data_coverage,
              },
              { onConflict: "as_of" },
            );
          if (error) throw new Error(error.message);
          return Response.json({ ok: true, as_of: snap.as_of, ews: snap.early_warning_score });
        } catch (e) {
          console.error("[systemic-risk-tick] failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
