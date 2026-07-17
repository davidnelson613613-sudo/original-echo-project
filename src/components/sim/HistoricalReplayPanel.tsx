import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Play, Pause, SkipForward, ShieldCheck, AlertTriangle, Activity } from "lucide-react";
import { runHistoricalReplay, type ReplayResponse, type ReplayStep } from "@/lib/simulation.functions";

export type ReplayRunMeta = {
  id: string;
  symbol: string;
  startOffsetFromEnd: number;
  steps: number;
  stride: number;
  response: ReplayResponse;
  ranAt: number;
};

type Props = {
  onRunComplete?: (run: ReplayRunMeta) => void;
};

export function HistoricalReplayPanel({ onRunComplete }: Props) {
  const run = useServerFn(runHistoricalReplay);
  const [symbol, setSymbol] = useState("SMH");
  const [startOffset, setStartOffset] = useState(400);
  const [steps, setSteps] = useState(80);
  const [stride, setStride] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<ReplayResponse | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(500);
  const playRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (playRef.current) clearTimeout(playRef.current); }, []);

  useEffect(() => {
    if (!playing || !resp) return;
    if (cursor >= resp.steps.length - 1) { setPlaying(false); return; }
    playRef.current = setTimeout(() => setCursor((c) => Math.min(c + 1, resp.steps.length - 1)), speedMs);
    return () => { if (playRef.current) clearTimeout(playRef.current); };
  }, [playing, cursor, resp, speedMs]);

  const execute = async () => {
    setBusy(true);
    setError(null);
    setResp(null);
    setPlaying(false);
    setCursor(0);
    try {
      const r = await run({
        data: { symbol: symbol.trim().toUpperCase(), startOffsetFromEnd: startOffset, steps, stride },
      });
      setResp(r);
      setCursor(0);
      onRunComplete?.({
        id: `${r.symbol}-${Date.now()}`,
        symbol: r.symbol,
        startOffsetFromEnd: startOffset,
        steps,
        stride,
        response: r,
        ranAt: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const currentStep: ReplayStep | null = resp?.steps[cursor] ?? null;

  return (
    <section className="grid gap-3">
      <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-emerald-200">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="text-xs leading-relaxed">
          <div className="font-semibold text-emerald-100">Historical replay — no look-ahead</div>
          Real bars are fetched read-only. At each step the scanner only sees bars up to that date; forward outcomes are compared afterwards. Nothing is written to production caches, watchlists, alerts, or analytics.
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Symbol">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm font-mono text-slate-100 uppercase" />
        </Field>
        <Field label="Start offset from end (bars)">
          <input type="number" value={startOffset} min={60} max={2500} onChange={(e) => setStartOffset(clamp(60, 2500, +e.target.value))} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100" />
        </Field>
        <Field label="Steps">
          <input type="number" value={steps} min={1} max={300} onChange={(e) => setSteps(clamp(1, 300, +e.target.value))} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100" />
        </Field>
        <Field label="Stride (bars/step)">
          <input type="number" value={stride} min={1} max={20} onChange={(e) => setStride(clamp(1, 20, +e.target.value))} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-slate-100" />
        </Field>
        <div className="col-span-full flex flex-wrap items-center gap-2">
          <button onClick={execute} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            {busy ? "Fetching & replaying…" : "Run historical replay"}
          </button>
          {error && <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-200"><AlertTriangle className="h-3.5 w-3.5" />{error}</span>}
        </div>
      </div>

      {resp && (
        <>
          <ReplayScrubber
            resp={resp}
            cursor={cursor}
            playing={playing}
            speedMs={speedMs}
            setCursor={setCursor}
            setPlaying={setPlaying}
            setSpeedMs={setSpeedMs}
          />
          {currentStep && <StepDetail step={currentStep} prev={cursor > 0 ? resp.steps[cursor - 1] : null} />}
          <StabilityAudit resp={resp} />
          <AccuracySummary resp={resp} />
          <FeatureCoverage resp={resp} />
          <ReplayTimeline resp={resp} />
        </>
      )}
    </section>
  );
}

function ReplayScrubber({ resp, cursor, playing, speedMs, setCursor, setPlaying, setSpeedMs }: {
  resp: ReplayResponse; cursor: number; playing: boolean; speedMs: number;
  setCursor: (n: number) => void; setPlaying: (b: boolean) => void; setSpeedMs: (n: number) => void;
}) {
  const st = resp.steps[cursor];
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setPlaying(!playing)} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20">
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? "Pause" : "Play"}
        </button>
        <button onClick={() => setCursor(Math.min(cursor + 1, resp.steps.length - 1))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600">
          <SkipForward className="h-3.5 w-3.5" /> Step
        </button>
        <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">
          speed
          <select value={speedMs} onChange={(e) => setSpeedMs(+e.target.value)} className="ml-2 rounded border border-slate-800 bg-slate-950 px-1 py-0.5 text-xs text-slate-200">
            <option value={100}>fast</option>
            <option value={300}>quick</option>
            <option value={500}>medium</option>
            <option value={900}>slow</option>
          </select>
        </label>
        <div className="ml-auto font-mono text-[11px] text-slate-400">
          step {cursor + 1}/{resp.steps.length} · {st?.date ?? "—"} · ${st?.price.toFixed(2) ?? "—"}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={resp.steps.length - 1}
        value={cursor}
        onChange={(e) => setCursor(+e.target.value)}
        className="mt-3 w-full accent-cyan-400"
      />
      <div className="mt-1 flex justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">
        <span>{resp.steps[0]?.date}</span><span>{resp.steps[resp.steps.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function StepDetail({ step, prev }: { step: ReplayStep; prev: ReplayStep | null }) {
  const changed = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null || b == null) return "";
    const d = a - b;
    if (Math.abs(d) < 0.05) return "";
    return d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
  };
  return (
    <div className="grid gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 lg:grid-cols-3">
      <div>
        <SectionTitle>Scanner output</SectionTitle>
        <KV k="Analog" v={step.hasResult ? `${step.bestSymbol} ${step.bestAnalogDate}` : "—"} />
        <KV k="Similarity" v={step.similarity !== null ? `${step.similarity}% ${changed(step.similarity, prev?.similarity ?? null)}` : "—"} />
        <KV k="Phase" v={step.marketPhase ?? "—"} />
        <KV k="Confidence" v={step.confidenceOverall !== null ? `${step.confidenceOverall.toFixed(1)}% ${changed(step.confidenceOverall, prev?.confidenceOverall ?? null)}` : "—"} />
        <KV k="Prob bottom" v={step.probBottomIn !== null ? `${step.probBottomIn.toFixed(1)}%` : "—"} />
        <KV k="Prob reversal" v={step.probReversal !== null ? `${step.probReversal.toFixed(1)}%` : "—"} />
        <KV k="Prob cont↓" v={step.probContinuedDecline !== null ? `${step.probContinuedDecline.toFixed(1)}%` : "—"} />
      </div>
      <div>
        <SectionTitle>Feature contribution</SectionTitle>
        {step.topFeatures.map((f, i) => (
          <KV key={i} k={`+ ${f.label}`} v={`Δ${f.delta.toFixed(2)} · +${f.score.toFixed(1)}`} />
        ))}
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-rose-300">Weakest</div>
        {step.weakFeatures.map((f, i) => (
          <KV key={i} k={`− ${f.label}`} v={`Δ${f.delta.toFixed(2)} · ${f.score.toFixed(1)}`} />
        ))}
      </div>
      <div>
        <SectionTitle>Analog stability</SectionTitle>
        {step.analogSwitched ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
            <div className="font-semibold text-amber-100">Analog switched</div>
            {step.switchReason ?? "reason unknown"}
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] text-emerald-200">
            Analog stable — no switch at this step.
          </div>
        )}
        <div className="mt-2">
          <SectionTitle>Realized vs predicted</SectionTitle>
          <KV k="Mean fwd30 (predicted)" v={step.meanFwd30 !== null ? `${step.meanFwd30.toFixed(2)}%` : "—"} />
          <KV k="Actual fwd30" v={step.actualFwd30 !== null ? `${step.actualFwd30.toFixed(2)}%` : "—"} />
          <KV k="Signed error" v={step.fwd30Error !== null ? `${step.fwd30Error.toFixed(2)}pp` : "—"} />
          <KV k="Direction correct?" v={step.directionCorrect === null ? "—" : step.directionCorrect ? "yes" : "no"} />
        </div>
      </div>
    </div>
  );
}

function StabilityAudit({ resp }: { resp: ReplayResponse }) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <SectionTitle>Analog stability audit</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-4">
        <KV k="Total steps" v={String(resp.stability.totalSteps)} />
        <KV k="Switches" v={String(resp.stability.analogSwitches)} />
        <KV k="Switch rate" v={`${(resp.stability.switchRate * 100).toFixed(1)}%`} />
        <KV k="Longest stable run" v={String(resp.stability.longestStableRun)} />
      </div>
      {resp.stability.unstableFlags.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">
            Unnecessary / regressive switches ({resp.stability.unstableFlags.length})
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
            {resp.stability.unstableFlags.map((f, i) => (
              <div key={i}>• {f.fromDate} → {f.toDate}: {f.reason}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccuracySummary({ resp }: { resp: ReplayResponse }) {
  const a = resp.accuracy;
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <SectionTitle>Prediction accuracy (no look-ahead)</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KV k="Steps with analog" v={`${a.stepsWithResult}/${resp.stability.totalSteps}`} />
        <KV k="Steps w/ realized fwd30" v={String(a.stepsWithActuals)} />
        <KV k="Mean |fwd30 err|" v={a.meanAbsFwd30Error !== null ? `${a.meanAbsFwd30Error}pp` : "—"} />
        <KV k="Mean |fwd90 err|" v={a.meanAbsFwd90Error !== null ? `${a.meanAbsFwd90Error}pp` : "—"} />
        <KV k="Fwd30 direction acc" v={a.fwd30DirectionAccuracy !== null ? `${(a.fwd30DirectionAccuracy * 100).toFixed(1)}%` : "—"} />
        <KV k="Mean similarity" v={`${a.meanSimilarity}%`} />
        <KV k="Mean confidence" v={`${a.meanConfidence}%`} />
        <KV k="Total time" v={`${resp.timings.totalMs} ms`} />
      </div>
    </div>
  );
}

function FeatureCoverage({ resp }: { resp: ReplayResponse }) {
  const entries = Object.entries(resp.featureCoverage.featuresObservedInBestMatches)
    .sort((a, b) => b[1].hits - a[1].hits);
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <SectionTitle>Feature contribution across replay</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-400"><tr>
            <th className="px-2 py-1">Feature</th><th className="px-2 py-1">Hits</th><th className="px-2 py-1">Mean score</th><th className="px-2 py-1">Mean |Δ|</th>
          </tr></thead>
          <tbody>{entries.map(([k, v]) => (
            <tr key={k} className="border-t border-slate-800/60">
              <td className="px-2 py-1">{k}</td><td className="px-2 py-1">{v.hits}</td>
              <td className="px-2 py-1">{v.meanScore}</td><td className="px-2 py-1">{v.meanDelta}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {resp.featureCoverage.dominantFeatures.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-300">
          Dominant features (may be over-weighting): {resp.featureCoverage.dominantFeatures.join(", ")}
        </div>
      )}
      {resp.featureCoverage.zeroInfluenceFeatures.length > 0 && (
        <div className="mt-1 text-[11px] text-rose-300">
          Zero-influence features detected: {resp.featureCoverage.zeroInfluenceFeatures.join(", ")}
        </div>
      )}
    </div>
  );
}

function ReplayTimeline({ resp }: { resp: ReplayResponse }) {
  const data = resp.steps;
  const w = 820, h = 220, pad = 18;
  const closes = data.map((d) => d.price);
  const confs = data.map((d) => d.confidenceOverall ?? 0);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const span = Math.max(1e-9, hi - lo);
  const priceLine = data.map((d, i) => {
    const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((d.price - lo) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const confLine = confs.map((c, i) => {
    const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
    const y = h - pad - (c / 100) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <SectionTitle>Timeline — price (cyan) & confidence (fuchsia). ▼ = analog switch</SectionTitle>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <polyline points={priceLine} fill="none" stroke="rgb(103 232 249)" strokeWidth="1.5" />
        <polyline points={confLine} fill="none" stroke="rgb(232 121 249)" strokeWidth="1" strokeDasharray="3 3" />
        {data.map((d, i) => {
          if (!d.analogSwitched) return null;
          const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
          const color = d.switchReason?.startsWith("material_upgrade") ? "rgb(34 197 94)" : "rgb(251 191 36)";
          return <polygon key={i} points={`${x},4 ${x - 4},12 ${x + 4},12`} fill={color} />;
        })}
      </svg>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-300">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{children}</div>;
}
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-xs">
      <span className="text-slate-400">{k}</span>
      <span className="font-mono text-slate-100">{v}</span>
    </div>
  );
}
function clamp(min: number, max: number, v: number) { return Math.min(max, Math.max(min, v || 0)); }
