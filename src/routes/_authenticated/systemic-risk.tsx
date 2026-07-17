import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, Play, ShieldAlert, ShieldCheck, Activity, TrendingDown, Info } from "lucide-react";
import {
  getLatestSystemicSnapshot,
  refreshSystemicSnapshot,
  getSystemicBacktest,
  runSystemicBacktest,
} from "@/lib/systemic-risk.functions";
import { CRISIS_KIND_LABELS } from "@/lib/systemic-risk/crises";

export const Route = createFileRoute("/_authenticated/systemic-risk")({
  head: () => ({
    meta: [
      { title: "Systemic Market Risk Intelligence Engine" },
      { name: "description", content: "Continuously monitors cross-asset market conditions and compares them to historical crisis fingerprints." },
    ],
  }),
  component: SystemicRiskPage,
});

const FEATURE_LABELS: Record<string, string> = {
  spy_ret_20d: "SPY 20d return",
  spy_ret_60d: "SPY 60d return",
  spy_ret_252d: "SPY 12-month return",
  spy_dd_252d: "SPY drawdown from 252d high",
  spy_dist_sma200: "SPY vs 200d SMA",
  spy_dist_sma50: "SPY vs 50d SMA",
  spy_realized_vol_20d: "Realized vol (20d, annualized)",
  vix_level: "VIX level",
  vix_chg_20d: "VIX 20d change",
  vix_term_ratio: "VIX / VIX3M term ratio",
  iwm_spy_60d: "Small-cap leadership (IWM-SPY 60d)",
  hyg_lqd_60d: "Credit stress (HYG-LQD 60d)",
  tlt_20d: "Long treasury 20d",
  ief_shy_60d: "Yield-curve proxy (IEF-SHY 60d)",
  uup_60d: "Dollar 60d",
  gld_spy_60d: "Gold vs SPY 60d",
  uso_60d: "Oil 60d",
  sector_dispersion_60d: "Sector dispersion (60d)",
  defensive_cyclical_ratio: "Defensive vs cyclical leadership",
  sector_breadth_sma200: "Sector breadth > SMA200",
  efa_spy_60d: "Intl developed vs SPY 60d",
  eem_spy_60d: "Emerging mkts vs SPY 60d",
};

type Snapshot = {
  as_of: string;
  early_warning_score: number;
  regime: string;
  probabilities: Record<string, number>;
  indicators: { raw: Record<string, number | null>; z: Record<string, number | null>; meta: any };
  top_analogs: Array<{
    event_id: string; event_label: string; event_kind: string;
    match_date: string; days_before_trough: number; similarity: number;
    outcome_dd_pct: number; outcome_days_to_trough: number;
  }>;
  drivers: Array<{ key: string; z: number; contribution: number; direction: string }>;
  disagreements: Array<{ key: string; z: number; note: string }>;
  data_coverage: { features_present: number; features_total: number; missing_keys: string[] };
};

