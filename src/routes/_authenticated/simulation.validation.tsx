import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Play,
  Trophy,
  Beaker,
  History as HistoryIcon,
  Info,
  Trash2,
  Crown,
  X,
  CheckCircle2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  runHistoricalReplay,
  type ReplayResponse,
} from "@/lib/simulation.functions";
import {
  VALIDATION_SCENARIOS,
  REGIME_LABELS,
  type ValidationScenario,
} from "@/lib/validation/scenarios";
import {
  DEFAULT_CHAMPION,
  configHash,
  generateChallengers,
  loadChampion,
  saveChampion,
  type ScannerConfig,
} from "@/lib/validation/config";
import {
  computeSuiteMetrics,
  isChallengerBetter,
  type ScenarioRun,
  type SuiteMetrics,
} from "@/lib/validation/metrics";
import {
  appendRun,
  loadHistory,
  saveHistory,
  type StoredRun,
} from "@/lib/validation/storage";

export const Route = createFileRoute("/_authenticated/simulation/validation")({
  head: () => ({
    meta: [
      { title: "AI Validation & Optimization — Sandbox" },
      { name: "description", content: "Sandbox-only validation harness for the Historical Pattern Recognition Scanner. Tests scanner behaviour against replayed market history with strict no-look-ahead." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "AI Validation & Optimization — Sandbox" },
      { property: "og:description", content: "Continuous quality-control system for the pattern scanner — replay, analyze, optimize, verify." },
    ],
  }),
  component: ValidationPage,
});

type ProgressState = {
  totalScenarios: number;
  completedScenarios: number;
  currentLabel: string | null;
  totalConfigs: number;
  completedConfigs: number;
};

