import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, PlayCircle } from "lucide-react";
import { runBacktestFn, listBacktestRunsFn } from "@/lib/market-data/engine-v2.functions";

export const Route = createFileRoute("/_authenticated/systemic-risk/validation")({
  head: () => ({
    meta: [
      { title: "Systemic Risk — Validation" },
      { name: "description", content: "Backtest the Systemic Risk composite score against every historical major market event." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ValidationPage,
});

type Metrics = {
  n_dates: number; n_events: number; precision: number; recall: number; f1: number;
  lead_time_months_mean: number | null; lead_time_months_median: number | null;
  covered_events: { slug: string; name: string; start_date: string; lead_time_months: number | null; max_pre_event_score: number }[];
};
type ReliabilityBin = { decile: number; n: number; mean_predicted: number; hit_rate: number };

function ValidationPage() {
  const run = useServerFn(runBacktestFn);
  const list = useServerFn(listBacktestRunsFn);
  const listQ = useQuery({ queryKey: ["srv2-backtests"], queryFn: () => list() });
  const runMut = useMutation({
    mutationFn: () => run({ data: { startIso: "1970-01-01" } }),
    onSuccess: () => listQ.refetch(),
  });

  const latest = listQ.data?.[0];
  const metrics = latest?.metrics as Metrics | undefined;
  const bins = (latest?.reliability_bins as ReliabilityBin[] | undefined) ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4">
          <Link to="/systemic-risk/v2" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Engine
          </Link>
        </div>
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Validation Framework</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Measures lead-time before every historical bear market, recession, and credit/banking/liquidity crisis, plus precision/recall/F1 and calibration.
            </p>
          </div>
          <button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {runMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Run backtest (1970→today)
          </button>
        </header>

        {!latest ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No backtest runs yet. Click <b>Run backtest</b>.</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-lg border bg-card p-5">
              <div className="text-xs uppercase text-muted-foreground">Precision</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{metrics ? (metrics.precision * 100).toFixed(1) : "—"}%</div>
              <div className="mt-1 text-xs text-muted-foreground">Of alert months, share within 12m of a major event.</div>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <div className="text-xs uppercase text-muted-foreground">Recall</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{metrics ? (metrics.recall * 100).toFixed(1) : "—"}%</div>
              <div className="mt-1 text-xs text-muted-foreground">Of {metrics?.n_events ?? 0} events, share flagged in advance.</div>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <div className="text-xs uppercase text-muted-foreground">F1 Score</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{metrics ? metrics.f1.toFixed(3) : "—"}</div>
              <div className="mt-1 text-xs text-muted-foreground">Harmonic mean of precision + recall.</div>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <div className="text-xs uppercase text-muted-foreground">Mean Lead Time</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">
                {metrics?.lead_time_months_mean != null ? metrics.lead_time_months_mean.toFixed(1) : "—"} <span className="text-sm text-muted-foreground">months</span>
              </div>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <div className="text-xs uppercase text-muted-foreground">Median Lead Time</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">
                {metrics?.lead_time_months_median != null ? metrics.lead_time_months_median.toFixed(1) : "—"} <span className="text-sm text-muted-foreground">months</span>
              </div>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <div className="text-xs uppercase text-muted-foreground">Scope</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{latest.scope_start} → {latest.scope_end}</div>
              <div className="mt-1 text-xs text-muted-foreground">{metrics?.n_dates ?? 0} monthly anchors.</div>
            </div>

            <div className="rounded-lg border bg-card p-5 lg:col-span-3">
              <h2 className="mb-3 text-sm font-medium">Reliability Diagram — Predicted Score vs. 12-Month Event Rate</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">Decile</th>
                      <th className="px-2 py-1.5">n</th>
                      <th className="px-2 py-1.5">Mean Predicted</th>
                      <th className="px-2 py-1.5">Realized Hit Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bins.map((b) => (
                      <tr key={b.decile} className="border-t border-border/50">
                        <td className="px-2 py-1.5 tabular-nums">{b.decile * 10}–{(b.decile + 1) * 10}</td>
                        <td className="px-2 py-1.5 tabular-nums">{b.n}</td>
                        <td className="px-2 py-1.5 tabular-nums">{b.mean_predicted.toFixed(1)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{(b.hit_rate * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-5 lg:col-span-3">
              <h2 className="mb-3 text-sm font-medium">Event-by-Event Lead Time</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">Event</th>
                      <th className="px-2 py-1.5">Start</th>
                      <th className="px-2 py-1.5">Lead time (months)</th>
                      <th className="px-2 py-1.5">Max pre-event score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics?.covered_events.map((e) => (
                      <tr key={e.slug} className="border-t border-border/50">
                        <td className="px-2 py-1.5">{e.name}</td>
                        <td className="px-2 py-1.5 font-mono text-xs">{e.start_date}</td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {e.lead_time_months != null ? e.lead_time_months.toFixed(1) : <span className="text-destructive">missed</span>}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{e.max_pre_event_score.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
