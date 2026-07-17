import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { continueFutureLeadersScan, getLatestFutureLeaders, startFutureLeadersScan, type LeaderRow } from "@/lib/future-leaders/scan.functions";
import { getFutureLeaderDeepReport, type DeepReport } from "@/lib/future-leaders/deep-report.functions";
import { TopMenu } from "@/components/TopMenu";
import { Sparkles, RefreshCw, TrendingUp, Info, X, Shield, ChevronRight, Home, Loader2, Sigma, BarChart3, Target, Layers, Gauge } from "lucide-react";
import { toast } from "sonner";

import { useLiquidGlass } from "@/lib/liquid-glass";
import { CrystalFutureLeaders } from "@/crystal/CrystalFutureLeaders";

function FutureLeadersRouteSwitch() {
  const { enabled } = useLiquidGlass();
  return enabled ? <CrystalFutureLeaders /> : <FutureLeadersPage />;
}

export const Route = createFileRoute("/_authenticated/future-leaders")({
  head: () => ({
    meta: [
      { title: "Future Leaders Scanner · Laddrx" },
      { name: "description", content: "AI-powered research framework that ranks companies whose price-action fingerprint resembles the greatest historical long-term stock winners." },
      { property: "og:title", content: "Future Leaders Scanner · Laddrx" },
      { property: "og:description", content: "Multi-factor evidence engine surfacing tomorrow's potential compounders." },
    ],
  }),
  component: FutureLeadersRouteSwitch,
});


function ScoreBar({ label, value, tone = "cyan" }: { label: string; value: number; tone?: "cyan" | "emerald" | "amber" | "fuchsia" | "rose" }) {
  const tones: Record<string, string> = {
    cyan: "from-cyan-400 to-cyan-500",
    emerald: "from-emerald-400 to-emerald-500",
    amber: "from-amber-400 to-amber-500",
    fuchsia: "from-fuchsia-400 to-fuchsia-500",
    rose: "from-rose-400 to-rose-500",
  };
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className="w-14 shrink-0 uppercase tracking-wider text-slate-500">{label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className={`absolute inset-y-0 left-0 bg-gradient-to-r ${tones[tone]}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums text-slate-300">{value.toFixed(0)}</span>
    </div>
  );
}

function ConfidenceChip({ value }: { value: number }) {
  const tone = value >= 70 ? "emerald" : value >= 50 ? "amber" : "rose";
  const colors = {
    emerald: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    rose: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${colors}`}>
      <Shield className="h-3 w-3" /> {value.toFixed(0)}
    </span>
  );
}