function ValidationPage() {
  const replay = useServerFn(runHistoricalReplay);

  const [champion, setChampion] = useState<ScannerConfig>(DEFAULT_CHAMPION);
  const [challenger, setChallenger] = useState<ScannerConfig>(DEFAULT_CHAMPION);
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(
    () => new Set(VALIDATION_SCENARIOS.map((s) => s.id)),
  );
  const [replayCache, setReplayCache] = useState<Map<string, ReplayResponse>>(new Map());
  const [championMetrics, setChampionMetrics] = useState<SuiteMetrics | null>(null);
  const [challengerMetrics, setChallengerMetrics] = useState<SuiteMetrics | null>(null);
  const [history, setHistory] = useState<StoredRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [batchCount, setBatchCount] = useState(6);
  const [batchSeed, setBatchSeed] = useState(20260713);
  const [batchResults, setBatchResults] = useState<Array<{ cfg: ScannerConfig; metrics: SuiteMetrics; better: boolean; reasons: string[] }>>([]);
  const [showIsolation, setShowIsolation] = useState(true);

  useEffect(() => {
    setChampion(loadChampion());
    setHistory(loadHistory());
  }, []);

  const activeScenarios = useMemo(
    () => VALIDATION_SCENARIOS.filter((s) => selectedScenarios.has(s.id)),
    [selectedScenarios],
  );

  const cachedRuns = useMemo<ScenarioRun[]>(() => {
    const out: ScenarioRun[] = [];
    for (const sc of activeScenarios) {
      const r = replayCache.get(sc.id);
      if (r) out.push({ scenario: sc, response: r });
    }
    return out;
  }, [activeScenarios, replayCache]);

  // Recompute champion + challenger metrics whenever config or cache changes.
  useEffect(() => {
    if (cachedRuns.length === 0) {
      setChampionMetrics(null);
      setChallengerMetrics(null);
      return;
    }
    setChampionMetrics(computeSuiteMetrics(cachedRuns, champion));
    setChallengerMetrics(computeSuiteMetrics(cachedRuns, challenger));
  }, [cachedRuns, champion, challenger]);

  const fetchScenarios = async (scenarios: ValidationScenario[]) => {
    const next = new Map(replayCache);
    for (let i = 0; i < scenarios.length; i++) {
      const sc = scenarios[i];
      if (next.has(sc.id)) {
        setProgress((p) => p ? { ...p, completedScenarios: p.completedScenarios + 1, currentLabel: sc.label } : p);
        continue;
      }
      setProgress((p) => p ? { ...p, currentLabel: sc.label } : p);
      try {
        const r = await replay({
          data: {
            symbol: sc.symbol,
            startOffsetFromEnd: sc.startOffsetFromEnd,
            steps: sc.steps,
            stride: sc.stride,
          },
        });
        next.set(sc.id, r);
      } catch (e) {
        throw new Error(`${sc.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setProgress((p) => p ? { ...p, completedScenarios: p.completedScenarios + 1 } : p);
    }
    setReplayCache(next);
    return next;
  };

  const runSuite = async () => {
    if (activeScenarios.length === 0) {
      setError("Select at least one scenario.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress({
      totalScenarios: activeScenarios.length,
      completedScenarios: 0,
      currentLabel: null,
      totalConfigs: 1,
      completedConfigs: 0,
    });
    try {
      const cache = await fetchScenarios(activeScenarios);
      const runs: ScenarioRun[] = activeScenarios
        .map((sc) => {
          const r = cache.get(sc.id);
          return r ? { scenario: sc, response: r } : null;
        })
        .filter((r): r is ScenarioRun => r !== null);
      const metrics = computeSuiteMetrics(runs, champion);
      const stored: StoredRun = {
        id: `champ-${Date.now()}`,
        ranAt: Date.now(),
        config: { ...champion },
        configHash: configHash(champion),
        metrics,
        verdict: "champion_baseline",
        reasons: [],
        championHashAtRun: configHash(champion),
      };
      setHistory(appendRun(stored));
      setBatchResults([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runChallengerBatch = async () => {
    if (activeScenarios.length === 0) {
      setError("Select at least one scenario.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress({
      totalScenarios: activeScenarios.length,
      completedScenarios: 0,
      currentLabel: null,
      totalConfigs: batchCount + 1,
      completedConfigs: 0,
    });
    try {
      const cache = await fetchScenarios(activeScenarios);
      const runs: ScenarioRun[] = activeScenarios
        .map((sc) => {
          const r = cache.get(sc.id);
          return r ? { scenario: sc, response: r } : null;
        })
        .filter((r): r is ScenarioRun => r !== null);

      const champMetrics = computeSuiteMetrics(runs, champion);
      setChampionMetrics(champMetrics);
      setProgress((p) => p ? { ...p, completedConfigs: 1 } : p);

      const challengers = generateChallengers(champion, batchCount, batchSeed);
      const results: typeof batchResults = [];
      let bestChallenger: { cfg: ScannerConfig; metrics: SuiteMetrics } | null = null;
      let bestReasons: string[] = [];

      for (const cfg of challengers) {
        const m = computeSuiteMetrics(runs, cfg);
        const cmp = isChallengerBetter(champMetrics, m);
        results.push({ cfg, metrics: m, better: cmp.better, reasons: cmp.reasons });
        setProgress((p) => p ? { ...p, completedConfigs: p.completedConfigs + 1 } : p);
        if (cmp.better) {
          if (!bestChallenger || (m.directionAccuracy ?? 0) > (bestChallenger.metrics.directionAccuracy ?? 0)) {
            bestChallenger = { cfg, metrics: m };
            bestReasons = cmp.reasons;
          }
        }
      }

      setBatchResults(results);

      // Persist run history for every challenger tested.
      const historyEntries: StoredRun[] = results.map((r) => ({
        id: `chal-${configHash(r.cfg)}-${Date.now() + Math.random()}`,
        ranAt: Date.now(),
        config: r.cfg,
        configHash: configHash(r.cfg),
        metrics: r.metrics,
        verdict: r.better ? "promoted" : "rejected",
        reasons: r.reasons,
        championHashAtRun: configHash(champion),
      }));
      const merged = [...historyEntries, ...loadHistory()];
      saveHistory(merged);
      setHistory(loadHistory());

      if (bestChallenger) {
        setChallenger(bestChallenger.cfg);
        setChallengerMetrics(bestChallenger.metrics);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const promoteChallenger = () => {
    if (!challengerMetrics || !championMetrics) return;
    const cmp = isChallengerBetter(championMetrics, challengerMetrics);
    if (!cmp.better) {
      setError(`Cannot promote — regression gate failed: ${cmp.reasons.join("; ")}`);
      return;
    }
    setChampion(challenger);
    saveChampion(challenger);
    setError(null);
  };

  const resetToDefault = () => {
    setChampion(DEFAULT_CHAMPION);
    saveChampion(DEFAULT_CHAMPION);
    setChallenger(DEFAULT_CHAMPION);
  };

  const clearHistory = () => {
    saveHistory([]);
    setHistory([]);
    setBatchResults([]);
  };

  const clearCache = () => {
    setReplayCache(new Map());
    setChampionMetrics(null);
    setChallengerMetrics(null);
    setBatchResults([]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              to="/simulation"
              className="mb-2 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.2em] text-slate-400 hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> back to sandbox
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Beaker className="h-6 w-6 text-cyan-400" />
              AI Validation & Optimization
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Continuous quality-control system for the Historical Pattern Recognition Scanner.
              Runs entirely inside the sandbox with strict no-look-ahead.
            </p>
          </div>
        </div>

        {showIsolation && (
          <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-emerald-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1 text-xs leading-relaxed">
              <div className="font-semibold text-emerald-100">Isolation guarantees</div>
              This dashboard uses read-only historical bars via the existing sandbox
              replay engine. No writes touch production caches, watchlists, alerts,
              analytics, or user-facing scanner results. Champion / challenger configs
              apply as post-hoc <em>gate policies</em> over replay outputs — the live
              scanner engine is not mutated. Storage keys are prefixed{" "}
              <code className="rounded bg-slate-900/70 px-1 py-0.5 font-mono">validation.*</code>{" "}
              in this browser only.
            </div>
            <button
              onClick={() => setShowIsolation(false)}
              className="rounded-md p-1 text-emerald-300 hover:bg-emerald-500/10"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">{error}</div>
            <button onClick={() => setError(null)} className="text-rose-300 hover:text-rose-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <ScenarioPicker
            selected={selectedScenarios}
            onToggle={(id) => {
              const next = new Set(selectedScenarios);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              setSelectedScenarios(next);
            }}
            onAll={() => setSelectedScenarios(new Set(VALIDATION_SCENARIOS.map((s) => s.id)))}
            onNone={() => setSelectedScenarios(new Set())}
            cached={replayCache}
          />

          <RunControls
            busy={busy}
            progress={progress}
            batchCount={batchCount}
            setBatchCount={setBatchCount}
            batchSeed={batchSeed}
            setBatchSeed={setBatchSeed}
            onRunSuite={runSuite}
            onRunBatch={runChallengerBatch}
            onClearCache={clearCache}
            onResetChampion={resetToDefault}
            onClearHistory={clearHistory}
          />

          <ConfigCard
            title="Champion"
            icon={<Crown className="h-4 w-4 text-amber-400" />}
            cfg={champion}
            onChange={setChampion}
            metrics={championMetrics}
            highlight
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ConfigCard
            title="Challenger"
            icon={<Beaker className="h-4 w-4 text-cyan-400" />}
            cfg={challenger}
            onChange={setChallenger}
            metrics={challengerMetrics}
            actionSlot={
              championMetrics && challengerMetrics ? (
                <PromoteButton
                  champion={championMetrics}
                  challenger={challengerMetrics}
                  onPromote={promoteChallenger}
                />
              ) : null
            }
          />
          <ComparisonPanel champion={championMetrics} challenger={challengerMetrics} />
        </div>

        {(championMetrics || challengerMetrics) && (
          <>
            <RegimePanel champion={championMetrics} challenger={challengerMetrics} />
            <CalibrationPanel metrics={challengerMetrics ?? championMetrics!} />
            <FailuresPanel metrics={challengerMetrics ?? championMetrics!} />
          </>
        )}

        {batchResults.length > 0 && (
          <BatchResultsPanel results={batchResults} onApply={(cfg) => setChallenger(cfg)} />
        )}

        <HistoryPanel history={history} />
      </div>
    </div>
  );
}

// ================================================================
// Sub-components
// ================================================================

function ScenarioPicker({
  selected, onToggle, onAll, onNone, cached,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
  cached: Map<string, ReplayResponse>;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
          Scenario library ({selected.size}/{VALIDATION_SCENARIOS.length})
        </div>
        <div className="flex gap-1">
          <button onClick={onAll} className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-mono uppercase text-slate-300 hover:border-slate-600">all</button>
          <button onClick={onNone} className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-mono uppercase text-slate-300 hover:border-slate-600">none</button>
        </div>
      </div>
      <div className="grid max-h-72 gap-1 overflow-y-auto pr-1">
        {VALIDATION_SCENARIOS.map((sc) => {
          const isCached = cached.has(sc.id);
          const isSel = selected.has(sc.id);
          return (
            <label
              key={sc.id}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${isSel ? "border-cyan-500/40 bg-cyan-500/5" : "border-slate-800 bg-slate-950/40"}`}
            >
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => onToggle(sc.id)}
                className="mt-0.5 accent-cyan-400"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">{sc.label}</span>
                  {isCached && (
                    <span title="Replay data cached" className="text-[9px] text-emerald-400">●</span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {REGIME_LABELS[sc.regime]} · {sc.symbol} · {sc.steps} steps × {sc.stride} bars
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RunControls({
  busy, progress, batchCount, setBatchCount, batchSeed, setBatchSeed,
  onRunSuite, onRunBatch, onClearCache, onResetChampion, onClearHistory,
}: {
  busy: boolean;
  progress: ProgressState | null;
  batchCount: number;
  setBatchCount: (n: number) => void;
  batchSeed: number;
  setBatchSeed: (n: number) => void;
  onRunSuite: () => void;
  onRunBatch: () => void;
  onClearCache: () => void;
  onResetChampion: () => void;
  onClearHistory: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
        Controls
      </div>
      <div className="grid gap-2">
        <button
          onClick={onRunSuite}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? "Running…" : "Run validation suite"}
        </button>
        <button
          onClick={onRunBatch}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-2 text-sm font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
          Run {batchCount} challengers
        </button>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">
            challengers
            <input type="number" value={batchCount} min={1} max={20} onChange={(e) => setBatchCount(Math.max(1, Math.min(20, +e.target.value || 1)))} className="mt-0.5 w-full rounded border border-slate-800 bg-slate-950 px-1.5 py-1 text-xs text-slate-100" />
          </label>
          <label className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">
            seed
            <input type="number" value={batchSeed} onChange={(e) => setBatchSeed(+e.target.value || 0)} className="mt-0.5 w-full rounded border border-slate-800 bg-slate-950 px-1.5 py-1 text-xs text-slate-100" />
          </label>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <button onClick={onClearCache} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-mono uppercase text-slate-300 hover:border-slate-600">
            clear cache
          </button>
          <button onClick={onResetChampion} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-mono uppercase text-slate-300 hover:border-slate-600">
            reset champ
          </button>
          <button onClick={onClearHistory} className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-[10px] font-mono uppercase text-rose-300 hover:bg-rose-500/10">
            clear history
          </button>
        </div>
      </div>
      {progress && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[11px] text-slate-300">
          <div>Scenarios: {progress.completedScenarios}/{progress.totalScenarios}</div>
          {progress.currentLabel && (
            <div className="mt-0.5 truncate text-slate-400">→ {progress.currentLabel}</div>
          )}
          <div className="mt-1 h-1 rounded bg-slate-800">
            <div
              className="h-1 rounded bg-cyan-400 transition-all"
              style={{ width: `${(progress.completedScenarios / Math.max(1, progress.totalScenarios)) * 100}%` }}
            />
          </div>
          {progress.totalConfigs > 1 && (
            <div className="mt-1 text-[10px] text-slate-500">
              Configs: {progress.completedConfigs}/{progress.totalConfigs}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigCard({
  title, icon, cfg, onChange, metrics, actionSlot, highlight,
}: {
  title: string;
  icon: React.ReactNode;
  cfg: ScannerConfig;
  onChange: (c: ScannerConfig) => void;
  metrics: SuiteMetrics | null;
  actionSlot?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${highlight ? "border-amber-500/40 bg-amber-500/5" : "border-slate-800/80 bg-slate-900/40"}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-slate-100">{title}</span>
          <span className="font-mono text-[9px] text-slate-500">{configHash(cfg)}</span>
        </div>
        {actionSlot}
      </div>
      <div className="grid gap-2">
        <SliderField label="Min similarity (%)" value={cfg.minSimilarity} min={0} max={90} step={1} onChange={(v) => onChange({ ...cfg, minSimilarity: v })} />
        <SliderField label="Min confidence (%)" value={cfg.minConfidence} min={0} max={90} step={1} onChange={(v) => onChange({ ...cfg, minConfidence: v })} />
        <SliderField label="Switch cooldown (steps)" value={cfg.switchCooldownSteps} min={0} max={10} step={1} onChange={(v) => onChange({ ...cfg, switchCooldownSteps: v })} />
        <label className="mt-1 flex items-center gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            checked={cfg.discardUnstableSwitches}
            onChange={(e) => onChange({ ...cfg, discardUnstableSwitches: e.target.checked })}
            className="accent-cyan-400"
          />
          Discard unstable / regressive switches
        </label>
      </div>
      {metrics ? <MetricsGrid m={metrics} /> : (
        <div className="mt-3 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-3 text-center text-[11px] text-slate-500">
          Run the suite to populate metrics.
        </div>
      )}
    </div>
  );
}

function SliderField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="text-[11px] text-slate-300">
      <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
        <span>{label}</span><span className="text-slate-300">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="mt-0.5 w-full accent-cyan-400" />
    </label>
  );
}

function MetricsGrid({ m }: { m: SuiteMetrics }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-[11px]">
      <Metric k="Direction acc" v={fmtPct(m.directionAccuracy)} accent={m.directionAccuracy !== null && m.directionAccuracy >= 0.55 ? "good" : m.directionAccuracy !== null && m.directionAccuracy < 0.5 ? "bad" : undefined} />
      <Metric k="Worst regime" v={fmtPct(m.worstRegimeAccuracy)} accent={m.worstRegimeAccuracy !== null && m.worstRegimeAccuracy >= 0.5 ? "good" : "bad"} />
      <Metric k="Mean |err|" v={m.meanAbsFwd30Error !== null ? `${m.meanAbsFwd30Error.toFixed(2)}pp` : "—"} />
      <Metric k="Brier" v={m.brierScore !== null ? m.brierScore.toFixed(3) : "—"} />
      <Metric k="Eff. steps" v={`${m.effectiveSteps} (–${m.gatedOutSteps})`} />
      <Metric k="Switch rate" v={fmtPct(m.analogSwitchRate)} />
      <Metric k="Mean sim" v={m.meanSimilarity !== null ? `${m.meanSimilarity.toFixed(1)}%` : "—"} />
      <Metric k="Mean conf" v={m.meanConfidence !== null ? `${m.meanConfidence.toFixed(1)}%` : "—"} />
    </div>
  );
}

function Metric({ k, v, accent }: { k: string; v: string; accent?: "good" | "bad" }) {
  const c = accent === "good" ? "text-emerald-300" : accent === "bad" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{k}</span>
      <span className={`font-mono ${c}`}>{v}</span>
    </div>
  );
}

function PromoteButton({ champion, challenger, onPromote }: { champion: SuiteMetrics; challenger: SuiteMetrics; onPromote: () => void }) {
  const cmp = isChallengerBetter(champion, challenger);
  return (
    <button
      onClick={onPromote}
      disabled={!cmp.better}
      title={cmp.better ? "Promote challenger → champion" : cmp.reasons.join("; ")}
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.15em] ${cmp.better ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20" : "border-slate-700 bg-slate-900 text-slate-500"}`}
    >
      <Trophy className="h-3 w-3" />
      {cmp.better ? "promote" : "blocked"}
    </button>
  );
}

function ComparisonPanel({ champion, challenger }: { champion: SuiteMetrics | null; challenger: SuiteMetrics | null }) {
  if (!champion || !challenger) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 text-[11px] text-slate-500">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
          Champion vs Challenger
        </div>
        Run the suite to compare.
      </div>
    );
  }
  const cmp = isChallengerBetter(champion, challenger);
  const rows: Array<{ k: string; a: string; b: string; delta: string; good: boolean }> = [
    row("Direction acc", champion.directionAccuracy, challenger.directionAccuracy, "pct"),
    row("Worst regime", champion.worstRegimeAccuracy, challenger.worstRegimeAccuracy, "pct"),
    row("Mean |err|", champion.meanAbsFwd30Error, challenger.meanAbsFwd30Error, "pp", true),
    row("Brier", champion.brierScore, challenger.brierScore, "raw", true),
    row("Eff. steps", champion.effectiveSteps, challenger.effectiveSteps, "int"),
  ];
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
          Champion vs Challenger
        </div>
        {cmp.better ? (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono uppercase text-emerald-200">
            <CheckCircle2 className="h-3 w-3" /> better
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-mono uppercase text-rose-200">
            <AlertTriangle className="h-3 w-3" /> no promotion
          </span>
        )}
      </div>
      <table className="w-full text-left text-xs">
        <thead className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">
          <tr><th className="py-1">metric</th><th className="py-1">champ</th><th className="py-1">chal</th><th className="py-1">Δ</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t border-slate-800/60">
              <td className="py-1 text-slate-400">{r.k}</td>
              <td className="py-1 font-mono text-slate-200">{r.a}</td>
              <td className="py-1 font-mono text-slate-200">{r.b}</td>
              <td className={`py-1 font-mono ${r.good ? "text-emerald-300" : "text-rose-300"}`}>{r.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!cmp.better && cmp.reasons.length > 0 && (
        <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-200">
          <div className="font-semibold">Regression gate blocked promotion:</div>
          <ul className="list-disc pl-4">
            {cmp.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function row(
  k: string,
  a: number | null,
  b: number | null,
  fmt: "pct" | "pp" | "raw" | "int",
  lowerBetter = false,
): { k: string; a: string; b: string; delta: string; good: boolean } {
  const format = (v: number | null) => {
    if (v === null) return "—";
    if (fmt === "pct") return `${(v * 100).toFixed(1)}%`;
    if (fmt === "pp") return `${v.toFixed(2)}pp`;
    if (fmt === "int") return String(v);
    return v.toFixed(3);
  };
  const dv = a !== null && b !== null ? b - a : null;
  let good = false;
  if (dv !== null) {
    good = lowerBetter ? dv < 0 : dv > 0;
  }
  let delta = "—";
  if (dv !== null) {
    const sign = dv > 0 ? "+" : "";
    if (fmt === "pct") delta = `${sign}${(dv * 100).toFixed(1)}pp`;
    else if (fmt === "pp") delta = `${sign}${dv.toFixed(2)}pp`;
    else if (fmt === "int") delta = `${sign}${dv}`;
    else delta = `${sign}${dv.toFixed(3)}`;
  }
  return { k, a: format(a), b: format(b), delta, good };
}

function RegimePanel({ champion, challenger }: { champion: SuiteMetrics | null; challenger: SuiteMetrics | null }) {
  const source = challenger ?? champion;
  if (!source) return null;
  return (
    <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
        Accuracy by market regime {challenger ? "(challenger)" : "(champion)"}
      </div>
      <table className="w-full text-left text-xs">
        <thead className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">
          <tr>
            <th className="py-1">Regime</th>
            <th className="py-1">Scenarios</th>
            <th className="py-1">Eff. steps</th>
            <th className="py-1">Direction acc</th>
            <th className="py-1">Mean |err|</th>
          </tr>
        </thead>
        <tbody>
          {source.perRegime.map((r) => (
            <tr key={r.regime} className="border-t border-slate-800/60">
              <td className="py-1 text-slate-200">{REGIME_LABELS[r.regime]}</td>
              <td className="py-1 font-mono text-slate-400">{r.scenarios}</td>
              <td className="py-1 font-mono text-slate-400">{r.effectiveSteps}</td>
              <td className={`py-1 font-mono ${r.directionAccuracy !== null && r.directionAccuracy >= 0.55 ? "text-emerald-300" : r.directionAccuracy !== null && r.directionAccuracy < 0.5 ? "text-rose-300" : "text-slate-200"}`}>{fmtPct(r.directionAccuracy)}</td>
              <td className="py-1 font-mono text-slate-200">{r.meanAbsError !== null ? `${r.meanAbsError.toFixed(2)}pp` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalibrationPanel({ metrics }: { metrics: SuiteMetrics }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <BucketTable title="Calibration by confidence bucket" buckets={metrics.confidenceBuckets} />
      <BucketTable title="Accuracy by similarity bucket" buckets={metrics.similarityBuckets} />
    </div>
  );
}

function BucketTable({ title, buckets }: { title: string; buckets: SuiteMetrics["confidenceBuckets"] }) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
        {title}
      </div>
      {buckets.length === 0 ? (
        <div className="text-[11px] text-slate-500">No data.</div>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">
            <tr><th className="py-1">Bucket</th><th className="py-1">Count</th><th className="py-1">Direction acc</th><th className="py-1">Mean |err|</th></tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.bucket} className="border-t border-slate-800/60">
                <td className="py-1 font-mono text-slate-200">{b.bucket}</td>
                <td className="py-1 font-mono text-slate-400">{b.count}</td>
                <td className="py-1 font-mono text-slate-100">{fmtPct(b.directionAccuracy)}</td>
                <td className="py-1 font-mono text-slate-100">{b.meanAbsError !== null ? `${b.meanAbsError.toFixed(2)}pp` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FailuresPanel({ metrics }: { metrics: SuiteMetrics }) {
  const grouped = new Map<string, number>();
  for (const f of metrics.failures) grouped.set(f.reason, (grouped.get(f.reason) ?? 0) + 1);
  return (
    <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
          Failure analysis
        </div>
        <div className="flex flex-wrap gap-1">
          {Array.from(grouped.entries()).map(([r, n]) => (
            <span key={r} className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
              {r}: {n}
            </span>
          ))}
        </div>
      </div>
      {metrics.failures.length === 0 ? (
        <div className="text-[11px] text-slate-500">No failures detected in the tested window.</div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="py-1">Scenario</th><th className="py-1">Date</th><th className="py-1">Reason</th><th className="py-1">Sim/Conf</th><th className="py-1">Pred/Actual fwd30</th>
              </tr>
            </thead>
            <tbody>
              {metrics.failures.slice(0, 50).map((f, i) => (
                <tr key={i} className="border-t border-slate-800/60">
                  <td className="py-1 font-mono text-slate-300">{f.scenarioId}</td>
                  <td className="py-1 font-mono text-slate-400">{f.date}</td>
                  <td className="py-1 text-rose-300">{f.reason}</td>
                  <td className="py-1 font-mono text-slate-400">
                    {f.similarity !== null ? `${f.similarity.toFixed(0)}` : "—"}/
                    {f.confidence !== null ? `${f.confidence.toFixed(0)}` : "—"}
                  </td>
                  <td className="py-1 font-mono text-slate-400">
                    {f.predictedFwd30 !== null ? f.predictedFwd30.toFixed(1) : "—"}/
                    {f.actualFwd30 !== null ? f.actualFwd30.toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BatchResultsPanel({ results, onApply }: { results: Array<{ cfg: ScannerConfig; metrics: SuiteMetrics; better: boolean; reasons: string[] }>; onApply: (c: ScannerConfig) => void }) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
        Challenger batch ({results.filter((r) => r.better).length}/{results.length} passed regression gate)
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="py-1">Config</th><th className="py-1">Dir acc</th><th className="py-1">Worst regime</th><th className="py-1">Mean |err|</th><th className="py-1">Brier</th><th className="py-1">Eff.</th><th className="py-1">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className={`border-t border-slate-800/60 ${r.better ? "bg-emerald-500/5" : ""}`}>
                <td className="py-1 font-mono text-slate-300">{configHash(r.cfg)}</td>
                <td className="py-1 font-mono text-slate-100">{fmtPct(r.metrics.directionAccuracy)}</td>
                <td className="py-1 font-mono text-slate-100">{fmtPct(r.metrics.worstRegimeAccuracy)}</td>
                <td className="py-1 font-mono text-slate-100">{r.metrics.meanAbsFwd30Error !== null ? r.metrics.meanAbsFwd30Error.toFixed(2) : "—"}</td>
                <td className="py-1 font-mono text-slate-100">{r.metrics.brierScore !== null ? r.metrics.brierScore.toFixed(3) : "—"}</td>
                <td className="py-1 font-mono text-slate-400">{r.metrics.effectiveSteps}</td>
                <td className="py-1">
                  {r.better ? (
                    <button onClick={() => onApply(r.cfg)} className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-emerald-200 hover:bg-emerald-500/20">
                      apply
                    </button>
                  ) : (
                    <span title={r.reasons.join("; ")} className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500">
                      blocked
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryPanel({ history }: { history: StoredRun[] }) {
  if (history.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
        <HistoryIcon className="h-3.5 w-3.5" /> Run history ({history.length})
      </div>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="py-1">When</th><th className="py-1">Config</th><th className="py-1">Verdict</th><th className="py-1">Dir acc</th><th className="py-1">Worst reg</th><th className="py-1">Reasons</th>
            </tr>
          </thead>
          <tbody>
            {history.slice(0, 30).map((r) => (
              <tr key={r.id} className="border-t border-slate-800/60">
                <td className="py-1 font-mono text-slate-400">{new Date(r.ranAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
                <td className="py-1 font-mono text-slate-300">{r.configHash}</td>
                <td className={`py-1 font-mono uppercase ${r.verdict === "promoted" ? "text-emerald-300" : r.verdict === "rejected" ? "text-rose-300" : "text-amber-300"}`}>{r.verdict.replace("_", " ")}</td>
                <td className="py-1 font-mono text-slate-100">{fmtPct(r.metrics.directionAccuracy)}</td>
                <td className="py-1 font-mono text-slate-100">{fmtPct(r.metrics.worstRegimeAccuracy)}</td>
                <td className="py-1 text-[10px] text-slate-500 truncate max-w-[220px]" title={r.reasons.join("; ")}>{r.reasons.join("; ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
