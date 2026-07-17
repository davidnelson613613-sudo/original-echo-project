// Cron entry point for the always-on scan + Telegram alert loop.
// pg_cron POSTs here on a schedule; the runner handles market-hours gating.
//
// Auth: expects the Supabase publishable/anon key in the `apikey` header
// (canonical pg_cron pattern). Bypasses auth at the edge via /api/public/.

import { createFileRoute } from "@tanstack/react-router";
import { runScanTick } from "@/lib/scan-runner.server";

export const Route = createFileRoute("/api/public/hooks/scan-tick")({
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
        let force = false;
        try {
          const body = (await request.json()) as { force?: boolean } | null;
          force = !!body?.force;
        } catch {
          /* body optional */
        }
        try {
          const result = await runScanTick({ force });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[scan-tick] failed:", msg);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
      // Allow manual GET checks (returns last run only when forced) — no side effects.
      GET: async () =>
        new Response(
          JSON.stringify({ ok: true, hint: "POST with apikey header to run" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    },
  },
});