function DeepReportView({ report }: { report: DeepReport }) {
  const [tab, setTab] = useState<"overview" | "analog" | "growth" | "scenarios" | "score" | "raw">("overview");
  const dq = report.dataQuality;
  const dqTone = dq.score >= 70 ? "emerald" : dq.score >= 50 ? "amber" : "rose";
  const dqColors = { emerald: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", amber: "border-amber-400/30 bg-amber-400/10 text-amber-300", rose: "border-rose-400/30 bg-rose-400/10 text-rose-300" }[dqTone];
  // Backwards-compat: older cached reports may not include new fields.
  const t = report.aiThesis as DeepReport["aiThesis"] & Partial<Record<
    "whyRankedHere" | "historicalPatternExplained" | "keyMetricsExplained" | "oneYearOutlook" | "whatToWatch",
    unknown
  >>;
  const whyRankedHere = Array.isArray(t.whyRankedHere) ? (t.whyRankedHere as string[]) : [];
  const historicalPatternExplained = typeof t.historicalPatternExplained === "string" ? t.historicalPatternExplained : "";
  const keyMetricsExplained = Array.isArray(t.keyMetricsExplained)
    ? (t.keyMetricsExplained as Array<{ metric: string; value: string; interpretation: string }>)
    : [];
  const oneYearOutlook = typeof t.oneYearOutlook === "string" ? t.oneYearOutlook : "";
  const whatToWatch = Array.isArray(t.whatToWatch) ? (t.whatToWatch as string[]) : [];

  const tabs: Array<{ id: typeof tab; label: string; icon: React.ReactNode }> = [
    { id: "overview", label: "Thesis", icon: <Sparkles className="h-3 w-3" /> },
    { id: "analog", label: "Analogs", icon: <Target className="h-3 w-3" /> },
    { id: "growth", label: "Growth", icon: <TrendingUp className="h-3 w-3" /> },
    { id: "scenarios", label: "Scenarios", icon: <BarChart3 className="h-3 w-3" /> },
    { id: "score", label: "Score", icon: <Sigma className="h-3 w-3" /> },
    { id: "raw", label: "Fundamentals", icon: <Layers className="h-3 w-3" /> },
  ];

  const fmt = (n: number | null | undefined, digits = 1, suffix = "") =>
    n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}${suffix}`;
  const fmtMoney = (n: number | null) => n == null ? "—" : n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${n.toFixed(0)}`;

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${dqColors}`}>
        <Gauge className="h-3.5 w-3.5" />
        <span className="font-mono font-bold">Data quality {dq.score}/100</span>
        <span className="text-[11px] opacity-80">· sources: {dq.sources.join(", ") || "price-only"}</span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition ${tab === t.id ? "bg-cyan-400/15 text-cyan-200" : "text-slate-500 hover:text-slate-200"}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-200">{report.aiThesis.overview}</p>
          {whyRankedHere.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300">Why this stock earned its rank</div>
              <ul className="space-y-1 text-xs text-slate-300">{whyRankedHere.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
          {historicalPatternExplained && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fuchsia-300">What the historical pattern is telling us</div>
              <p className="text-xs leading-relaxed text-slate-300">{historicalPatternExplained}</p>
            </div>
          )}
          {oneYearOutlook && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-amber-300">12-month outlook (AI estimate)</div>
              <p className="text-xs leading-relaxed text-slate-300">{oneYearOutlook}</p>
            </div>
          )}
          {keyMetricsExplained.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300">Key metrics, explained</div>
              <div className="space-y-1.5">
                {keyMetricsExplained.map((m, i) => (
                  <div key={i} className="rounded-md border border-slate-800/70 bg-slate-950 p-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-200">{m.metric}</span>
                      <span className="font-mono text-[11px] tabular-nums text-cyan-200">{m.value}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{m.interpretation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {report.aiThesis.differentiators.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300">What sets it apart</div>
              <ul className="space-y-1 text-xs text-slate-300">{report.aiThesis.differentiators.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300">Bull case</div>
              <ul className="space-y-1 text-xs text-slate-300">{report.aiThesis.bullCase.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-rose-300">Bear case</div>
              <ul className="space-y-1 text-xs text-slate-300">{report.aiThesis.bearCase.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          </div>
          {report.aiThesis.competitiveMoat.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fuchsia-300">Competitive moat (inferred)</div>
              <ul className="space-y-1 text-xs text-slate-300">{report.aiThesis.competitiveMoat.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
          {whatToWatch.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300">What to watch (near-term)</div>
              <ul className="space-y-1 text-xs text-slate-300">{whatToWatch.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
          {report.aiThesis.invalidation.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-amber-300">Thesis invalidation triggers</div>
              <ul className="space-y-1 text-xs text-slate-300">{report.aiThesis.invalidation.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {tab === "analog" && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {report.analog.primaryAnalogs.map((a) => (
              <span key={a} className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 font-mono text-xs font-bold text-cyan-200">{a}</span>
            ))}
            {report.analog.primaryAnalogs.length === 0 && <span className="text-xs text-slate-500">No analogs generated (AI unavailable).</span>}
          </div>
          {report.analog.similarityNotes.length > 0 && (
            <div className="space-y-1 text-xs leading-relaxed text-slate-300">
              {report.analog.similarityNotes.map((n, i) => <p key={i}>{n}</p>)}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300">Matched features</div>
              <ul className="space-y-1 text-xs text-slate-300">{report.analog.matchedFeatures.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-amber-300">Differing features</div>
              <ul className="space-y-1 text-xs text-slate-300">{report.analog.differingFeatures.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          </div>
        </section>
      )}

      {tab === "growth" && (
        <section className="space-y-3">
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300">Growth drivers</div>
            <ul className="space-y-1 text-xs text-slate-300">{report.aiThesis.growthDrivers.map((s, i) => <li key={i}>• {s}</li>)}</ul>
          </div>
        </section>
      )}

      {tab === "scenarios" && (
        <section className="space-y-3">
          <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] italic text-amber-200/90">
            All numbers below are AI-generated estimates from analog history + current fundamentals. Not forecasts, not guarantees.
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-900/70 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-left">Horizon</th>
                  <th className="px-2 py-2 text-right">Conservative</th>
                  <th className="px-2 py-2 text-right">Base</th>
                  <th className="px-2 py-2 text-right">Bull</th>
                  <th className="px-2 py-2 text-right">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {report.scenarios.map((s) => (
                  <tr key={s.horizon} className="border-t border-slate-800/70">
                    <td className="px-2 py-2 font-mono font-bold text-slate-200">{s.horizon}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-200">{s.conservative >= 0 ? "+" : ""}{s.conservative.toFixed(0)}%</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-100">{s.base >= 0 ? "+" : ""}{s.base.toFixed(0)}%</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-200">{s.bull >= 0 ? "+" : ""}{s.bull.toFixed(0)}%</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-400">{s.confidence.toFixed(0)}/100</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1.5">
            {report.scenarios.map((s) => (
              <p key={s.horizon} className="text-[11px] text-slate-400"><span className="font-mono text-slate-500">{s.horizon}:</span> {s.rationale}</p>
            ))}
          </div>
        </section>
      )}

      {tab === "score" && (
        <section className="space-y-2">
          <div className="mb-2 text-xs text-slate-400">
            Composite <b className="text-slate-100">{report.scoreBreakdown.compositeVerified.toFixed(1)}/100</b> — how each component contributed.
          </div>
          <div className="space-y-2">
            {report.scoreBreakdown.items.map((item, i) => (
              <div key={i} className="rounded-md border border-slate-800 bg-slate-950 p-2.5">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">{item.label}</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    <b className="text-cyan-200">{item.points.toFixed(1)}</b><span className="text-slate-600"> / {item.maxPoints.toFixed(0)}</span>
                    <span className="ml-2 text-slate-500">({item.raw.toFixed(0)}/100 × {(item.weight * 100).toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500" style={{ width: `${Math.max(2, Math.min(100, (item.points / Math.max(0.01, item.maxPoints)) * 100))}%` }} />
                </div>
                <div className="text-[11px] text-slate-500">{item.detail}</div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-600">source: {item.source}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "raw" && (
        <section className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {([
              ["Revenue YoY", fmt(report.fundamentals.revenueYoYPct, 1, "%")],
              ["Revenue 3y CAGR", fmt(report.fundamentals.revenue3yCagrPct, 1, "%")],
              ["Gross margin", fmt(report.fundamentals.grossMarginPct, 1, "%")],
              ["Operating margin", fmt(report.fundamentals.operatingMarginPct, 1, "%")],
              ["FCF margin", fmt(report.fundamentals.fcfMarginPct, 1, "%")],
              ["Rule-of-40", fmt(report.fundamentals.ruleOf40, 0)],
              ["EPS YoY", fmt(report.fundamentals.epsYoYPct, 1, "%")],
              ["Share dilution 3y", fmt(report.fundamentals.shareDilution3yPct, 1, "%")],
              ["Insider net $ (90d)", fmtMoney(report.fundamentals.insiderNetDollars90d)],
              ["Institutional %", report.fundamentals.heldPercentInstitutions != null ? `${(report.fundamentals.heldPercentInstitutions * 100).toFixed(0)}%` : "—"],
              ["Analyst consensus", fmt(report.fundamentals.recommendationMean, 2)],
              ["Target upside", fmt(report.fundamentals.analystTargetUpside, 0, "%")],
              ["Market cap", fmtMoney(report.fundamentals.marketCap)],
              ["Forward P/E", fmt(report.fundamentals.forwardPE, 1)],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded-md border border-slate-800/70 bg-slate-950 px-2 py-1.5">
                <div className="font-mono text-[9px] uppercase tracking-wider text-slate-500">{k}</div>
                <div className="tabular-nums text-slate-200">{v}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] italic text-slate-500">Data sources: {report.fundamentals.sources.join(", ") || "limited coverage"}. Blank cells indicate the field was not available from any provider (common for ADRs and recent IPOs).</div>
        </section>
      )}

      <p className="mt-4 text-[10px] italic leading-relaxed text-slate-500">{report.disclaimer}</p>
    </div>
  );
}

function RowDetail({ row, snapshotId, onClose }: { row: LeaderRow; snapshotId: string; onClose: () => void }) {
  const fetchDeep = useServerFn(getFutureLeaderDeepReport);
  const qc = useQueryClient();
  const deep = useQuery({
    queryKey: ["future-leader-deep", snapshotId, row.symbol],
    queryFn: () => fetchDeep({ data: { snapshotId, symbol: row.symbol } }),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 2,
  });
  const regen = useMutation({
    mutationFn: () => fetchDeep({ data: { snapshotId, symbol: row.symbol, regenerate: true } }),
    onSuccess: (data) => {
      qc.setQueryData(["future-leader-deep", snapshotId, row.symbol], data);
    },
  });

  const f = row.features;
  const fmt = (n: number | null | undefined, digits = 1, suffix = "") =>
    n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}${suffix}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl sm:rounded-2xl">
        <button onClick={onClose} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:border-cyan-400/40 hover:text-cyan-100">
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300">Rank #{row.rank} · {row.sector}</div>
          <h2 className="mt-1 text-2xl font-black text-slate-50">{row.symbol} <span className="text-base font-normal text-slate-400">— {row.name}</span></h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-mono text-xs text-cyan-200">Composite {row.composite.toFixed(1)}</span>
            <ConfidenceChip value={row.confidence} />
          </div>
        </div>

        {deep.isLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
            Generating deep report — pulling fundamentals (EDGAR + Yahoo + Finnhub) and running AI thesis synthesis. This takes 10-20 seconds on first view, then it's cached.
          </div>
        )}
        {deep.error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            Deep report failed: {deep.error instanceof Error ? deep.error.message : String(deep.error)}. Numeric evidence below is still valid.
          </div>
        )}
        {deep.data && <DeepReportView report={deep.data} />}
        {deep.data && deep.data.aiSucceeded === false && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
            <span>
              AI narrative didn't return this time (gateway retry across gemini-2.5-flash, gpt-5.5, gemini-2.5-pro all fell short). Numeric evidence is fully valid.
            </span>
            <button
              onClick={() => regen.mutate()}
              disabled={regen.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-100 hover:bg-amber-400/20 disabled:opacity-50"
            >
              {regen.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {regen.isPending ? "Regenerating…" : "Regenerate AI"}
            </button>
          </div>
        )}

        <details className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40">
          <summary className="cursor-pointer px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400 hover:text-slate-200">Raw scanner evidence (price-action features)</summary>
          <div className="border-t border-slate-800 p-4">
        {row.aiThesis ? (
          <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-fuchsia-300"><Sparkles className="h-3 w-3" /> AI Thesis</div>
            <p className="text-sm leading-relaxed text-slate-200">{row.aiThesis.thesis}</p>
            {row.aiThesis.primaryAnalogs?.length > 0 && (
              <div className="mt-3 text-xs text-slate-400">
                <span className="font-mono uppercase tracking-wider text-slate-500">Resembles: </span>
                {row.aiThesis.primaryAnalogs.join(" · ")}
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300">Bull case</div>
                <ul className="space-y-1 text-xs text-slate-300">{row.aiThesis.bullCase.map((s, i) => <li key={i}>• {s}</li>)}</ul>
              </div>
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-rose-300">Bear case</div>
                <ul className="space-y-1 text-xs text-slate-300">{row.aiThesis.bearCase.map((s, i) => <li key={i}>• {s}</li>)}</ul>
              </div>
            </div>
            {row.aiThesis.catalysts?.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-amber-300">Watch for</div>
                <ul className="space-y-1 text-xs text-slate-300">{row.aiThesis.catalysts.map((s, i) => <li key={i}>• {s}</li>)}</ul>
              </div>
            )}
            {row.aiThesis.notes && (
              <p className="mt-3 text-[10px] italic text-slate-500">{row.aiThesis.notes}</p>
            )}
          </section>
        ) : null}

        <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Component scores & reasons</div>
          <div className="space-y-3">
            {(["historical","momentum","quality","relativeStrength","risk"] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold capitalize text-slate-200">{k === "relativeStrength" ? "Relative Strength" : k === "risk" ? "Risk (higher = safer)" : k}</span>
                  <span className="font-mono text-xs tabular-nums text-slate-300">{row.components[k].toFixed(0)}/100</span>
                </div>
                {row.reasons?.[k]?.length ? (
                  <ul className="space-y-0.5 pl-3 text-[11px] text-slate-400">
                    {row.reasons[k].map((r, i) => <li key={i}>• {r}</li>)}
                  </ul>
                ) : <div className="pl-3 text-[11px] text-slate-500">—</div>}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Numeric evidence</div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {[
              ["Price", `$${fmt(f.price, 2)}`],
              ["As of", f.asOf],
              ["12m ret", fmt(f.ret12m, 1, "%")],
              ["6m ret", fmt(f.ret6m, 1, "%")],
              ["5y CAGR", fmt(f.cagr5y, 1, "%")],
              ["Off 52w high", fmt(f.distFromHigh52wPct, 1, "%")],
              ["vs 200SMA", fmt(f.distSma200Pct, 1, "%")],
              ["200SMA slope", fmt(f.sma200SlopePct, 1, "%")],
              ["Stage-2", f.stage2 ? "yes" : "no"],
              ["Vol ann (1y)", fmt(f.volAnn250, 0, "%")],
              ["Max DD 1y", fmt(f.maxDrawdown1y, 0, "%")],
              ["Beta vs SPY", fmt(f.beta250, 2)],
              ["Mansfield RS", fmt(f.rsMansfield, 1)],
              ["$-vol 20d", f.avgDollarVol20 ? `$${(f.avgDollarVol20 / 1e6).toFixed(0)}M` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-slate-800/70 bg-slate-950 px-2 py-1.5">
                <div className="font-mono text-[9px] uppercase tracking-wider text-slate-500">{k}</div>
                <div className="tabular-nums text-slate-200">{v}</div>
              </div>
            ))}
          </div>
        </section>
          </div>
        </details>
      </div>
    </div>
  );
}

function FutureLeadersPage() {
  const qc = useQueryClient();
  const fetchLatest = useServerFn(getLatestFutureLeaders);
  const startScan = useServerFn(startFutureLeadersScan);
  const continueScan = useServerFn(continueFutureLeadersScan);
  const { data, isLoading, error } = useQuery({
    queryKey: ["future-leaders-latest"],
    queryFn: () => fetchLatest(),
    refetchInterval: (query) => query.state.data?.status === "running" ? 2_500 : 60_000,
  });
  const mutation = useMutation({
    mutationFn: () => startScan({ data: { aiTopN: 15 } }),
    onSuccess: (r) => { toast.success(`Scan started — ${r.ranked} ranked so far`); qc.invalidateQueries({ queryKey: ["future-leaders-latest"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });
  const continueMutation = useMutation({
    mutationFn: (snapshotId: string) => continueScan({ data: { snapshotId, aiTopN: 15 } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["future-leaders-latest"] });
      if (r.status === "completed") toast.success(`Scan complete — ${r.ranked} ranked, ${r.failed} failed`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Scan stopped"),
  });
  const isScanning = mutation.isPending || data?.status === "running";

  useEffect(() => {
    if (data?.status !== "running" || !data.snapshotId || continueMutation.isPending) return;
    const id = window.setTimeout(() => continueMutation.mutate(data.snapshotId), data.rows.length ? 700 : 100);
    return () => window.clearTimeout(id);
  }, [continueMutation, data?.snapshotId, data?.status, data?.processed, data?.rows.length]);

  const [selected, setSelected] = useState<LeaderRow | null>(null);
  const [minComposite, setMinComposite] = useState(0);
  const [minConfidence, setMinConfidence] = useState(0);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    const q = search.trim().toUpperCase();
    return data.rows.filter((r) =>
      r.composite >= minComposite &&
      r.confidence >= minConfidence &&
      (q === "" || r.symbol.includes(q) || r.name.toUpperCase().includes(q)),
    );
  }, [data, minComposite, minConfidence, search]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <TopMenu />
      <main className="mx-auto max-w-7xl px-3 py-16 sm:px-6 sm:py-10">
        <header className="mb-6">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300">
            <Sparkles className="h-3 w-3" /> Future Leaders Scanner
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-50 sm:text-3xl">
            <TrendingUp className="h-6 w-6 text-cyan-300" />
            Companies that look like tomorrow's compounders
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Continuously scores ~{data?.universeSize ?? 4200} US-listed stocks (S&P 500 + NYSE + NASDAQ ≥ $100M mcap, recent IPOs ≥ $50M, plus curated ADRs) against the price-action fingerprints of the greatest historical long-term winners (Nvidia, Apple, Amazon, Costco, Broadcom, Monster, and more). Every rank shows its evidence, its confidence, and its risks. <span className="text-amber-300">Research framework — not financial advice.</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            {data && (
              <>
                <span className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono">
                  Last scan: {new Date(data.scannedAt).toLocaleString()}
                </span>
                <span className={`rounded-md border px-2 py-1 font-mono uppercase ${data.status === "running" ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : data.status === "failed" ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"}`}>
                  {data.status === "running" ? `Scanning ${data.processed}/${data.universeSize}` : data.status}
                </span>
                <span className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono uppercase">
                  Regime: {data.regime}
                </span>
                <span className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono">
                  SPY 1d: {data.spyChangePct != null ? `${data.spyChangePct >= 0 ? "+" : ""}${data.spyChangePct.toFixed(2)}%` : "—"}
                </span>
              </>
            )}
            <button
              onClick={() => mutation.mutate()}
              disabled={isScanning}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-cyan-200 transition hover:border-cyan-400/60 hover:bg-cyan-400/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isScanning ? "animate-spin" : ""}`} />
              {isScanning ? "Scanning…" : "Run new scan"}
            </button>
          </div>
        </header>

        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="min-w-[200px] flex-1">
            <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="AAPL, NVDA…" className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400/50" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Min composite</label>
            <input type="number" value={minComposite} onChange={(e) => setMinComposite(Number(e.target.value))} min={0} max={100} step={5} className="mt-1 w-24 rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm tabular-nums text-slate-100 outline-none focus:border-cyan-400/50" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Min confidence</label>
            <input type="number" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} min={0} max={100} step={5} className="mt-1 w-24 rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm tabular-nums text-slate-100 outline-none focus:border-cyan-400/50" />
          </div>
          <div className="ml-auto text-xs text-slate-500">Showing {rows.length} of {data?.rows.length ?? 0}{data?.status === "running" ? ` · ${data.succeeded} ranked so far` : ""}</div>
        </div>

        {data?.status === "running" && (
          <div className="mb-4 overflow-hidden rounded-xl border border-amber-400/30 bg-amber-400/10">
            <div className="h-1 bg-slate-900">
              <div className="h-full bg-amber-300 transition-all" style={{ width: `${Math.max(2, Math.min(100, (data.processed / Math.max(1, data.universeSize)) * 100))}%` }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-amber-100">
              <span className="font-mono uppercase tracking-wider">Live scan running</span>
              <span className="text-amber-200/80">Rows below are updating as each batch finishes.</span>
            </div>
          </div>
        )}

        {data?.status === "failed" && data.errorMessage && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            Last scan stopped early: {data.errorMessage}. Partial rankings are still shown below.
          </div>
        )}

        {isLoading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-400">Loading latest scan…</div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error instanceof Error ? error.message : "Failed to load leaders."}
          </div>
        )}
        {data === null && !isLoading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
            <Info className="mx-auto mb-3 h-6 w-6 text-cyan-300" />
            <div className="text-sm text-slate-300">No scan snapshot yet. Click <b>Run new scan</b> to build the first ranking.</div>
            <div className="mt-1 text-xs text-slate-500">First scan ~5-10 min (cold Yahoo fetch across ~4200 tickers). Subsequent scans ~30s thanks to the 18h bar cache.</div>
          </div>
        )}

        {data && rows.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-900/70 text-left font-mono text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2 text-right">Composite</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Confidence</th>
                  <th className="hidden px-3 py-2 md:table-cell">Components</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} onClick={() => setSelected(r)} className="cursor-pointer border-t border-slate-800/70 transition hover:bg-slate-900/60">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500 tabular-nums">{r.rank}</td>
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-100">{r.symbol}</div>
                      <div className="text-[11px] text-slate-500">{r.name} · {r.sector}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="rounded-md bg-cyan-400/10 px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-cyan-200">{r.composite.toFixed(1)}</span>
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell"><ConfidenceChip value={r.confidence} /></td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <div className="space-y-0.5">
                        <ScoreBar label="Hist" value={r.components.historical} tone="cyan" />
                        <ScoreBar label="Mom" value={r.components.momentum} tone="emerald" />
                        <ScoreBar label="Qual" value={r.components.quality} tone="fuchsia" />
                        <ScoreBar label="RS" value={r.components.relativeStrength} tone="amber" />
                        <ScoreBar label="Safe" value={r.components.risk} tone="rose" />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right"><ChevronRight className="inline h-4 w-4 text-slate-600" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-slate-500">
          <b className="text-slate-400">How this works.</b> Every ticker in the universe is scored by five independent models: <em>Historical Similarity</em> (long-horizon fingerprint vs mega-winners), <em>Momentum &amp; Trend</em>, <em>Quality Proxy</em>, <em>Relative Strength</em> vs SPY, and <em>Risk / Stability</em>. Scores are combined with fixed weights (visible in every stored snapshot) into a composite 0-100. Confidence = the minimum of (agreement across the 5 models) and (data completeness). Fundamentals (revenue, margins, cash flow, insider activity) are not used in this MVP — the quality signal is a price-action proxy. AI synthesis (Lovable AI Gateway, Gemini 3 Flash Preview) turns numeric evidence into a plain-English thesis for the top rows only.
        </p>
        <p className="mt-2 text-[11px] text-slate-600">
          Every rank is logged to a permanent snapshot table so future performance can be measured. This is a research framework — never a promise, prediction, or guarantee. <Link to="/" className="text-cyan-400 underline"><Home className="inline h-3 w-3" /> Back to terminal</Link>
        </p>
      </main>

      {selected && data?.snapshotId && <RowDetail row={selected} snapshotId={data.snapshotId} onClose={() => setSelected(null)} />}
    </div>
  );
}
