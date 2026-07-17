// Cron endpoint for the Future Leaders Scanner. Reuses the standard pg_cron
// pattern: apikey header = SUPABASE_PUBLISHABLE_KEY. Bypasses auth at
// /api/public/*, so we still verify the apikey inside the handler.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/future-leaders-tick")({
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
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: running } = await supabaseAdmin
            .from("future_leaders_snapshots")
            .select("id")
            .eq("status", "running")
            .order("scanned_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const { startScanImpl, processScanChunkImpl } = await import("@/lib/future-leaders/scan-impl.server");
          const started = running?.id
            ? { snapshotId: running.id as string }
            : await startScanImpl({ actor: "cron" });
          const result = await processScanChunkImpl({ snapshotId: started.snapshotId, aiTopN: 15 });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[future-leaders-tick] failed:", msg);
          import("@/lib/telegram-notify.server")
            .then((m) => m.notifySystemEvent("critical", "future_leaders_tick_failed", msg))
            .catch(() => {});
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
