import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Play, Loader2, ShieldCheck, AlertTriangle, X, Database, CheckCircle2 } from "lucide-react";
import {
  runAnalogWalkForwardSymbol,
  persistWalkForwardRun,
  DEFAULT_ANALOG_VALIDATION_UNIVERSE,
  type WalkForwardSymbolResult,
} from "@/lib/analog-validation.functions";
import { rollupMetrics, type SymbolMetrics } from "@/lib/analog-validation.server";

export const Route = createFileRoute("/_authenticated/analog-validation")({
  head: () => ({
    meta: [
      { title: "Analog Scanner — Walk-Forward Validation" },
      { name: "description", content: "Per-symbol walk-forward accuracy of the Historical Analog Scanner — MAE, hit rate, calibration coverage, and bias measured against real forward returns." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalogValidationPage,
});

type LogEntry = { at: number; symbol: string; kind: "start" | "ok" | "warn" | "error"; msg: string };

function AnalogValidationPage() {
  const runSym = useServerFn(runAnalogWalkForwardSymbol);
  const persist = useServerFn(persistWalkForwardRun);

  const [universeText, setUniverseText] = useState(DEFAULT_ANALOG_VALIDATION_UNIVERSE.join(", "));
  const [testDates, setTestDates] = useState(40);
  const [windowYears, setWindowYears] = useState(8);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelReq, setCancelReq] = useState(false);
  const [perSymbol, setPerSymbol] = useState<SymbolMetrics[]>([]);
  const [sourceMap, setSourceMap] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [progressIdx, setProgressIdx] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const universe = useMemo(
    () =>
      universeText
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0 && s.length <= 12),
    [universeText],
  );

  const rollup = useMemo(() => (perSymbol.length ? rollupMetrics(perSymbol) : null), [perSymbol]);

  const addLog = (entry: Omit<LogEntry, "at">) =>
    setLog((l) => [...l, { ...entry, at: Date.now() }].slice(-500));

  const start = async () => {
    if (busy) return;
    if (universe.length === 0) { setRunError("Universe is empty."); return; }
    setBusy(true);
    setCancelReq(false);
    setRunError(null);
    setPerSymbol([]);
    setSourceMap({});
    setLog([]);
    setProgressIdx(0);
    setTotalCount(universe.length);
    setRunId(null);

    addLog({ symbol: "*", kind: "start", msg: `Run started: ${universe.length} symbols · ${testDates} test dates/symbol · ${windowYears}y window` });

    const collected: SymbolMetrics[] = [];
    const sources: Record<string, string> = {};

    for (let i = 0; i < universe.length; i++) {
      if (cancelReq) { addLog({ symbol: "*", kind: "warn", msg: "Cancelled by user." }); break; }
      const sym = universe[i];
      setProgressIdx(i);
      addLog({ symbol: sym, kind: "start", msg: `walk-forward…` });
      try {
        const r: WalkForwardSymbolResult = await runSym({
          data: { symbol: sym, testDatesPerSymbol: testDates, windowYears },
        });
        collected.push(r.metrics);
        sources[sym] = r.dataSource;
        setPerSymbol([...collected]);
        setSourceMap({ ...sources });
        if (r.error) {
          addLog({ symbol: sym, kind: "warn", msg: `${r.error} (${r.barCount} bars, source=${r.dataSource})` });
        } else {
          addLog({
            symbol: sym, kind: "ok",
            msg: `n=${r.metrics.predictions} · fwd30 MAE ${r.metrics.fwd30.mae}% hit ${(r.metrics.fwd30.hitRate * 100).toFixed(0)}% · fwd90 MAE ${r.metrics.fwd90.mae}% hit ${(r.metrics.fwd90.hitRate * 100).toFixed(0)}% · src=${r.dataSource}`,
          });
        }
      } catch (e) {
        addLog({ symbol: sym, kind: "error", msg: e instanceof Error ? e.message : String(e) });
      }
    }

    setProgressIdx(universe.length);

    if (collected.length > 0) {
      addLog({ symbol: "*", kind: "start", msg: "Persisting run…" });
      try {
        const pr = await persist({
          data: {
            universe,
            testDatesPerSymbol: testDates,
            windowYears,
            perSymbol: collected,
            notes: notes || undefined,
          },
        });
        if (pr.runId) {
          setRunId(pr.runId);
          addLog({ symbol: "*", kind: "ok", msg: `Persisted run ${pr.runId}` });
        } else if (pr.error) {
          addLog({ symbol: "*", kind: "warn", msg: `Persist failed: ${pr.error}` });
        }
      } catch (e) {
        addLog({ symbol: "*", kind: "warn", msg: `Persist error: ${e instanceof Error ? e.message : String(e)}` });
      }
    }

    setBusy(false);
    addLog({ symbol: "*", kind: "ok", msg: "Run complete." });
  };

  const cancel = () => setCancelReq(true);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5">
          <Link
            to="/"
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.2em] text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> back to terminal
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-violet-400" />
            Analog Scanner — Walk-Forward Validation
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Measures analog predictions against real forward returns (no look-ahead). MAE / hit rate / bias /
            calibration coverage of the p25–p75 band, per symbol and rolled up.
          </p>
        </div>

        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-emerald-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1 text-xs leading-relaxed">
            <div className="font-semibold text-emerald-100">No look-ahead</div>
            For each test date t, the scanner only sees bars up to t and matches must be ≥120 days before t.
            Ground truth is the symbol's actual forward 30/90-day return from t. Data source: Yahoo primary,
            Stooq fallback (both free, keyless).
          </div>
        </div>

        {runError && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">{runError}</div>
            <button onClick={() => setRunError(null)} className="text-rose-300 hover:text-rose-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 lg:col-span-2">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Universe</div>
            <textarea
              className="w-full min-h-[110px] rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-100 focus:border-violet-500/50 focus:outline-none"
              value={universeText}
              onChange={(e) => setUniverseText(e.target.value)}
              spellCheck={false}
              disabled={busy}
            />
            <div className="mt-1 text-[10px] font-mono text-slate-500">
              {universe.length} symbols · comma or whitespace separated
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 space-y-3">
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Test dates / symbol</div>
              <input
                type="number" min={5} max={200} value={testDates} disabled={busy}
                onChange={(e) => setTestDates(Math.max(5, Math.min(200, Number(e.target.value) || 40)))}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-violet-500/50 focus:outline-none"
              />
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Window years</div>
              <input
                type="number" min={2} max={20} value={windowYears} disabled={busy}
                onChange={(e) => setWindowYears(Math.max(2, Math.min(20, Number(e.target.value) || 8)))}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-violet-500/50 focus:outline-none"
              />
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Notes (optional)</div>
              <input
                type="text" value={notes} disabled={busy} maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="what changed in this run"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 focus:border-violet-500/50 focus:outline-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              {!busy ? (
                <button
                  onClick={start}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-100 hover:border-violet-400/70 hover:bg-violet-500/20"
                >
                  <Play className="h-4 w-4" /> Run validation
                </button>
              ) : (
                <button
                  onClick={cancel}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:border-rose-400/70 hover:bg-rose-500/20"
                >
                  <X className="h-4 w-4" /> Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {(busy || totalCount > 0) && (
          <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
                Progress · {progressIdx}/{totalCount}
              </div>
              <div className="font-mono text-[10px] text-slate-400">
                {busy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : <CheckCircle2 className="inline h-3 w-3 text-emerald-400" />}
                {" "}{busy ? "running" : "done"}
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full rounded bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                style={{ width: `${totalCount ? (progressIdx / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {rollup && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <MetricCard title="Forward 30d" m={rollup.fwd30} />
            <MetricCard title="Forward 90d" m={rollup.fwd90} />
            <div className="md:col-span-2 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 flex flex-wrap gap-x-6 gap-y-2 text-xs font-mono text-slate-300">
              <span>Total predictions: <span className="text-slate-100">{rollup.totalPredictions}</span></span>
              <span>Mean similarity: <span className="text-slate-100">{rollup.meanSim}%</span></span>
              {runId && <span>Run ID: <span className="text-slate-100">{runId}</span></span>}
            </div>
          </div>
        )}

        {perSymbol.length > 0 && (
          <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Per symbol</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left py-1 pr-3">Sym</th>
                    <th className="text-left py-1 pr-3">Src</th>
                    <th className="text-right py-1 pr-3">n</th>
                    <th className="text-right py-1 pr-3">30d MAE</th>
                    <th className="text-right py-1 pr-3">30d Hit</th>
                    <th className="text-right py-1 pr-3">30d Cov</th>
                    <th className="text-right py-1 pr-3">30d Bias</th>
                    <th className="text-right py-1 pr-3">90d MAE</th>
                    <th className="text-right py-1 pr-3">90d Hit</th>
                    <th className="text-right py-1 pr-3">90d Cov</th>
                    <th className="text-right py-1 pr-3">90d Bias</th>
                    <th className="text-right py-1">Sim</th>
                  </tr>
                </thead>
                <tbody>
                  {perSymbol.map((s) => (
                    <tr key={s.symbol} className="border-t border-slate-800/60">
                      <td className="py-1 pr-3 text-slate-100 font-semibold">{s.symbol}</td>
                      <td className="py-1 pr-3"><SourceBadge src={sourceMap[s.symbol]} /></td>
                      <td className="py-1 pr-3 text-right text-slate-300">{s.predictions}</td>
                      <td className="py-1 pr-3 text-right text-slate-300">{s.fwd30.mae}%</td>
                      <td className="py-1 pr-3 text-right text-slate-300">{(s.fwd30.hitRate * 100).toFixed(0)}%</td>
                      <td className="py-1 pr-3 text-right text-slate-300">{(s.fwd30.coverageP25P75 * 100).toFixed(0)}%</td>
                      <td className={`py-1 pr-3 text-right ${s.fwd30.bias > 0 ? "text-emerald-300" : "text-rose-300"}`}>{s.fwd30.bias > 0 ? "+" : ""}{s.fwd30.bias}%</td>
                      <td className="py-1 pr-3 text-right text-slate-300">{s.fwd90.mae}%</td>
                      <td className="py-1 pr-3 text-right text-slate-300">{(s.fwd90.hitRate * 100).toFixed(0)}%</td>
                      <td className="py-1 pr-3 text-right text-slate-300">{(s.fwd90.coverageP25P75 * 100).toFixed(0)}%</td>
                      <td className={`py-1 pr-3 text-right ${s.fwd90.bias > 0 ? "text-emerald-300" : "text-rose-300"}`}>{s.fwd90.bias > 0 ? "+" : ""}{s.fwd90.bias}%</td>
                      <td className="py-1 text-right text-slate-300">{s.meanSim}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {perSymbol.length > 0 && (
          <>
            <DistributionCharts perSymbol={perSymbol} />
            <ConfidenceBreakdown perSymbol={perSymbol} />
          </>
        )}

        <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">Live log</div>
            <button
              onClick={() => setLog([])}
              disabled={busy}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-mono uppercase text-slate-400 hover:border-slate-600 disabled:opacity-40"
            >
              clear
            </button>
          </div>
          <div
            ref={logRef}
            className="h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] leading-snug"
          >
            {log.length === 0 ? (
              <div className="text-slate-600">no activity yet</div>
            ) : (
              log.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-600">{new Date(l.at).toLocaleTimeString()}</span>
                  <span className={
                    l.kind === "error" ? "text-rose-300"
                    : l.kind === "warn" ? "text-amber-300"
                    : l.kind === "ok" ? "text-emerald-300"
                    : "text-violet-300"
                  }>{l.symbol}</span>
                  <span className="text-slate-300">{l.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, m }: { title: string; m: { n: number; mae: number; mdae: number; hitRate: number; bias: number; coverageP25P75: number } }) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-violet-300">{title}</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-mono">
        <Stat label="MAE" value={`${m.mae}%`} />
        <Stat label="MdAE" value={`${m.mdae}%`} />
        <Stat label="Hit rate" value={`${(m.hitRate * 100).toFixed(0)}%`} tone={m.hitRate > 0.55 ? "green" : m.hitRate < 0.45 ? "red" : "neutral"} />
        <Stat label="Coverage p25-p75" value={`${(m.coverageP25P75 * 100).toFixed(0)}%`} tone={m.coverageP25P75 > 0.45 ? "green" : m.coverageP25P75 < 0.35 ? "red" : "neutral"} />
        <Stat label="Bias" value={`${m.bias > 0 ? "+" : ""}${m.bias}%`} tone={Math.abs(m.bias) < 1 ? "green" : Math.abs(m.bias) < 3 ? "neutral" : "red"} />
        <Stat label="n" value={String(m.n)} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "green" | "red" | "neutral" }) {
  const cls = tone === "green" ? "text-emerald-300" : tone === "red" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
      <div className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold ${cls}`}>{value}</div>
    </div>
  );
}

function SourceBadge({ src }: { src?: string }) {
  if (!src || src === "none") return <span className="text-slate-600">—</span>;
  const cls =
    src === "yahoo" ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
    : src === "stooq" ? "border-teal-500/40 bg-teal-500/10 text-teal-200"
    : "border-slate-600 bg-slate-800/40 text-slate-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${cls}`}>
      <Database className="h-2.5 w-2.5" />
      {src}
    </span>
  );
}

// ── Distribution charts: per-symbol MAE, hit rate, coverage, bias ────────
function DistributionCharts({ perSymbol }: { perSymbol: SymbolMetrics[] }) {
  const sorted30 = [...perSymbol].sort((a, b) => a.fwd30.mae - b.fwd30.mae);
  const sorted90 = [...perSymbol].sort((a, b) => a.fwd90.mae - b.fwd90.mae);
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <BarChart title="Per-symbol MAE — 30d" rows={sorted30.map((s) => ({ label: s.symbol, value: s.fwd30.mae, suffix: "%" }))} accent="violet" />
      <BarChart title="Per-symbol MAE — 90d" rows={sorted90.map((s) => ({ label: s.symbol, value: s.fwd90.mae, suffix: "%" }))} accent="fuchsia" />
      <BarChart
        title="Directional hit rate — 30d"
        rows={[...perSymbol].sort((a, b) => b.fwd30.hitRate - a.fwd30.hitRate).map((s) => ({
          label: s.symbol,
          value: Math.round(s.fwd30.hitRate * 100),
          suffix: "%",
          tone: s.fwd30.hitRate >= 0.55 ? "green" : s.fwd30.hitRate < 0.45 ? "red" : "neutral",
        }))}
        accent="emerald"
        reference={50}
      />
      <BarChart
        title="Calibration coverage (p25–p75) — 30d"
        rows={[...perSymbol].sort((a, b) => b.fwd30.coverageP25P75 - a.fwd30.coverageP25P75).map((s) => ({
          label: s.symbol,
          value: Math.round(s.fwd30.coverageP25P75 * 100),
          suffix: "%",
          tone: s.fwd30.coverageP25P75 >= 0.45 ? "green" : s.fwd30.coverageP25P75 < 0.35 ? "red" : "neutral",
        }))}
        accent="teal"
        reference={50}
      />
      <BiasChart title="Bias — 30d (pred − actual)" rows={perSymbol.map((s) => ({ label: s.symbol, value: s.fwd30.bias }))} />
      <BiasChart title="Bias — 90d (pred − actual)" rows={perSymbol.map((s) => ({ label: s.symbol, value: s.fwd90.bias }))} />
    </div>
  );
}

type BarRow = { label: string; value: number; suffix?: string; tone?: "green" | "red" | "neutral" };

function BarChart({ title, rows, accent, reference }: { title: string; rows: BarRow[]; accent: "violet" | "fuchsia" | "emerald" | "teal"; reference?: number }) {
  const max = Math.max(reference ?? 0, ...rows.map((r) => r.value), 1);
  const fill = {
    violet: "bg-violet-500/70",
    fuchsia: "bg-fuchsia-500/70",
    emerald: "bg-emerald-500/70",
    teal: "bg-teal-500/70",
  }[accent];
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => {
          const pct = (r.value / max) * 100;
          const refPct = reference !== undefined ? (reference / max) * 100 : null;
          const valCls = r.tone === "green" ? "text-emerald-300" : r.tone === "red" ? "text-rose-300" : "text-slate-200";
          return (
            <div key={r.label} className="flex items-center gap-2">
              <div className="w-12 shrink-0 font-mono text-[10px] text-slate-400">{r.label}</div>
              <div className="relative flex-1 h-3 rounded bg-slate-800/60 overflow-hidden">
                <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
                {refPct !== null && (
                  <div className="absolute top-0 bottom-0 border-l border-dashed border-slate-500/60" style={{ left: `${refPct}%` }} />
                )}
              </div>
              <div className={`w-14 shrink-0 text-right font-mono text-[10px] ${valCls}`}>
                {r.value}{r.suffix ?? ""}
              </div>
            </div>
          );
        })}
      </div>
      {reference !== undefined && (
        <div className="mt-2 text-[9px] font-mono text-slate-500">dashed line = {reference}% reference</div>
      )}
    </div>
  );
}

function BiasChart({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => {
          const pct = (Math.abs(r.value) / max) * 50;
          const pos = r.value >= 0;
          return (
            <div key={r.label} className="flex items-center gap-2">
              <div className="w-12 shrink-0 font-mono text-[10px] text-slate-400">{r.label}</div>
              <div className="relative flex-1 h-3 rounded bg-slate-800/60 overflow-hidden">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-600" />
                <div
                  className={`absolute top-0 bottom-0 ${pos ? "bg-emerald-500/70" : "bg-rose-500/70"}`}
                  style={pos ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
                />
              </div>
              <div className={`w-14 shrink-0 text-right font-mono text-[10px] ${pos ? "text-emerald-300" : "text-rose-300"}`}>
                {pos ? "+" : ""}{r.value}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Confidence breakdown: bucket by mean similarity & match count ───────
function ConfidenceBreakdown({ perSymbol }: { perSymbol: SymbolMetrics[] }) {
  const simBuckets = bucket(perSymbol, (s) => s.meanSim, [
    { name: "Low sim (<70%)", test: (v) => v < 70 },
    { name: "Mid sim (70–80%)", test: (v) => v >= 70 && v < 80 },
    { name: "High sim (≥80%)", test: (v) => v >= 80 },
  ]);
  const matchBuckets = bucket(perSymbol, (s) => s.matchCountMedian, [
    { name: "Sparse (<5 matches)", test: (v) => v < 5 },
    { name: "Moderate (5–7)", test: (v) => v >= 5 && v < 8 },
    { name: "Dense (≥8)", test: (v) => v >= 8 },
  ]);

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <BreakdownTable title="By mean similarity" buckets={simBuckets} />
      <BreakdownTable title="By median match count" buckets={matchBuckets} />
    </div>
  );
}

type Bucket = { name: string; count: number; mae30: number; mae90: number; hit30: number; hit90: number; cov30: number };

function bucket(
  perSymbol: SymbolMetrics[],
  key: (s: SymbolMetrics) => number,
  defs: { name: string; test: (v: number) => boolean }[],
): Bucket[] {
  return defs.map((d) => {
    const rows = perSymbol.filter((s) => d.test(key(s)));
    const n = rows.length;
    const avg = (fn: (s: SymbolMetrics) => number) => (n ? rows.reduce((a, s) => a + fn(s), 0) / n : 0);
    return {
      name: d.name,
      count: n,
      mae30: Math.round(avg((s) => s.fwd30.mae) * 100) / 100,
      mae90: Math.round(avg((s) => s.fwd90.mae) * 100) / 100,
      hit30: Math.round(avg((s) => s.fwd30.hitRate) * 100),
      hit90: Math.round(avg((s) => s.fwd90.hitRate) * 100),
      cov30: Math.round(avg((s) => s.fwd30.coverageP25P75) * 100),
    };
  });
}

function BreakdownTable({ title, buckets }: { title: string; buckets: Bucket[] }) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <table className="w-full text-xs font-mono">
        <thead className="text-slate-500">
          <tr>
            <th className="text-left py-1 pr-2">Bucket</th>
            <th className="text-right py-1 pr-2">n</th>
            <th className="text-right py-1 pr-2">30d MAE</th>
            <th className="text-right py-1 pr-2">30d Hit</th>
            <th className="text-right py-1 pr-2">30d Cov</th>
            <th className="text-right py-1 pr-2">90d MAE</th>
            <th className="text-right py-1">90d Hit</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.name} className="border-t border-slate-800/60">
              <td className="py-1 pr-2 text-slate-200">{b.name}</td>
              <td className="py-1 pr-2 text-right text-slate-300">{b.count}</td>
              <td className="py-1 pr-2 text-right text-slate-300">{b.count ? `${b.mae30}%` : "—"}</td>
              <td className={`py-1 pr-2 text-right ${b.hit30 >= 55 ? "text-emerald-300" : b.hit30 < 45 && b.count ? "text-rose-300" : "text-slate-300"}`}>{b.count ? `${b.hit30}%` : "—"}</td>
              <td className={`py-1 pr-2 text-right ${b.cov30 >= 45 ? "text-emerald-300" : b.cov30 < 35 && b.count ? "text-rose-300" : "text-slate-300"}`}>{b.count ? `${b.cov30}%` : "—"}</td>
              <td className="py-1 pr-2 text-right text-slate-300">{b.count ? `${b.mae90}%` : "—"}</td>
              <td className={`py-1 text-right ${b.hit90 >= 55 ? "text-emerald-300" : b.hit90 < 45 && b.count ? "text-rose-300" : "text-slate-300"}`}>{b.count ? `${b.hit90}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
