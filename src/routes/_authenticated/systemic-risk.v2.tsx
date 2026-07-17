import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, PlayCircle, Activity, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import {
  computeRiskSnapshotFn,
  getLatestRiskSnapshotFn,
  listRiskTimelineFn,
} from "@/lib/market-data/engine-v2.functions";

export const Route = createFileRoute("/_authenticated/systemic-risk/v2")({
  head: () => ({
    meta: [
      { title: "Systemic Risk Engine v2 — Intelligence Dashboard" },
      { name: "description", content: "Institutional-grade systemic market risk with ensemble scoring, historical analogs, and full explainability." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RiskV2Page,
});

const regimeColor = (r: string) => {
  if (r === "Healthy") return "bg-green-500/20 text-green-500";
  if (r === "Improving") return "bg-emerald-500/20 text-emerald-500";
  if (r === "Neutral") return "bg-blue-500/20 text-blue-500";
  if (r === "Elevated Risk") return "bg-yellow-500/20 text-yellow-500";
  if (r === "High Risk") return "bg-orange-500/20 text-orange-500";
  return "bg-red-500/20 text-red-500";
};

type ModelResult = {
  key: string;
  label: string;
  score: number;
  weight: number;
  reasoning: { driver: string; percentile?: number; value?: number | null; contribution: number }[];
};

function RiskV2Page() {
  const getLatest = useServerFn(getLatestRiskSnapshotFn);
  const listTimeline = useServerFn(listRiskTimelineFn);
  const compute = useServerFn(computeRiskSnapshotFn);

  const snapQ = useQuery({ queryKey: ["srv2-latest"], queryFn: () => getLatest() });
  const timelineQ = useQuery({ queryKey: ["srv2-timeline"], queryFn: () => listTimeline({ data: { limit: 500 } }) });
  const computeMut = useMutation({
    mutationFn: () => compute({ data: {} }),
    onSuccess: () => { snapQ.refetch(); timelineQ.refetch(); },
  });

  const s = snapQ.data;
  const models: ModelResult[] = (s?.model_contributions as ModelResult[] | undefined) ?? [];
  const contribs = (s?.top_contributors as { key: string; label: string; contribution: number; percentile: number | null; value: number | null }[] | undefined) ?? [];
  const analogs = (s?.analog_matches as { date: string; similarity: number; event?: { name: string; category: string }; agreements: { label: string }[]; disagreements: { label: string; today: number; then: number }[] }[] | undefined) ?? [];
  const missing = (s?.missing_data as string[] | undefined) ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/systemic-risk" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to legacy engine
          </Link>
          <div className="flex gap-2">
            <Link to="/systemic-risk/events" className="text-sm text-muted-foreground hover:text-foreground">Event Library</Link>
            <Link to="/systemic-risk/validation" className="text-sm text-muted-foreground hover:text-foreground">Validation</Link>
            <Link to="/systemic-risk/methodology" className="text-sm text-muted-foreground hover:text-foreground">Methodology</Link>
          </div>
        </div>

        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Systemic Risk Intelligence Engine v2</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ensemble of 6 independent risk models, blended into a composite Systemic Risk Score with full analog matching and explainability.
            </p>
          </div>
          <button
            onClick={() => computeMut.mutate()}
            disabled={computeMut.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {computeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Recompute now
          </button>
        </header>

        {!s ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <Activity className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No snapshot yet. Backfill FRED data on the <Link to="/systemic-risk/events" className="underline">Event Library</Link> page, then click <b>Recompute now</b>.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Headline gauge */}
            <div className="rounded-lg border bg-card p-6 lg:col-span-1">
              <div className="text-xs uppercase text-muted-foreground">Composite Score</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-5xl font-semibold tabular-nums">{s.composite_score.toFixed(1)}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <div className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-medium ${regimeColor(s.regime_label)}`}>
                {s.regime_label}
              </div>
              <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                <div>As of: {s.as_of}</div>
                <div>Confidence: {(s.confidence * 100).toFixed(0)}%</div>
                <div>Missing features: {missing.length}</div>
              </div>
            </div>

            {/* Model contributions */}
            <div className="rounded-lg border bg-card p-6 lg:col-span-2">
              <h2 className="mb-3 text-sm font-medium">Ensemble Model Contributions</h2>
              <div className="space-y-3">
                {models.map((m) => (
                  <div key={m.key}>
                    <div className="flex items-center justify-between text-sm">
                      <span>{m.label}</span>
                      <span className="tabular-nums text-muted-foreground">{m.score}/100</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${m.score}%` }} />
                    </div>
                    {m.reasoning.length > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Top driver: {m.reasoning[0].driver}
                        {m.reasoning[0].percentile != null && ` (${(m.reasoning[0].percentile * 100).toFixed(0)}th %ile)`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Top contributors */}
            <div className="rounded-lg border bg-card p-6 lg:col-span-2">
              <h2 className="mb-3 text-sm font-medium">Top Risk Contributors (why the score is where it is)</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {contribs.map((c) => (
                  <div key={c.key} className="rounded-md border bg-background p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{c.label}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {c.percentile != null ? `${(c.percentile * 100).toFixed(0)}th %` : "—"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Value: {c.value != null ? c.value.toFixed(2) : "—"} · Risk: {(c.contribution * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Missing data */}
            <div className="rounded-lg border bg-card p-6 lg:col-span-1">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4" /> Data Coverage
              </h2>
              {missing.length === 0 ? (
                <div className="text-sm text-muted-foreground">All features available.</div>
              ) : (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Missing today ({missing.length}):</div>
                  {missing.map((k) => (
                    <div key={k} className="rounded bg-muted px-2 py-0.5 text-xs font-mono">{k}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Historical analogs */}
            <div className="rounded-lg border bg-card p-6 lg:col-span-3">
              <h2 className="mb-3 text-sm font-medium">Closest Historical Analogs</h2>
              {analogs.length === 0 ? (
                <div className="text-sm text-muted-foreground">Analog matching needs historical feature data. Recompute after backfill completes.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5">Date</th>
                        <th className="px-2 py-1.5">Similarity</th>
                        <th className="px-2 py-1.5">Event</th>
                        <th className="px-2 py-1.5">Agreements</th>
                        <th className="px-2 py-1.5">Disagreements</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analogs.map((a) => (
                        <tr key={a.date} className="border-t border-border/50">
                          <td className="px-2 py-1.5 font-mono text-xs">{a.date}</td>
                          <td className="px-2 py-1.5 tabular-nums">{(a.similarity * 100).toFixed(1)}%</td>
                          <td className="px-2 py-1.5">
                            {a.event ? (
                              <span>{a.event.name} <span className="text-xs text-muted-foreground">({a.event.category})</span></span>
                            ) : (
                              <span className="text-muted-foreground">no labeled event</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-xs text-muted-foreground">
                            {a.agreements.slice(0, 3).map((x) => x.label).join(", ")}
                          </td>
                          <td className="px-2 py-1.5 text-xs text-muted-foreground">
                            {a.disagreements.slice(0, 3).map((x) => (
                              <span key={x.label} className="mr-2">
                                {x.label}: {x.today > x.then ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="rounded-lg border bg-card p-6 lg:col-span-3">
              <h2 className="mb-3 text-sm font-medium">Composite Score Timeline ({timelineQ.data?.length ?? 0} snapshots)</h2>
              {timelineQ.data && timelineQ.data.length > 0 ? (
                <div className="text-xs text-muted-foreground">
                  Latest: {timelineQ.data[timelineQ.data.length - 1].composite_score.toFixed(1)} ({timelineQ.data[timelineQ.data.length - 1].regime_label}).
                  Range in view: {Math.min(...timelineQ.data.map((r) => r.composite_score)).toFixed(0)}–{Math.max(...timelineQ.data.map((r) => r.composite_score)).toFixed(0)}.
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No historical snapshots yet. Recompute to seed today's row.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
