// Public read-only health endpoint. Reports per-provider success/failure
// counters and the Yahoo circuit-breaker state so you can eyeball degradation
// without tailing logs. No PII, no writes.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health/providers")({
  server: {
    handlers: {
      GET: async () => {
        const { snapshotProviderStats } = await import("@/lib/provider-stats.server");
        const { yahooBreakerSnapshot, YAHOO_POOL_SIZE } = await import(
          "@/lib/yahoo-identities.server"
        );
        return Response.json(
          {
            at: new Date().toISOString(),
            yahooBreaker: yahooBreakerSnapshot(),
            yahooPoolSize: YAHOO_POOL_SIZE,
            providers: snapshotProviderStats(),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
