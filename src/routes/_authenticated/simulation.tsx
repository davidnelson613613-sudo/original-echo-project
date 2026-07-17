import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Beaker, Play, Loader2, ShieldCheck, AlertTriangle, Download, Sparkles, FileText, X, GaugeCircle, History, Sliders, LayoutDashboard, Repeat, FlaskConical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { runSimulation, analyzeSimulationReport, type SimulationResponse, type AnalyzeReportResponse } from "@/lib/simulation.functions";
import {
  SCENARIO_LABELS,
  type CustomScenarioParams,
  type ScenarioKind,
} from "@/lib/simulation";
import { HistoricalReplayPanel, type ReplayRunMeta } from "@/components/sim/HistoricalReplayPanel";
import { SensitivityPanel } from "@/components/sim/SensitivityPanel";

export const Route = createFileRoute("/_authenticated/simulation")({
  head: () => ({
    meta: [
      { title: "Laddrx Simulation & Testing — Sandbox" },
      {
        name: "description",
        content:
          "Isolated sandbox for validating the Historical Pattern Recognition Scanner against synthetic and replayed market scenarios. Not connected to live data.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Laddrx Simulation & Testing — Sandbox" },
      {
        property: "og:description",
        content:
          "Isolated sandbox for validating the Historical Pattern Recognition Scanner against synthetic market scenarios.",
      },
    ],
  }),
  component: SimulationPage,
});

type Row = {
  id: string;
  label: string;
  scenario: ScenarioKind;
  seed: number;
  response: SimulationResponse;
};

const SCENARIOS: ScenarioKind[] = [
  "strong_rally",
  "sharp_decline",
  "consolidation",
  "recovery",
  "volatility_spike",
  "trend_reversal",
  "sector_weakness",
  "flat_market",
  "low_volatility",
  "high_volatility",
  "gap_up",
  "gap_down",
  "prolonged_bear",
  "prolonged_bull",
  "contradictory",
  "sudden_reversal",
  "minimum_history",
  "custom",
];

type Tab = "synthetic" | "replay" | "sensitivity" | "regression" | "dashboard";

