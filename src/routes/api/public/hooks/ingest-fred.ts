// Cron endpoint for daily FRED ingestion. Follows the same apikey pattern
// as scan-tick / future-leaders-tick: pg_cron POSTs here with the Supabase
// publishable key in the `apikey` header.

import { createFileRoute } from "@tanstack/react-router";
import { requireCronSecret } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/ingest-fred")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = requireCronSecret(request);
        if (unauth) return unauth;
        let fullBackfill = false;
        let sinceDays: number | undefined;
        try {
          const body = (await request.json()) as { fullBackfill?: boolean; sinceDays?: number } | null;
          fullBackfill = body?.fullBackfill === true;
          sinceDays = body?.sinceDays;
        } catch {
          // no body — daily incremental
        }
        try {
          const { ingestAllFredStarter } = await import("@/lib/market-data/fred-ingest.server");
          const result = await ingestAllFredStarter({ fullBackfill, sinceDays });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[ingest-fred] failed:", msg);
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
