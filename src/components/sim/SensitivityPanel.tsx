import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sliders, AlertTriangle } from "lucide-react";
import { runSensitivity, type SensitivityResponse } from "@/lib/simulation.functions";
import { SCENARIO_LABELS, type ScenarioKind } from "@/lib/simulation";

const FEATURES: { key: string; label: string; deltas: number[] }[] = [
  { key: "rsi14", label: "RSI(14)", deltas: [-15, -10, -5, -2, 0, 2, 5, 10, 15] },
  { key: "atrPct", label: "ATR %", deltas: [-1.5, -1, -0.5, -0.2, 0, 0.2, 0.5, 1, 1.5] },
  { key: "dd60", label: "Drawdown 60d", deltas: [-15, -10, -5, -2, 0, 2, 5, 10, 15] },
  { key: "realizedVol20", label: "Realized vol 20d", deltas: [-15, -10, -5, -2, 0, 2, 5, 10, 15] },
  { key: "rsVsSpy60", label: "Relative strength vs SPY 60d", deltas: [-15, -10, -5, -2, 0, 2, 5, 10, 15] },
  { key: "distSma200", label: "Dist SMA200 %", deltas: [-15, -10, -5, -2, 0, 2, 5, 10, 15] },
  { key: "corrVsSpy60", label: "Corr vs SPY 60d", deltas: [-0.5, -0.3, -0.1, 0, 0.1, 0.3, 0.5] },
  { key: "ret20", label: "20-day return %", deltas: [-15, -10, -5, -2, 0, 2, 5, 10, 15] },
];

export function SensitivityPanel() {
  const run = useServerFn(runSensitivity);
  const [feature, setFeature] = useState(FEATURES[0].key);
  const [scenario, setScenario] = useState<ScenarioKind>("recovery");
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<SensitivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = async () => {
    setBusy(true); setError(null); setResp(null);
    try {
      const cfg = FEATURES.find((f) => f.key === feature)!;
      const r = await run({
        data: { scenario, seed: 42, length: 900, symbolLabel: "SANDBOX", feature: cfg.key as never, deltas: cfg.deltas },
      });
      setResp(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-3">
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">Scenario</span>
            <select value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioKind)} className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100">
              {(Object.keys(SCENARIO_LABELS) as ScenarioKind[]).filter((k) => k !== "custom").map((k) => (
                <option key={k} value={k}>{SCENARIO_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">Feature to perturb</span>
            <select value={feature} onChange={(e) => setFeature(e.target.value)} className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100">
              {FEATURES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <button onClick={execute} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sliders className="h-4 w-4" />}
            {busy ? "Perturbing…" : "Run sensitivity sweep"}
          </button>
          {error && <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-200"><AlertTriangle className="h-3.5 w-3.5" />{error}</span>}
        </div>
      </div>

      {resp && (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            Base {resp.feature} = {resp.baseValue.toFixed(2)} · monotone score {resp.smoothness.monotoneScore} · sim TV {resp.smoothness.similarityTotalVariation} · conf TV {resp.smoothness.confidenceTotalVariation} · analog switches {resp.smoothness.analogSwitchesUnderPerturbation}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400"><tr>
                <th className="px-2 py-1">Δ</th><th className="px-2 py-1">value</th><th className="px-2 py-1">similarity</th><th className="px-2 py-1">confidence</th><th className="px-2 py-1">phase</th><th className="px-2 py-1">analog</th>
              </tr></thead>
              <tbody>{resp.points.map((p, i) => (
                <tr key={i} className="border-t border-slate-800/60">
                  <td className="px-2 py-1 font-mono">{p.delta > 0 ? `+${p.delta}` : p.delta}</td>
                  <td className="px-2 py-1 font-mono">{p.perturbedValue.toFixed(2)}</td>
                  <td className="px-2 py-1 font-mono">{p.similarity !== null ? `${p.similarity}%` : "—"}</td>
                  <td className="px-2 py-1 font-mono">{p.confidenceOverall !== null ? `${p.confidenceOverall.toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-1">{p.marketPhase ?? "—"}</td>
                  <td className="px-2 py-1 truncate max-w-[240px] font-mono text-[10px] text-slate-400">{p.analogKey ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {resp.warnings.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
              {resp.warnings.map((w, i) => <div key={i}>• {w}</div>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
