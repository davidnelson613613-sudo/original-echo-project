import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Loader2, Database, PlayCircle, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  runFredBackfillFn,
  listMarketEventsFn,
  listRecentIngestRunsFn,
  marketSeriesCoverageFn,
} from "@/lib/market-data/fred-ingest.functions";
import { FRED_STARTER_SERIES } from "@/lib/market-data/fred-series";

export const Route = createFileRoute("/_authenticated/systemic-risk/events")({
  head: () => ({
    meta: [
      { title: "Systemic Risk — Historical Event Library" },
      { name: "description", content: "Curated catalog of major market events (1929–today) and the raw macro series backing the Systemic Risk Engine." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EventLibraryPage,
});

function EventLibraryPage() {
  const listEvents = useServerFn(listMarketEventsFn);
  const listRuns = useServerFn(listRecentIngestRunsFn);
  const listCoverage = useServerFn(marketSeriesCoverageFn);
  const runBackfill = useServerFn(runFredBackfillFn);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const eventsQ = useQuery({ queryKey: ["market-events"], queryFn: () => listEvents() });
  const runsQ = useQuery({ queryKey: ["ingest-runs"], queryFn: () => listRuns(), refetchInterval: 5_000 });
  const coverageQ = useQuery({ queryKey: ["market-series-coverage"], queryFn: () => listCoverage(), refetchInterval: 10_000 });

  const backfillMut = useMutation({
    mutationFn: (fullBackfill: boolean) => runBackfill({ data: { fullBackfill } }),
    onSuccess: () => {
      runsQ.refetch();
      coverageQ.refetch();
    },
  });

  const categories = eventsQ.data
    ? Array.from(new Set(eventsQ.data.map((e) => e.category))).sort()
    : [];
  const filteredEvents = eventsQ.data?.filter((e) =>
    categoryFilter === "all" ? true : e.category === categoryFilter,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/systemic-risk"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Systemic Risk
          </Link>
        </div>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Historical Event Library</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Phase 1 of the Systemic Risk Intelligence Engine — the durable data foundation. This page shows every
            curated historical event, the raw FRED macro series ingested so far, and the ingestion job log.
          </p>
        </header>

        {/* Data ingestion */}
        <section className="mb-10 rounded-lg border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-medium">
                <Database className="h-5 w-5" /> Macro Data Ingestion (FRED)
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {FRED_STARTER_SERIES.length} starter series. Daily incremental via cron; full backfill loads decades of history.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => backfillMut.mutate(false)}
                disabled={backfillMut.isPending}
                className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                {backfillMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Incremental (90d)
              </button>
              <button
                onClick={() => backfillMut.mutate(true)}
                disabled={backfillMut.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {backfillMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Full backfill
              </button>
            </div>
          </div>

          {backfillMut.data && (
            <div className="mb-3 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm">
              <div className="font-medium">Backfill complete</div>
              <div className="text-muted-foreground">
                {backfillMut.data.total_rows.toLocaleString()} rows upserted across {backfillMut.data.results.length} series
                {backfillMut.data.errors > 0 && ` — ${backfillMut.data.errors} errors`}
              </div>
            </div>
          )}
          {backfillMut.isError && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(backfillMut.error as Error).message}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Series</th>
                  <th className="px-2 py-1.5">Label</th>
                  <th className="px-2 py-1.5">Category</th>
                  <th className="px-2 py-1.5">Rows</th>
                  <th className="px-2 py-1.5">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {FRED_STARTER_SERIES.map((s) => {
                  const cov = coverageQ.data?.find((c) => c.series_id === s.series_id);
                  return (
                    <tr key={s.series_id} className="border-t border-border/50">
                      <td className="px-2 py-1.5 font-mono text-xs">{s.series_id}</td>
                      <td className="px-2 py-1.5">{s.label}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{s.category}</td>
                      <td className="px-2 py-1.5 tabular-nums">{cov?.count.toLocaleString() ?? "—"}</td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">
                        {cov ? `${cov.min} → ${cov.max}` : "(no data yet)"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recent ingest runs */}
        <section className="mb-10 rounded-lg border bg-card p-5">
          <h2 className="mb-3 text-lg font-medium">Recent Ingestion Runs</h2>
          {runsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : runsQ.data && runsQ.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Started</th>
                    <th className="px-2 py-1.5">Source</th>
                    <th className="px-2 py-1.5">Series</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5">Rows</th>
                    <th className="px-2 py-1.5">Duration</th>
                    <th className="px-2 py-1.5">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runsQ.data.slice(0, 30).map((r) => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="px-2 py-1.5 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.started_at).toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5">{r.source}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.series_id ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.status === "ok" ? (
                          <span className="inline-flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> ok</span>
                        ) : r.status === "error" ? (
                          <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" /> error</span>
                        ) : (
                          <span className="text-muted-foreground">{r.status}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{r.rows_upserted?.toLocaleString() ?? 0}</td>
                      <td className="px-2 py-1.5 tabular-nums text-xs text-muted-foreground">
                        {r.duration_ms != null ? `${r.duration_ms} ms` : "—"}
                      </td>
                      <td className="px-2 py-1.5 max-w-md truncate text-xs text-destructive">{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No ingestion runs yet. Click "Full backfill" above to load history.</div>
          )}
        </section>

        {/* Event catalog */}
        <section className="rounded-lg border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Curated Event Catalog</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {eventsQ.data?.length ?? 0} events spanning 1929–today. These anchor the historical analog matcher and validation framework.
              </p>
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {eventsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading events…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Start</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Category</th>
                    <th className="px-2 py-1.5">Severity</th>
                    <th className="px-2 py-1.5">Drawdown</th>
                    <th className="px-2 py-1.5">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents?.map((e) => (
                    <tr key={e.id} className="border-t border-border/50">
                      <td className="px-2 py-1.5 whitespace-nowrap font-mono text-xs">{e.start_date}</td>
                      <td className="px-2 py-1.5">{e.name}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{e.category}</td>
                      <td className="px-2 py-1.5">
                        <span className={
                          e.severity === "severe" ? "text-destructive" :
                          e.severity === "strong" ? "text-green-500" :
                          "text-muted-foreground"
                        }>
                          {e.severity}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {e.peak_drawdown != null ? `${(e.peak_drawdown * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td className="px-2 py-1.5 max-w-lg text-xs text-muted-foreground">{e.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