function SimulationPage() {
  const run = useServerFn(runSimulation);
  const [scenario, setScenario] = useState<ScenarioKind>("sharp_decline");
  const [symbolLabel, setSymbolLabel] = useState("SIM-SMH");
  const [seed, setSeed] = useState(20260712);
  const [length, setLength] = useState(1200);
  const [custom, setCustom] = useState<CustomScenarioParams>({
    driftPctPerDay: 0,
    volPctPerDay: 1.2,
    shockPct: -10,
    shockOffsetFromEnd: 40,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<SimulationResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("synthetic");
  const [replayRuns, setReplayRuns] = useState<ReplayRunMeta[]>([]);

  const execute = async (override?: Partial<{ scenario: ScenarioKind; seed: number }>) => {
    setBusy(true);
    setError(null);
    try {
      const sc = override?.scenario ?? scenario;
      const sd = override?.seed ?? seed;
      const res = await run({
        data: {
          scenario: sc,
          seed: sd,
          length,
          symbolLabel,
          custom: sc === "custom" ? custom : undefined,
        },
      });
      setCurrent(res);
      setRows((prev) => [
        {
          id: `${sc}-${sd}-${Date.now()}`,
          label: `${SCENARIO_LABELS[sc]} · seed ${sd}`,
          scenario: sc,
          seed: sd,
          response: res,
        },
        ...prev,
      ].slice(0, 25));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runValidationSuite = async () => {
    setBusy(true);
    setError(null);
    try {
      const suite: Array<{ scenario: ScenarioKind; seed: number }> = [
        { scenario: "strong_rally", seed: 1001 },
        { scenario: "sharp_decline", seed: 1002 },
        { scenario: "consolidation", seed: 1003 },
        { scenario: "recovery", seed: 1004 },
        { scenario: "volatility_spike", seed: 1005 },
        { scenario: "trend_reversal", seed: 1006 },
        { scenario: "sector_weakness", seed: 1007 },
        { scenario: "flat_market", seed: 1008 },
        { scenario: "low_volatility", seed: 1009 },
        { scenario: "high_volatility", seed: 1010 },
        { scenario: "gap_up", seed: 1011 },
        { scenario: "gap_down", seed: 1012 },
        { scenario: "prolonged_bear", seed: 1013 },
        { scenario: "prolonged_bull", seed: 1014 },
        { scenario: "contradictory", seed: 1015 },
        { scenario: "sudden_reversal", seed: 1016 },
        { scenario: "minimum_history", seed: 1017 },
        { scenario: "sharp_decline", seed: 2002 },
        { scenario: "recovery", seed: 2004 },
      ];
      const collected: Row[] = [];
      for (const s of suite) {
        const res = await run({
          data: { scenario: s.scenario, seed: s.seed, length, symbolLabel: `SIM-${s.scenario.toUpperCase()}` },
        });
        collected.push({
          id: `${s.scenario}-${s.seed}-${Date.now()}-${Math.random()}`,
          label: `${SCENARIO_LABELS[s.scenario]} · seed ${s.seed}`,
          scenario: s.scenario,
          seed: s.seed,
          response: res,
        });
      }
      setRows(collected);
      setCurrent(collected[collected.length - 1]?.response ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-800/70 bg-slate-950/85 pl-16 pr-3 py-2.5 backdrop-blur sm:pl-20">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back to terminal</span>
          <span className="sm:hidden">Back</span>
        </Link>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
            <Beaker className="h-3.5 w-3.5" /> Sandbox · No Live Data
          </div>
          <Link
            to="/simulation/validation"
            className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/10 px-2.5 py-1.5 text-xs font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20"
            title="AI Validation & Optimization dashboard"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">AI Validation</span>
            <span className="sm:hidden">AI</span>
          </Link>
        </div>
        <button
          onClick={() => setDownloadOpen(true)}
          disabled={!current && rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-40"
          title={!current && rows.length === 0 ? "Run a simulation first" : "Download report"}
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Download report</span>
          <span className="sm:hidden">Report</span>
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-5">
        <IsolationBanner />

        <TabBar tab={tab} setTab={setTab} />

        {tab === "synthetic" && (<>


        <section className="mt-4 grid gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Scenario">
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as ScenarioKind)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100"
            >
              {SCENARIOS.map((s) => (
                <option key={s} value={s}>
                  {SCENARIO_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Symbol label (display only)">
            <input
              value={symbolLabel}
              onChange={(e) => setSymbolLabel(e.target.value.slice(0, 24))}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100"
            />
          </Field>
          <Field label="Seed (deterministic)">
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100"
            />
          </Field>
          <Field label="Length (daily bars, 400–3000)">
            <input
              type="number"
              value={length}
              min={400}
              max={3000}
              onChange={(e) => setLength(Math.min(3000, Math.max(400, Number(e.target.value) || 400)))}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100"
            />
          </Field>

          {scenario === "custom" && (
            <>
              <Field label="Drift %/day">
                <input
                  type="number"
                  step="0.01"
                  value={custom.driftPctPerDay}
                  onChange={(e) => setCustom({ ...custom, driftPctPerDay: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100"
                />
              </Field>
              <Field label="Vol %/day">
                <input
                  type="number"
                  step="0.05"
                  value={custom.volPctPerDay}
                  onChange={(e) => setCustom({ ...custom, volPctPerDay: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100"
                />
              </Field>
              <Field label="Shock % (single bar)">
                <input
                  type="number"
                  step="0.5"
                  value={custom.shockPct}
                  onChange={(e) => setCustom({ ...custom, shockPct: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100"
                />
              </Field>
              <Field label="Shock offset from end (bars)">
                <input
                  type="number"
                  value={custom.shockOffsetFromEnd}
                  onChange={(e) => setCustom({ ...custom, shockOffsetFromEnd: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100"
                />
              </Field>
            </>
          )}

          <div className="col-span-full flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={() => execute()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run simulation
            </button>
            <button
              onClick={runValidationSuite}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-2 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 disabled:opacity-60"
            >
              Run validation suite (9 scenarios)
            </button>
            <button
              onClick={() => { setRows([]); setCurrent(null); }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-slate-600 disabled:opacity-60"
            >
              Clear
            </button>
            {error && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-200">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </span>
            )}
          </div>
        </section>

        {current && <ResultView response={current} />}

        {rows.length > 0 && <ReportTable rows={rows} />}
        </>)}

        {tab === "replay" && (
          <div className="mt-4">
            <HistoricalReplayPanel onRunComplete={(r) => setReplayRuns((p) => [r, ...p].slice(0, 10))} />
          </div>
        )}

        {tab === "sensitivity" && (
          <div className="mt-4"><SensitivityPanel /></div>
        )}

        {tab === "regression" && (
          <div className="mt-4"><RegressionSuite rows={rows} /></div>
        )}

        {tab === "dashboard" && (
          <div className="mt-4"><ValidationDashboard rows={rows} replayRuns={replayRuns} /></div>
        )}
      </main>


      {downloadOpen && (
        <DownloadModal
          current={current}
          rows={rows}
          symbolLabel={symbolLabel}
          onClose={() => setDownloadOpen(false)}
        />
      )}
    </div>
  );
}

function IsolationBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-emerald-200">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-xs leading-relaxed">
        <div className="font-semibold text-emerald-100">Sandboxed environment</div>
        This page generates fully synthetic price series and runs them through the exact same
        production Historical Pattern Recognition Scanner. It never calls TwelveData, never
        reads or writes the production analog/history caches, and never affects live-market
        recommendations, watchlists, alerts, or analytics.
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-300">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function ResultView({ response }: { response: SimulationResponse }) {
  const r = response.result;
  const d = response.diagnostics;

  return (
    <section className="mt-4 grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
        <SectionTitle>Synthetic price</SectionTitle>
        <PriceChart data={response.previewPrices} />
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
        <SectionTitle>Diagnostics</SectionTitle>
        <KV k="Total time" v={`${d.timings.totalMs} ms`} />
        <KV k="  · generate" v={`${d.timings.generateMs} ms`} />
        <KV k="  · features" v={`${d.timings.featuresMs} ms`} />
        <KV k="  · market ctx" v={`${d.timings.contextMs} ms`} />
        <KV k="  · analog search" v={`${d.timings.searchMs} ms`} />
        <KV k="Feature rows" v={`${d.featureCoverage.usable}/${d.featureCoverage.total}`} />
        <KV k="Bars (sym/spy/sec)" v={`${d.bars.primary}/${d.bars.spy}/${d.bars.sector}`} />
        {d.warnings.length > 0 && (
          <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
            {d.warnings.map((w, i) => <div key={i}>• {w}</div>)}
          </div>
        )}
      </div>

      {d.currentSnapshot && (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
          <SectionTitle>Current feature snapshot</SectionTitle>
          {Object.entries(d.currentSnapshot).map(([k, v]) => (
            <KV key={k} k={k} v={typeof v === "number" ? v.toFixed(3) : String(v)} />
          ))}
        </div>
      )}

      {r ? (
        <>
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
            <SectionTitle>Best analog</SectionTitle>
            <KV k="Date" v={r.best.date} />
            <KV k="Symbol" v={r.best.symbol} />
            <KV k="Similarity" v={`${r.best.similarity}%`} />
            <KV k="Market phase" v={r.marketPhase} />
            <KV k="Prob. bottom in" v={`${r.aggregate.probBottomIn.toFixed(1)}%`} />
            <KV k="Prob. reversal" v={`${r.aggregate.probReversal.toFixed(1)}%`} />
            <KV k="Prob. continued decline" v={`${r.aggregate.probContinuedDecline.toFixed(1)}%`} />
            <KV k="Confidence (overall)" v={`${r.aggregate.confidenceOverall.toFixed(1)}%`} />
            <KV k="Mean min low" v={`${r.aggregate.meanMinLowPct.toFixed(2)}%`} />
            <KV k="Recovery rate" v={`${(r.aggregate.recoveryRate * 100).toFixed(1)}%`} />
            <p className="mt-2 text-xs text-slate-400">{r.summary}</p>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
            <SectionTitle>Distance breakdown</SectionTitle>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">
              Strongest similarities
            </div>
            {r.strongestSimilarities.map((f, i) => (
              <KV key={i} k={f.label} v={`Δ${f.delta.toFixed(2)} · score ${f.score.toFixed(1)}`} />
            ))}
            <div className="mb-2 mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-rose-300">
              Biggest differences
            </div>
            {r.biggestDifferences.map((f, i) => (
              <KV key={i} k={f.label} v={`Δ${f.delta.toFixed(2)} · score ${f.score.toFixed(1)}`} />
            ))}
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 lg:col-span-3">
            <SectionTitle>Top matches ({r.matches.length})</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Symbol</th>
                    <th className="px-2 py-1">Sim%</th>
                    <th className="px-2 py-1">dd60</th>
                    <th className="px-2 py-1">RSI14</th>
                    <th className="px-2 py-1">Min low</th>
                    <th className="px-2 py-1">Fwd30</th>
                    <th className="px-2 py-1">Fwd90</th>
                    <th className="px-2 py-1">Bottom type</th>
                    <th className="px-2 py-1">Recovered</th>
                  </tr>
                </thead>
                <tbody>
                  {r.matches.map((m) => (
                    <tr key={`${m.symbol}-${m.idx}`} className="border-t border-slate-800/60">
                      <td className="px-2 py-1 font-mono">{m.date}</td>
                      <td className="px-2 py-1">{m.symbol}</td>
                      <td className="px-2 py-1">{m.similarity}</td>
                      <td className="px-2 py-1">{m.features.dd60.toFixed(2)}</td>
                      <td className="px-2 py-1">{m.features.rsi14.toFixed(1)}</td>
                      <td className="px-2 py-1">{m.forward.minLowPct.toFixed(2)}</td>
                      <td className="px-2 py-1">{m.forward.fwd30?.toFixed(2) ?? "—"}</td>
                      <td className="px-2 py-1">{m.forward.fwd90?.toFixed(2) ?? "—"}</td>
                      <td className="px-2 py-1">{m.forward.bottomType}</td>
                      <td className="px-2 py-1">{m.forward.recovered ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 lg:col-span-3">
            <SectionTitle>Trader answers & horizons</SectionTitle>
            <p className="text-xs text-slate-300"><span className="text-slate-500">Phase narrative: </span>{r.phaseNarrative}</p>
            <p className="mt-1 text-xs text-slate-300"><span className="text-slate-500">Best narrative: </span>{r.bestNarrative}</p>
            <p className="mt-1 text-xs text-slate-300"><span className="text-slate-500">Usually happens: </span>{r.traderAnswers.whatUsuallyHappens}</p>
            <p className="mt-1 text-xs text-slate-300"><span className="text-slate-500">Biggest risks: </span>{r.traderAnswers.biggestRisks}</p>
            <p className="mt-1 text-xs text-slate-300"><span className="text-slate-500">Failure analysis: </span>{r.failureAnalysis.summary}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {r.horizons.map((h) => (
                <div key={h.days} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    {h.days}d horizon
                  </div>
                  <div className="text-sm text-slate-100">mean {h.meanPct.toFixed(2)}%</div>
                  <div className="text-[11px] text-slate-400">
                    p25 {h.p25.toFixed(2)} · p75 {h.p75.toFixed(2)} · prob↑ {(h.probUp * 100).toFixed(0)}% · conf {h.confidence.toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-amber-200 lg:col-span-3">
          Scanner returned no analog result for this scenario.
        </div>
      )}
    </section>
  );
}

function ReportTable({ rows }: { rows: Row[] }) {
  const summary = useMemo(() => {
    const withResult = rows.filter((r) => r.response.result);
    const avgConf = withResult.length
      ? withResult.reduce((s, r) => s + (r.response.result!.aggregate.confidenceOverall ?? 0), 0) / withResult.length
      : 0;
    const avgTime = rows.reduce((s, r) => s + r.response.diagnostics.timings.totalMs, 0) / rows.length;
    return { withResult: withResult.length, total: rows.length, avgConf, avgTime };
  }, [rows]);

  return (
    <section className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <SectionTitle>Testing report ({rows.length})</SectionTitle>
      <div className="mb-3 text-xs text-slate-400">
        Results with analog: {summary.withResult}/{summary.total} · avg confidence {summary.avgConf.toFixed(1)}% · avg run {summary.avgTime.toFixed(1)}ms
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="px-2 py-1">Run</th>
              <th className="px-2 py-1">Phase</th>
              <th className="px-2 py-1">Best sim</th>
              <th className="px-2 py-1">Prob rev</th>
              <th className="px-2 py-1">Prob cont↓</th>
              <th className="px-2 py-1">Prob bot</th>
              <th className="px-2 py-1">Mean min low</th>
              <th className="px-2 py-1">Conf</th>
              <th className="px-2 py-1">Matches</th>
              <th className="px-2 py-1">Time</th>
              <th className="px-2 py-1">Warn</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const res = r.response.result;
              const d = r.response.diagnostics;
              return (
                <tr key={r.id} className="border-t border-slate-800/60">
                  <td className="px-2 py-1">{r.label}</td>
                  <td className="px-2 py-1">{res?.marketPhase ?? "—"}</td>
                  <td className="px-2 py-1">{res?.best.similarity ?? "—"}</td>
                  <td className="px-2 py-1">{res ? res.aggregate.probReversal.toFixed(0) : "—"}</td>
                  <td className="px-2 py-1">{res ? res.aggregate.probContinuedDecline.toFixed(0) : "—"}</td>
                  <td className="px-2 py-1">{res ? res.aggregate.probBottomIn.toFixed(0) : "—"}</td>
                  <td className="px-2 py-1">{res ? res.aggregate.meanMinLowPct.toFixed(2) : "—"}</td>
                  <td className="px-2 py-1">{res ? res.aggregate.confidenceOverall.toFixed(0) : "—"}</td>
                  <td className="px-2 py-1">{res?.matches.length ?? 0}</td>
                  <td className="px-2 py-1">{d.timings.totalMs}ms</td>
                  <td className="px-2 py-1 text-amber-300">{d.warnings.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PriceChart({ data }: { data: { date: string; close: number }[] }) {
  if (data.length < 2) return <div className="text-xs text-slate-500">No data</div>;
  const w = 720, h = 180, pad = 8;
  const closes = data.map((d) => d.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const span = Math.max(1e-9, hi - lo);
  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((d.close - lo) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <polyline points={points} fill="none" stroke="rgb(103 232 249)" strokeWidth="1.5" />
      <text x={pad} y={12} className="fill-slate-500" fontSize="10">
        {data[0].date} → {data[data.length - 1].date}
      </text>
      <text x={w - pad} y={12} textAnchor="end" className="fill-slate-500" fontSize="10">
        {lo.toFixed(2)} … {hi.toFixed(2)}
      </text>
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-xs">
      <span className="text-slate-400">{k}</span>
      <span className="font-mono text-slate-100">{v}</span>
    </div>
  );
}

// ============================================================================
// Download modal — two paths:
//   1) AI-edited: sends the full report to the AI gateway, gets a professionally
//      rewritten Markdown document, offers .md and print-to-PDF downloads.
//   2) Original: prints the exact current report layout (including SVG chart
//      and all tables) as a high-fidelity vector PDF via the browser print
//      dialog. Nothing is rasterized so quality is preserved.
// ============================================================================

function DownloadModal({
  current,
  rows,
  symbolLabel,
  onClose,
}: {
  current: SimulationResponse | null;
  rows: Row[];
  symbolLabel: string;
  onClose: () => void;
}) {
  const analyze = useServerFn(analyzeSimulationReport);
  const [tab, setTab] = useState<"choose" | "ai" | "original">("choose");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AnalyzeReportResponse | null>(null);

  const generatedAt = useMemo(() => new Date().toISOString(), []);
  const fileStem = `laddrx-sandbox-${symbolLabel.replace(/[^a-z0-9-]+/gi, "_")}-${generatedAt.slice(0, 10)}`;

  const startAi = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await analyze({
        data: {
          current,
          rows: rows.map((r) => ({ label: r.label, scenario: r.scenario, seed: r.seed, response: r.response })),
          meta: { symbolLabel, generatedAt },
        },
      });
      setAiResult(res);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const downloadBlob = (name: string, mime: string, body: string) => {
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openPrint = (title: string, innerHtml: string) => {
    const w = window.open("", "_blank", "noopener,width=900,height=1100");
    if (!w) {
      alert("Popup blocked. Allow popups to export the PDF.");
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <style>
        @page { size: Letter; margin: 0.6in; }
        html, body { background: #fff; color: #0f172a; }
        body { font: 12px/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 0; }
        h1 { font-size: 22px; margin: 0 0 4px; }
        h2 { font-size: 15px; margin: 22px 0 6px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
        h3 { font-size: 13px; margin: 16px 0 4px; color: #334155; }
        p  { margin: 6px 0; }
        code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; }
        pre { background: #f1f5f9; padding: 10px; border-radius: 6px; overflow: auto; white-space: pre-wrap; }
        table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 11px; }
        th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
        th { background: #e2e8f0; }
        .meta { color: #475569; font-size: 11px; margin-bottom: 12px; }
        .kv { display: grid; grid-template-columns: 220px 1fr; gap: 2px 12px; margin: 6px 0 12px; }
        .kv .k { color: #475569; }
        .kv .v { font-family: ui-monospace, Menlo, Consolas, monospace; }
        .chart { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; margin: 6px 0 14px; }
        .badge { display: inline-block; padding: 1px 6px; border: 1px solid #94a3b8; border-radius: 4px; font-size: 10px; color: #334155; margin-right: 4px; }
        .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 10px; }
        @media print { .no-print { display: none; } }
      </style></head><body>${innerHtml}
      <div class="no-print" style="position:fixed;top:8px;right:8px;">
        <button onclick="window.print()" style="padding:6px 12px;font:600 12px sans-serif;background:#0f172a;color:#fff;border:0;border-radius:6px;cursor:pointer;">Print / Save as PDF</button>
      </div>
      <script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),350);});</script>
      </body></html>`);
    w.document.close();
  };

  const downloadAiPdf = () => {
    if (!aiResult) return;
    const html = marked.parse(aiResult.markdown, { async: false }) as string;
    const body = `
      <h1>Laddrx Sandbox Report — AI-Edited</h1>
      <div class="meta">
        <span class="badge">AI-edited</span>
        <span class="badge">${escapeHtml(aiResult.model)}</span>
        <span class="badge">${escapeHtml(symbolLabel)}</span>
        Generated ${escapeHtml(generatedAt)}
      </div>
      ${html}
      <div class="footer">Generated by Laddrx Simulation &amp; Testing sandbox. Fully synthetic data — not investment advice.</div>
    `;
    openPrint("Laddrx Sandbox Report — AI-Edited", body);
  };

  const downloadOriginalPdf = () => {
    openPrint("Laddrx Sandbox Report — Original", buildOriginalReportHtml({ current, rows, symbolLabel, generatedAt }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Download className="h-4 w-4 text-emerald-300" /> Download sandbox report
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {tab === "choose" && (
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <button
              onClick={() => setTab("ai")}
              className="flex flex-col items-start gap-2 rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 p-4 text-left transition hover:bg-fuchsia-500/20"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-fuchsia-100">
                <Sparkles className="h-4 w-4" /> AI-edited report
              </div>
              <p className="text-xs text-fuchsia-200/80">
                An AI analyst reads the entire report and rewrites it as a clean, professionally worded document
                that explains every chart, table, metric, and diagnostic in plain language. Download as Markdown
                or a print-quality PDF.
              </p>
            </button>
            <button
              onClick={() => setTab("original")}
              className="flex flex-col items-start gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-4 text-left transition hover:bg-cyan-500/20"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
                <FileText className="h-4 w-4" /> Original report
              </div>
              <p className="text-xs text-cyan-200/80">
                The exact report as generated — every chart, table, and value preserved verbatim. Exported as a
                high-resolution vector PDF so nothing loses quality.
              </p>
            </button>
          </div>
        )}

        {tab === "ai" && (
          <div className="p-4">
            <button onClick={() => setTab("choose")} className="mb-3 text-xs text-slate-400 hover:text-slate-200">
              ← Back
            </button>
            {!aiResult && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-sm text-slate-200">
                  Send the full report to the AI analyst for a detailed rewrite.
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Nothing is downloaded until you review the result. This uses Lovable AI (Gemini 2.5 Flash) and may take
                  10–30 seconds for large reports.
                </div>
                <button
                  onClick={startAi}
                  disabled={aiBusy}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-2 text-sm font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-60"
                >
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {aiBusy ? "Analyzing entire report…" : "Analyze report with AI"}
                </button>
                {aiError && (
                  <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
                    {aiError}
                  </div>
                )}
              </div>
            )}
            {aiResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => downloadBlob(`${fileStem}-ai.md`, "text/markdown;charset=utf-8", aiResult.markdown)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20"
                  >
                    <Download className="h-4 w-4" /> Download .md
                  </button>
                  <button
                    onClick={downloadAiPdf}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20"
                  >
                    <Download className="h-4 w-4" /> Download .pdf
                  </button>
                  <button
                    onClick={() => downloadBlob(`${fileStem}-ai.txt`, "text/plain;charset=utf-8", aiResult.markdown)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-slate-600"
                  >
                    <Download className="h-4 w-4" /> Download .txt
                  </button>
                  <button
                    onClick={() => setAiResult(null)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-slate-600"
                  >
                    Regenerate
                  </button>
                </div>
                <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <div
                    className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-100 prose-p:text-slate-200 prose-strong:text-slate-100 prose-code:text-cyan-200"
                    dangerouslySetInnerHTML={{ __html: marked.parse(aiResult.markdown, { async: false }) as string }}
                  />
                </div>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">
                  model {aiResult.model} · {aiResult.usage?.promptTokens ?? "?"} in / {aiResult.usage?.completionTokens ?? "?"} out tokens
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "original" && (
          <div className="p-4">
            <button onClick={() => setTab("choose")} className="mb-3 text-xs text-slate-400 hover:text-slate-200">
              ← Back
            </button>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-200">Download the report exactly as generated.</div>
              <div className="mt-1 text-xs text-slate-400">
                Opens the browser print dialog with a vector-rendered version of every chart, table, and value.
                Choose &ldquo;Save as PDF&rdquo; for a crystal-clear, high-resolution export — nothing is rasterized.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={downloadOriginalPdf}
                  disabled={!current && rows.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
                >
                  <Download className="h-4 w-4" /> Download original .pdf
                </button>
                <button
                  onClick={() => downloadBlob(
                    `${fileStem}-original.json`,
                    "application/json",
                    JSON.stringify({ symbolLabel, generatedAt, current, rows }, null, 2),
                  )}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-slate-600"
                >
                  <Download className="h-4 w-4" /> Raw .json
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function buildPriceSvg(data: { date: string; close: number }[]) {
  if (data.length < 2) return "";
  const w = 820, h = 220, pad = 12;
  const closes = data.map((d) => d.close);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const span = Math.max(1e-9, hi - lo);
  const pts = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((d.close - lo) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">
    <rect x="0" y="0" width="${w}" height="${h}" fill="#f8fafc"/>
    <polyline points="${pts}" fill="none" stroke="#0369a1" stroke-width="1.5"/>
    <text x="${pad}" y="14" font-size="10" fill="#475569">${escapeHtml(data[0].date)} → ${escapeHtml(data[data.length - 1].date)}</text>
    <text x="${w - pad}" y="14" text-anchor="end" font-size="10" fill="#475569">${lo.toFixed(2)} … ${hi.toFixed(2)}</text>
  </svg>`;
}

function buildOriginalReportHtml({
  current,
  rows,
  symbolLabel,
  generatedAt,
}: {
  current: SimulationResponse | null;
  rows: Row[];
  symbolLabel: string;
  generatedAt: string;
}) {
  const parts: string[] = [];
  parts.push(`<h1>Laddrx Sandbox Report — Original</h1>`);
  parts.push(`<div class="meta"><span class="badge">Original</span><span class="badge">${escapeHtml(symbolLabel)}</span>Generated ${escapeHtml(generatedAt)}</div>`);
  parts.push(`<p><strong>Isolation:</strong> Fully synthetic data generated in-sandbox. No live API calls, no production cache reads or writes, no impact on live watchlists, alerts, or analytics.</p>`);

  if (current) {
    const r = current.result;
    const d = current.diagnostics;
    parts.push(`<h2>Current Run</h2>`);
    parts.push(`<h3>Synthetic Price</h3><div class="chart">${buildPriceSvg(current.previewPrices)}</div>`);

    parts.push(`<h3>Diagnostics</h3><div class="kv">
      <div class="k">Total time</div><div class="v">${d.timings.totalMs} ms</div>
      <div class="k">Generate</div><div class="v">${d.timings.generateMs} ms</div>
      <div class="k">Features</div><div class="v">${d.timings.featuresMs} ms</div>
      <div class="k">Market context</div><div class="v">${d.timings.contextMs} ms</div>
      <div class="k">Analog search</div><div class="v">${d.timings.searchMs} ms</div>
      <div class="k">Feature rows (usable/total)</div><div class="v">${d.featureCoverage.usable}/${d.featureCoverage.total}</div>
      <div class="k">Bars (primary/spy/sector)</div><div class="v">${d.bars.primary}/${d.bars.spy}/${d.bars.sector}</div>
    </div>`);
    if (d.warnings.length) {
      parts.push(`<p><strong>Warnings:</strong></p><ul>${d.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`);
    }

    if (d.currentSnapshot) {
      parts.push(`<h3>Current Feature Snapshot</h3><div class="kv">${
        Object.entries(d.currentSnapshot).map(([k, v]) =>
          `<div class="k">${escapeHtml(k)}</div><div class="v">${typeof v === "number" ? v.toFixed(4) : escapeHtml(String(v))}</div>`,
        ).join("")
      }</div>`);
    }

    if (r) {
      parts.push(`<h3>Best Analog</h3><div class="kv">
        <div class="k">Date</div><div class="v">${escapeHtml(r.best.date)}</div>
        <div class="k">Symbol</div><div class="v">${escapeHtml(r.best.symbol)}</div>
        <div class="k">Similarity</div><div class="v">${r.best.similarity}%</div>
        <div class="k">Market phase</div><div class="v">${escapeHtml(r.marketPhase)}</div>
        <div class="k">Prob. bottom in</div><div class="v">${r.aggregate.probBottomIn.toFixed(1)}%</div>
        <div class="k">Prob. reversal</div><div class="v">${r.aggregate.probReversal.toFixed(1)}%</div>
        <div class="k">Prob. continued decline</div><div class="v">${r.aggregate.probContinuedDecline.toFixed(1)}%</div>
        <div class="k">Overall confidence</div><div class="v">${r.aggregate.confidenceOverall.toFixed(1)}%</div>
        <div class="k">Mean min low</div><div class="v">${r.aggregate.meanMinLowPct.toFixed(2)}%</div>
        <div class="k">Recovery rate</div><div class="v">${(r.aggregate.recoveryRate * 100).toFixed(1)}%</div>
      </div>`);
      parts.push(`<p>${escapeHtml(r.summary)}</p>`);

      parts.push(`<h3>Distance Breakdown</h3>`);
      parts.push(`<p><strong>Strongest similarities</strong></p><table><thead><tr><th>Feature</th><th>Δ</th><th>Score</th></tr></thead><tbody>${
        r.strongestSimilarities.map((f) => `<tr><td>${escapeHtml(f.label)}</td><td>${f.delta.toFixed(3)}</td><td>${f.score.toFixed(2)}</td></tr>`).join("")
      }</tbody></table>`);
      parts.push(`<p><strong>Biggest differences</strong></p><table><thead><tr><th>Feature</th><th>Δ</th><th>Score</th></tr></thead><tbody>${
        r.biggestDifferences.map((f) => `<tr><td>${escapeHtml(f.label)}</td><td>${f.delta.toFixed(3)}</td><td>${f.score.toFixed(2)}</td></tr>`).join("")
      }</tbody></table>`);

      parts.push(`<h3>Top Matches</h3><table><thead><tr>
        <th>Date</th><th>Symbol</th><th>Sim %</th><th>dd60</th><th>RSI14</th><th>Min low</th><th>Fwd30</th><th>Fwd90</th><th>Bottom type</th><th>Recovered</th>
      </tr></thead><tbody>${
        r.matches.map((m) => `<tr>
          <td>${escapeHtml(m.date)}</td>
          <td>${escapeHtml(m.symbol)}</td>
          <td>${m.similarity}</td>
          <td>${m.features.dd60.toFixed(2)}</td>
          <td>${m.features.rsi14.toFixed(1)}</td>
          <td>${m.forward.minLowPct.toFixed(2)}</td>
          <td>${m.forward.fwd30?.toFixed(2) ?? "—"}</td>
          <td>${m.forward.fwd90?.toFixed(2) ?? "—"}</td>
          <td>${escapeHtml(m.forward.bottomType)}</td>
          <td>${m.forward.recovered ? "yes" : "no"}</td>
        </tr>`).join("")
      }</tbody></table>`);

      parts.push(`<h3>Trader Answers</h3>
        <p><strong>Phase narrative:</strong> ${escapeHtml(r.phaseNarrative)}</p>
        <p><strong>Best narrative:</strong> ${escapeHtml(r.bestNarrative)}</p>
        <p><strong>What usually happens:</strong> ${escapeHtml(r.traderAnswers.whatUsuallyHappens)}</p>
        <p><strong>Biggest risks:</strong> ${escapeHtml(r.traderAnswers.biggestRisks)}</p>
        <p><strong>Failure analysis:</strong> ${escapeHtml(r.failureAnalysis.summary)}</p>`);

      parts.push(`<h3>Forward Horizons</h3><table><thead><tr><th>Days</th><th>Mean %</th><th>p25</th><th>p75</th><th>Prob ↑</th><th>Confidence</th></tr></thead><tbody>${
        r.horizons.map((h) => `<tr><td>${h.days}</td><td>${h.meanPct.toFixed(2)}</td><td>${h.p25.toFixed(2)}</td><td>${h.p75.toFixed(2)}</td><td>${(h.probUp * 100).toFixed(0)}%</td><td>${h.confidence.toFixed(0)}%</td></tr>`).join("")
      }</tbody></table>`);
    } else {
      parts.push(`<p><em>Scanner returned no analog result for this scenario.</em></p>`);
    }
  }

  if (rows.length > 0) {
    parts.push(`<h2>Cross-Scenario Report (${rows.length})</h2>`);
    parts.push(`<table><thead><tr>
      <th>Run</th><th>Phase</th><th>Best sim</th><th>Prob rev</th><th>Prob cont↓</th><th>Prob bot</th><th>Mean min low</th><th>Conf</th><th>Matches</th><th>Time</th><th>Warn</th>
    </tr></thead><tbody>${
      rows.map((row) => {
        const res = row.response.result;
        const d = row.response.diagnostics;
        return `<tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${escapeHtml(res?.marketPhase ?? "—")}</td>
          <td>${res?.best.similarity ?? "—"}</td>
          <td>${res ? res.aggregate.probReversal.toFixed(0) : "—"}</td>
          <td>${res ? res.aggregate.probContinuedDecline.toFixed(0) : "—"}</td>
          <td>${res ? res.aggregate.probBottomIn.toFixed(0) : "—"}</td>
          <td>${res ? res.aggregate.meanMinLowPct.toFixed(2) : "—"}</td>
          <td>${res ? res.aggregate.confidenceOverall.toFixed(0) : "—"}</td>
          <td>${res?.matches.length ?? 0}</td>
          <td>${d.timings.totalMs}ms</td>
          <td>${d.warnings.length}</td>
        </tr>`;
      }).join("")
    }</tbody></table>`);
  }

  parts.push(`<div class="footer">Generated by Laddrx Simulation &amp; Testing sandbox. Fully synthetic data — not investment advice.</div>`);
  return parts.join("\n");
}

// ============================================================================
// Tab bar
// ============================================================================
function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "synthetic", label: "Synthetic scenarios", icon: FlaskConical },
    { key: "replay", label: "Historical replay", icon: History },
    { key: "sensitivity", label: "Sensitivity", icon: Sliders },
    { key: "regression", label: "Regression suite", icon: Repeat },
    { key: "dashboard", label: "Validation dashboard", icon: LayoutDashboard },
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-1.5 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-1.5">
      {items.map((it) => {
        const active = tab === it.key;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            onClick={() => setTab(it.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? "bg-cyan-500/15 text-cyan-100 border border-cyan-400/40"
                : "text-slate-300 border border-transparent hover:border-slate-700 hover:bg-slate-900"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Regression suite — snapshots pinned scenarios in browser localStorage
// (sandbox-only key; never touches production caches or databases).
// ============================================================================
type RegressionBaseline = {
  id: string;
  label: string;
  scenario: ScenarioKind;
  seed: number;
  snapshot: {
    marketPhase: string | null;
    bestAnalog: string | null;
    similarity: number | null;
    probBottomIn: number | null;
    probReversal: number | null;
    probContinuedDecline: number | null;
    confidenceOverall: number | null;
    meanFwd30: number | null;
    meanFwd90: number | null;
  };
  savedAt: number;
};

const REGRESSION_KEY = "laddrx.sandbox.regression.baselines.v1";

function snapshotFrom(res: SimulationResponse): RegressionBaseline["snapshot"] {
  const r = res.result;
  return {
    marketPhase: r?.marketPhase ?? null,
    bestAnalog: r ? `${r.best.symbol}:${r.best.date}` : null,
    similarity: r?.best.similarity ?? null,
    probBottomIn: r?.aggregate.probBottomIn ?? null,
    probReversal: r?.aggregate.probReversal ?? null,
    probContinuedDecline: r?.aggregate.probContinuedDecline ?? null,
    confidenceOverall: r?.aggregate.confidenceOverall ?? null,
    meanFwd30: r?.aggregate.meanFwd30 ?? null,
    meanFwd90: r?.aggregate.meanFwd90 ?? null,
  };
}

function RegressionSuite({ rows }: { rows: Row[] }) {
  const run = useServerFn(runSimulation);
  const [baselines, setBaselines] = useState<RegressionBaseline[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    Array<{ baseline: RegressionBaseline; current: RegressionBaseline["snapshot"]; changes: string[]; status: "pass" | "regression" | "improvement" }>
  >([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REGRESSION_KEY);
      if (raw) setBaselines(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persist = (next: RegressionBaseline[]) => {
    setBaselines(next);
    try { localStorage.setItem(REGRESSION_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const pinRow = (row: Row) => {
    const b: RegressionBaseline = {
      id: `${row.scenario}-${row.seed}`,
      label: row.label,
      scenario: row.scenario,
      seed: row.seed,
      snapshot: snapshotFrom(row.response),
      savedAt: Date.now(),
    };
    const next = [b, ...baselines.filter((x) => x.id !== b.id)];
    persist(next);
  };

  const remove = (id: string) => persist(baselines.filter((b) => b.id !== id));
  const clear = () => persist([]);

  const runAll = async () => {
    setBusy(true);
    setResults([]);
    try {
      const out: typeof results = [];
      for (const b of baselines) {
        const res = await run({ data: { scenario: b.scenario, seed: b.seed, length: 1200, symbolLabel: `REG-${b.scenario}` } });
        const cur = snapshotFrom(res);
        const changes: string[] = [];
        const cmp = (name: string, a: number | null, c: number | null, tol: number) => {
          if (a === null && c === null) return;
          if (a === null || c === null) { changes.push(`${name}: ${a ?? "null"} → ${c ?? "null"}`); return; }
          if (Math.abs(a - c) > tol) changes.push(`${name}: ${a.toFixed(2)} → ${c.toFixed(2)}`);
        };
        if (b.snapshot.marketPhase !== cur.marketPhase) changes.push(`phase: ${b.snapshot.marketPhase} → ${cur.marketPhase}`);
        if (b.snapshot.bestAnalog !== cur.bestAnalog) changes.push(`analog: ${b.snapshot.bestAnalog} → ${cur.bestAnalog}`);
        cmp("similarity", b.snapshot.similarity, cur.similarity, 0.5);
        cmp("probBottom", b.snapshot.probBottomIn, cur.probBottomIn, 1);
        cmp("probReversal", b.snapshot.probReversal, cur.probReversal, 1);
        cmp("probCont↓", b.snapshot.probContinuedDecline, cur.probContinuedDecline, 1);
        cmp("confidence", b.snapshot.confidenceOverall, cur.confidenceOverall, 1);
        cmp("meanFwd30", b.snapshot.meanFwd30, cur.meanFwd30, 0.5);
        cmp("meanFwd90", b.snapshot.meanFwd90, cur.meanFwd90, 0.5);
        const status: "pass" | "regression" | "improvement" =
          changes.length === 0
            ? "pass"
            : (b.snapshot.confidenceOverall ?? 0) < (cur.confidenceOverall ?? 0)
              ? "improvement"
              : "regression";
        out.push({ baseline: b, current: cur, changes, status });
      }
      setResults(out);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-3">
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Pin passing scenarios as baselines</div>
        <div className="text-xs text-slate-400 mb-2">
          Baselines live in your browser only (localStorage key <code className="font-mono">{REGRESSION_KEY}</code>). Nothing is written to production databases, caches, or analytics.
        </div>
        {rows.length === 0 ? (
          <div className="text-xs text-slate-500">Run scenarios in the Synthetic scenarios tab first — then pin them here.</div>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {rows.map((r) => {
              const pinned = baselines.some((b) => b.id === `${r.scenario}-${r.seed}`);
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-xs">
                  <span className="truncate">{r.label}</span>
                  <button
                    onClick={() => pinRow(r)}
                    className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${pinned ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-slate-700 text-slate-300 hover:border-cyan-400/40 hover:text-cyan-100"}`}
                  >
                    {pinned ? "pinned" : "pin"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Baselines ({baselines.length})</div>
          <div className="flex items-center gap-2">
            <button onClick={runAll} disabled={busy || baselines.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />}
              Rerun all baselines
            </button>
            <button onClick={clear} className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600">Clear</button>
          </div>
        </div>
        {baselines.length === 0 ? (
          <div className="text-xs text-slate-500">No baselines pinned yet.</div>
        ) : (
          <div className="grid gap-1.5">
            {baselines.map((b) => {
              const r = results.find((x) => x.baseline.id === b.id);
              return (
                <div key={b.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-slate-200">{b.label}</span>
                    <div className="flex items-center gap-2">
                      {r && (
                        <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                          r.status === "pass" ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" :
                          r.status === "improvement" ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200" :
                          "border-rose-400/40 bg-rose-500/10 text-rose-200"
                        }`}>{r.status}</span>
                      )}
                      <button onClick={() => remove(b.id)} className="text-slate-500 hover:text-slate-200">remove</button>
                    </div>
                  </div>
                  {r && r.changes.length > 0 && (
                    <div className="mt-1.5 text-[11px] text-slate-400">
                      {r.changes.map((c, i) => <div key={i}>• {c}</div>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ============================================================================
// Validation dashboard
// ============================================================================
function ValidationDashboard({ rows, replayRuns }: { rows: Row[]; replayRuns: ReplayRunMeta[] }) {
  const stats = useMemo(() => {
    const withResult = rows.filter((r) => r.response.result);
    const passed = withResult.length;
    const failed = rows.length - passed;
    const avgConf = withResult.length
      ? withResult.reduce((s, r) => s + (r.response.result!.aggregate.confidenceOverall ?? 0), 0) / withResult.length
      : 0;
    const avgSim = withResult.length
      ? withResult.reduce((s, r) => s + (r.response.result!.best.similarity ?? 0), 0) / withResult.length
      : 0;
    const avgTime = rows.length
      ? rows.reduce((s, r) => s + r.response.diagnostics.timings.totalMs, 0) / rows.length
      : 0;
    const warnings = rows.reduce((s, r) => s + r.response.diagnostics.warnings.length, 0);
    const scenariosCovered = new Set(rows.map((r) => r.scenario)).size;
    return { total: rows.length, passed, failed, avgConf, avgSim, avgTime, warnings, scenariosCovered };
  }, [rows]);

  const replayStats = useMemo(() => {
    if (replayRuns.length === 0) return null;
    const totalSteps = replayRuns.reduce((s, r) => s + r.response.stability.totalSteps, 0);
    const switches = replayRuns.reduce((s, r) => s + r.response.stability.analogSwitches, 0);
    const unstable = replayRuns.reduce((s, r) => s + r.response.stability.unstableFlags.length, 0);
    const accs = replayRuns.map((r) => r.response.accuracy.fwd30DirectionAccuracy).filter((v): v is number => v !== null);
    const meanDirAcc = accs.length ? accs.reduce((s, v) => s + v, 0) / accs.length : null;
    return { runs: replayRuns.length, totalSteps, switches, unstable, meanDirAcc };
  }, [replayRuns]);

  const totalScenarios = Object.keys(SCENARIO_LABELS).length - 1; // exclude "custom"

  return (
    <section className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={GaugeCircle} label="Synthetic runs" value={String(stats.total)} sub={`${stats.passed} passed · ${stats.failed} failed`} />
        <Card icon={GaugeCircle} label="Scenario coverage" value={`${stats.scenariosCovered}/${totalScenarios}`} sub="unique scenario kinds" />
        <Card icon={GaugeCircle} label="Avg confidence" value={`${stats.avgConf.toFixed(1)}%`} sub={`avg similarity ${stats.avgSim.toFixed(1)}%`} />
        <Card icon={GaugeCircle} label="Avg runtime" value={`${stats.avgTime.toFixed(0)} ms`} sub={`${stats.warnings} warnings total`} />
      </div>

      {replayStats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card icon={History} label="Replay runs" value={String(replayStats.runs)} sub={`${replayStats.totalSteps} steps`} />
          <Card icon={History} label="Analog switches" value={String(replayStats.switches)} sub={`${replayStats.unstable} flagged unstable`} />
          <Card icon={History} label="Fwd30 direction acc" value={replayStats.meanDirAcc !== null ? `${(replayStats.meanDirAcc * 100).toFixed(1)}%` : "—"} sub="across replays" />
          <Card icon={History} label="Prediction quality" value={replayStats.meanDirAcc !== null && replayStats.meanDirAcc > 0.5 ? "above chance" : "review"} sub="fwd30 sign match" />
        </div>
      )}

      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Attention required</div>
        <ul className="grid gap-1 text-xs">
          {stats.failed > 0 && <li className="text-rose-300">• {stats.failed} synthetic run(s) returned no analog — investigate.</li>}
          {stats.warnings > 0 && <li className="text-amber-300">• {stats.warnings} diagnostic warning(s) across synthetic runs.</li>}
          {replayStats && replayStats.unstable > 0 && <li className="text-amber-300">• {replayStats.unstable} unstable / regressive analog switches during replay.</li>}
          {stats.scenariosCovered < totalScenarios && <li className="text-slate-300">• Scenario coverage {stats.scenariosCovered}/{totalScenarios} — run the full validation suite for complete coverage.</li>}
          {stats.total === 0 && <li className="text-slate-400">• No runs yet. Start in the Synthetic scenarios tab.</li>}
          {stats.failed === 0 && stats.warnings === 0 && stats.total > 0 && (!replayStats || replayStats.unstable === 0) && (
            <li className="text-emerald-300">• No issues detected. Scanner behaving within tolerance across {stats.total} run(s).</li>
          )}
        </ul>
      </div>
    </section>
  );
}

function Card({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}