function SystemicRiskPage() {
  const router = useRouter();
  const getSnap = useServerFn(getLatestSystemicSnapshot);
  const getBt = useServerFn(getSystemicBacktest);
  const refreshFn = useServerFn(refreshSystemicSnapshot);
  const backtestFn = useServerFn(runSystemicBacktest);

  const snapQ = useQuery({ queryKey: ["systemic-snapshot"], queryFn: () => getSnap() });
  const btQ = useQuery({ queryKey: ["systemic-backtest"], queryFn: () => getBt() });

  const refreshMut = useMutation({
    mutationFn: () => refreshFn({ data: { force: true } }),
    onSuccess: (r: any) => {
      toast.success(r?.skipped ? "Snapshot fresh — no recompute needed" : `Snapshot updated (${r?.as_of})`);
      router.invalidate();
      snapQ.refetch();
    },
    onError: (e: any) => toast.error(`Refresh failed: ${e?.message ?? "unknown"}`),
  });

  const backtestMut = useMutation({
    mutationFn: () => backtestFn({ data: { windowBefore: 180, stride: 5 } }),
    onSuccess: () => { toast.success("Backtest complete"); btQ.refetch(); },
    onError: (e: any) => toast.error(`Backtest failed: ${e?.message ?? "unknown"}`),
  });

  const snap = snapQ.data as Snapshot | null;
  const bt = btQ.data as any;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-cyan-400">
              <ShieldAlert className="h-4 w-4" /> Systemic Market Risk Intelligence
            </div>
            <h1 className="mt-1 text-3xl font-bold">Cross-Asset Risk Fingerprint</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Continuously compares today's cross-asset market environment against historical crisis fingerprints
              built from decades of S&P 500, volatility, credit, rates, currency, commodity, and breadth data.
              Every score is derived from measurable evidence — never opinion.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshMut.isPending ? "animate-spin" : ""}`} />
              Refresh now
            </button>
            <button
              onClick={() => backtestMut.mutate()}
              disabled={backtestMut.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
            >
              <Play className={`h-4 w-4 ${backtestMut.isPending ? "animate-pulse" : ""}`} />
              Run backtest
            </button>
          </div>
        </header>

        {snapQ.isLoading && <div className="text-slate-400">Loading latest snapshot…</div>}
        {!snapQ.isLoading && !snap && (
          <EmptyState onRefresh={() => refreshMut.mutate()} pending={refreshMut.isPending} />
        )}

        {snap && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <RiskGauge score={snap.early_warning_score} regime={snap.regime} asOf={snap.as_of} />
              <ProbabilitiesCard probs={snap.probabilities} />
              <CoverageCard coverage={snap.data_coverage} meta={snap.indicators.meta} />
            </div>

            <section className="mt-6 grid gap-4 lg:grid-cols-2">
              <TopAnalogsCard analogs={snap.top_analogs} />
              <DriversCard drivers={snap.drivers} disagreements={snap.disagreements} />
            </section>

            <IndicatorsTable raw={snap.indicators.raw} z={snap.indicators.z} />

            <BacktestSection bt={bt} running={backtestMut.isPending} />

            <Disclaimers />
          </>
        )}
      </div>
    </div>
  );
}

function RiskGauge({ score, regime, asOf }: { score: number; regime: string; asOf: string }) {
  const color =
    score >= 80 ? "text-rose-400 border-rose-500/60 bg-rose-500/10" :
    score >= 65 ? "text-orange-300 border-orange-500/60 bg-orange-500/10" :
    score >= 50 ? "text-amber-300 border-amber-500/60 bg-amber-500/10" :
    score >= 30 ? "text-yellow-200 border-yellow-500/40 bg-yellow-500/5" :
    "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
  const label = regime.replace("_", " ").toUpperCase();
  return (
    <div className={`rounded-2xl border p-6 ${color}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-80">
        <Activity className="h-3.5 w-3.5" /> Early Warning Score
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <div className="text-6xl font-bold tabular-nums">{score}</div>
        <div className="text-sm opacity-70">/ 100</div>
      </div>
      <div className="mt-3 text-lg font-semibold">{label}</div>
      <div className="mt-1 text-xs opacity-70">As of {asOf}</div>
      <div className="mt-4 h-2 rounded-full bg-slate-800/60">
        <div className="h-2 rounded-full bg-current opacity-60" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function ProbabilitiesCard({ probs }: { probs: Record<string, number> }) {
  const rows = Object.entries(probs).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
        <TrendingDown className="h-3.5 w-3.5" /> Historical analog evidence mix
      </div>
      {!rows.length && (
        <div className="mt-3 text-sm text-slate-400">
          No strong historical crisis analogs detected. Environment resembles routine or healthy conditions.
        </div>
      )}
      <div className="mt-3 space-y-2">
        {rows.map(([kind, pct]) => (
          <div key={kind}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{CRISIS_KIND_LABELS[kind as keyof typeof CRISIS_KIND_LABELS] ?? kind}</span>
              <span className="tabular-nums text-slate-400">{pct.toFixed(1)}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-800/60">
              <div className="h-1.5 rounded-full bg-cyan-400/60" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-[11px] text-slate-500">
        % of similarity-weighted historical evidence per crisis kind (matches with similarity ≥ 60).
      </div>
    </div>
  );
}

function CoverageCard({ coverage, meta }: { coverage: any; meta: any }) {
  const pct = Math.round((coverage.features_present / coverage.features_total) * 100);
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5" /> Data coverage
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums">{coverage.features_present}/{coverage.features_total}</div>
      <div className="text-xs text-slate-400">{pct}% of features present today</div>
      <dl className="mt-4 space-y-1 text-xs text-slate-400">
        <div className="flex justify-between"><dt>Universe symbols</dt><dd className="tabular-nums text-slate-200">{meta?.universe_symbols ?? "—"}</dd></div>
        <div className="flex justify-between"><dt>Norm-stat sample</dt><dd className="tabular-nums text-slate-200">{meta?.normstats_sample_size ?? "—"}</dd></div>
        <div className="flex justify-between"><dt>Historical windows scanned</dt><dd className="tabular-nums text-slate-200">{meta?.analog_windows_scanned ?? "—"}</dd></div>
      </dl>
      {coverage.missing_keys?.length ? (
        <details className="mt-3 text-[11px] text-slate-500">
          <summary className="cursor-pointer">Missing features</summary>
          <div className="mt-1">{coverage.missing_keys.map((k: string) => FEATURE_LABELS[k] ?? k).join(", ")}</div>
        </details>
      ) : null}
    </div>
  );
}

function TopAnalogsCard({ analogs }: { analogs: Snapshot["top_analogs"] }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
        <AlertTriangle className="h-3.5 w-3.5" /> Closest historical fingerprints
      </div>
      {!analogs.length && <div className="mt-3 text-sm text-slate-400">No qualifying analogs found.</div>}
      <div className="mt-3 divide-y divide-slate-800/70">
        {analogs.map((a) => (
          <div key={a.event_id + a.match_date} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-slate-100">{a.event_label}</div>
              <div className="text-[11px] text-slate-500">
                Matched {a.match_date} · {a.days_before_trough >= 0 ? `${a.days_before_trough}d before trough` : `${-a.days_before_trough}d after trough`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold tabular-nums text-cyan-300">{a.similarity.toFixed(1)}%</div>
              <div className="text-[11px] text-slate-500">Ended {a.outcome_dd_pct}% dd</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DriversCard({ drivers, disagreements }: { drivers: Snapshot["drivers"]; disagreements: Snapshot["disagreements"] }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
        <Info className="h-3.5 w-3.5" /> Why the score is where it is
      </div>
      <div className="mt-3 text-xs font-semibold text-rose-300">Top risk contributors</div>
      <div className="mt-1 space-y-1">
        {drivers.length ? drivers.map((d) => (
          <div key={d.key} className="flex justify-between text-xs">
            <span className="text-slate-300">{FEATURE_LABELS[d.key] ?? d.key}</span>
            <span className="tabular-nums text-rose-300">z {d.z.toFixed(2)} · +{d.contribution.toFixed(2)}</span>
          </div>
        )) : <div className="text-xs text-slate-500">No indicators are pushing risk higher.</div>}
      </div>
      <div className="mt-4 text-xs font-semibold text-emerald-300">Indicators disagreeing</div>
      <div className="mt-1 space-y-1">
        {disagreements.length ? disagreements.map((d) => (
          <div key={d.key} className="flex justify-between text-xs">
            <span className="text-slate-300">{FEATURE_LABELS[d.key] ?? d.key}</span>
            <span className="tabular-nums text-emerald-300">z {d.z.toFixed(2)}</span>
          </div>
        )) : <div className="text-xs text-slate-500">No significant dissenting indicators.</div>}
      </div>
    </div>
  );
}

function IndicatorsTable({ raw, z }: { raw: Record<string, number | null>; z: Record<string, number | null> }) {
  const rows = useMemo(() => Object.keys(FEATURE_LABELS).map((k) => ({ k, raw: raw[k], z: z[k] })), [raw, z]);
  return (
    <section className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-900/40 p-6">
      <div className="mb-3 text-xs uppercase tracking-widest text-slate-400">Full indicator vector</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr><th className="py-1 text-left font-normal">Indicator</th><th className="py-1 text-right font-normal">Raw</th><th className="py-1 text-right font-normal">Z-score</th></tr>
          </thead>
          <tbody>
            {rows.map(({ k, raw: r, z: zv }) => (
              <tr key={k} className="border-t border-slate-800/60">
                <td className="py-1.5 text-slate-300">{FEATURE_LABELS[k]}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-200">{r == null ? "—" : r.toFixed(2)}</td>
                <td className={`py-1.5 text-right tabular-nums ${zv == null ? "text-slate-500" : Math.abs(zv) > 1.5 ? (zv > 0 ? "text-rose-300" : "text-emerald-300") : "text-slate-300"}`}>
                  {zv == null ? "—" : zv.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BacktestSection({ bt, running }: { bt: any; running: boolean }) {
  return (
    <section className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-900/40 p-6">
      <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-widest text-slate-400">
        <span>Historical backtest</span>
        {bt && <span className="text-[10px] text-slate-500">{bt.run_label}</span>}
      </div>
      {!bt && !running && <div className="text-sm text-slate-400">No backtest run yet. Click "Run backtest" to score the engine against every eligible historical crisis.</div>}
      {running && <div className="text-sm text-cyan-300">Running backtest across historical crises…</div>}
      {bt && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Events scored" value={bt.summary.events_scored} />
            <Metric label="Flagged elevated (≥50)" value={`${bt.summary.events_flagged_elevated}/${bt.summary.events_scored}`} />
            <Metric label="Flagged high (≥65)" value={`${bt.summary.events_flagged_high}/${bt.summary.events_scored}`} />
            <Metric label="Median lead (elev)" value={bt.summary.median_lead_days_elevated != null ? `${bt.summary.median_lead_days_elevated}d` : "—"} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 text-left font-normal">Event</th>
                  <th className="py-1 text-right font-normal">SPY dd</th>
                  <th className="py-1 text-right font-normal">Peak EWS</th>
                  <th className="py-1 text-right font-normal">First ≥50</th>
                  <th className="py-1 text-right font-normal">First ≥65</th>
                  <th className="py-1 text-right font-normal">First ≥80</th>
                </tr>
              </thead>
              <tbody>
                {bt.per_event.map((e: any) => (
                  <tr key={e.event_id} className="border-t border-slate-800/60">
                    <td className="py-1.5 text-slate-200">{e.event_label}</td>
                    <td className="py-1.5 text-right tabular-nums text-rose-300">{e.dd_pct}%</td>
                    <td className="py-1.5 text-right tabular-nums text-cyan-300">{e.peak_ews_in_window}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-300">{e.first_elevated_days_before != null ? `${e.first_elevated_days_before}d` : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-300">{e.first_high_days_before != null ? `${e.first_high_days_before}d` : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-300">{e.first_crisis_days_before != null ? `${e.first_crisis_days_before}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950/50 p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{value ?? "—"}</div>
    </div>
  );
}

function EmptyState({ onRefresh, pending }: { onRefresh: () => void; pending: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-8 text-center">
      <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-300">
        <Activity className="h-6 w-6" />
      </div>
      <div className="text-lg font-semibold">No snapshot yet</div>
      <div className="mt-1 text-sm text-slate-400">Click below to compute the first cross-asset risk fingerprint. This pulls ~30 years of history and takes ~30-60s.</div>
      <button onClick={onRefresh} disabled={pending} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        Compute first snapshot
      </button>
    </div>
  );
}

function Disclaimers() {
  return (
    <section className="mt-8 rounded-2xl border border-slate-800/50 bg-slate-900/20 p-5 text-xs text-slate-400">
      <div className="mb-2 font-semibold text-slate-300">How to read this</div>
      <ul className="ml-4 list-disc space-y-1">
        <li>The Early Warning Score blends a weighted cross-asset risk vector (65%) with average similarity to historical crisis fingerprints (35%).</li>
        <li>Probabilities are the similarity-weighted evidence mix across historical analogs with similarity ≥ 60 — not directional forecasts.</li>
        <li>All features are %/ratio/z-score — price levels never enter comparisons, so a 2008-style fingerprint can match today regardless of dollar levels.</li>
        <li>Historical analogs are restricted to events with full multi-asset coverage (1998+). Pre-1998 crises are cataloged for context but do not influence today's score.</li>
        <li>This tool describes historical similarity. It is not investment advice and does not guarantee outcomes.</li>
      </ul>
    </section>
  );
}
