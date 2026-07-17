import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getLatestMomentumRockets, runMomentumRocketsScan, type RocketRow } from "@/lib/momentum-rockets/scan.functions";
import { TopMenu } from "@/components/TopMenu";
import { Rocket, RefreshCw, Info, X, Shield, ChevronRight, Home, Flame } from "lucide-react";
import { toast } from "sonner";

import { useLiquidGlass } from "@/lib/liquid-glass";
import { CrystalMomentumRockets } from "@/crystal/CrystalMomentumRockets";

function MomentumRocketsRouteSwitch() {
  const { enabled } = useLiquidGlass();
  return enabled ? <CrystalMomentumRockets /> : <MomentumRocketsPage />;
}

export const Route = createFileRoute("/_authenticated/momentum-rockets")({
  head: () => ({
    meta: [
      { title: "Momentum Rockets · Laddrx" },
      { name: "description", content: "Short-horizon scanner for small-cap and lower-liquidity names showing active breakout, momentum, and volume-surge fingerprints right now." },
      { property: "og:title", content: "Momentum Rockets · Laddrx" },
      { property: "og:description", content: "Small-cap, high-momentum companion to the Future Leaders scanner." },
    ],
  }),
  component: MomentumRocketsRouteSwitch,
});


function ScoreBar({ label, value, tone = "amber" }: { label: string; value: number; tone?: "cyan" | "emerald" | "amber" | "fuchsia" | "rose" | "orange" }) {
  const tones: Record<string, string> = {
    cyan: "from-cyan-400 to-cyan-500",
    emerald: "from-emerald-400 to-emerald-500",
    amber: "from-amber-400 to-amber-500",
    fuchsia: "from-fuchsia-400 to-fuchsia-500",
    rose: "from-rose-400 to-rose-500",
    orange: "from-orange-400 to-orange-500",
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

function RowDetail({ row, onClose }: { row: RocketRow; onClose: () => void }) {
  const f = row.features;
  const fmt = (n: number | null | undefined, digits = 1, suffix = "") =>
    n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}${suffix}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl sm:rounded-2xl">
        <button onClick={onClose} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:border-amber-400/40 hover:text-amber-100">
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">Rank #{row.rank} · {row.sector}</div>
          <h2 className="mt-1 text-2xl font-black text-slate-50">{row.symbol} <span className="text-base font-normal text-slate-400">— {row.name}</span></h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-xs text-amber-200">Composite {row.composite.toFixed(1)}</span>
            <ConfidenceChip value={row.confidence} />
          </div>
        </div>

        {row.aiThesis ? (
          <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-orange-300"><Flame className="h-3 w-3" /> AI Thesis (short-horizon)</div>
            <p className="text-sm leading-relaxed text-slate-200">{row.aiThesis.thesis}</p>
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
            {row.aiThesis.invalidation?.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-rose-300">Invalidation signals</div>
                <ul className="space-y-1 text-xs text-slate-300">{row.aiThesis.invalidation.map((s, i) => <li key={i}>• {s}</li>)}</ul>
              </div>
            )}
            {row.aiThesis.watchFor?.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-amber-300">Watch for</div>
                <ul className="space-y-1 text-xs text-slate-300">{row.aiThesis.watchFor.map((s, i) => <li key={i}>• {s}</li>)}</ul>
              </div>
            )}
            {row.aiThesis.notes && (
              <p className="mt-3 text-[10px] italic text-slate-500">{row.aiThesis.notes}</p>
            )}
          </section>
        ) : (
          <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400">
            AI thesis not generated for this rank (only the top 15 receive AI synthesis per scan to conserve gateway credits).
          </div>
        )}

        <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Component scores &amp; reasons</div>
          <div className="space-y-3">
            {(["breakout","momentum","volumeSurge","volatilityFuel","risk"] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold capitalize text-slate-200">
                    {k === "volumeSurge" ? "Volume Surge" : k === "volatilityFuel" ? "Volatility Fuel" : k === "risk" ? "Risk (higher = safer)" : k}
                  </span>
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
              ["1m ret", fmt(f.ret1m, 1, "%")],
              ["3m ret", fmt(f.ret3m, 1, "%")],
              ["Off 20d high", fmt(f.distFrom20dHighPct, 1, "%")],
              ["Off 50d high", fmt(f.distFrom50dHighPct, 1, "%")],
              ["Bars since 20d hi", f.barsSince20dHigh != null ? String(f.barsSince20dHigh) : "—"],
              ["Up-days 20", f.upDayRatio20 != null ? `${(f.upDayRatio20 * 100).toFixed(0)}%` : "—"],
              ["Up-days 60", f.upDayRatio60 != null ? `${(f.upDayRatio60 * 100).toFixed(0)}%` : "—"],
              ["Vol ann (20d)", fmt(f.volAnn20, 0, "%")],
              ["Vol ann (60d)", fmt(f.volAnn60, 0, "%")],
              ["Vol thrust 5/60", f.dollarVolThrust5v60 != null ? `${f.dollarVolThrust5v60.toFixed(2)}×` : "—"],
              ["Vol trend 20/1y", f.volumeTrendRatio != null ? `${f.volumeTrendRatio.toFixed(2)}×` : "—"],
              ["$-vol 20d", f.avgDollarVol20 ? `$${(f.avgDollarVol20 / 1e6).toFixed(1)}M` : "—"],
              ["Off 52w high", fmt(f.distFromHigh52wPct, 1, "%")],
              ["Max DD 1y", fmt(f.maxDrawdown1y, 0, "%")],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-slate-800/70 bg-slate-950 px-2 py-1.5">
                <div className="font-mono text-[9px] uppercase tracking-wider text-slate-500">{k}</div>
                <div className="tabular-nums text-slate-200">{v}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function MomentumRocketsPage() {
  const qc = useQueryClient();
  const fetchLatest = useServerFn(getLatestMomentumRockets);
  const runScan = useServerFn(runMomentumRocketsScan);
  const { data, isLoading, error } = useQuery({
    queryKey: ["momentum-rockets-latest"],
    queryFn: () => fetchLatest(),
    refetchInterval: 60_000,
  });
  const mutation = useMutation({
    mutationFn: () => runScan({ data: { aiTopN: 15 } }),
    onSuccess: (r) => { toast.success(`Scan complete — ${r.ranked} ranked, ${r.failed} failed`); qc.invalidateQueries({ queryKey: ["momentum-rockets-latest"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const [selected, setSelected] = useState<RocketRow | null>(null);
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
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
            <Flame className="h-3 w-3" /> Momentum Rockets Scanner
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-50 sm:text-3xl">
            <Rocket className="h-6 w-6 text-amber-300" />
            Small-caps that look like they're launching now
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Short-horizon scanner tuned for small-cap and lower-liquidity names ($20 price or under $30M/day trading, still tradeable with ≥$500k/day). Ranks each eligible ticker by <em>Breakout</em>, <em>Momentum</em>, <em>Volume Surge</em>, <em>Volatility Fuel</em>, and a <em>Risk</em> guardrail. Complementary to the Future Leaders scanner — this is a days-to-weeks setup engine, not a multi-year compounder engine. <span className="text-amber-300">Research framework — not financial advice.</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            {data && (
              <>
                <span className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono">
                  Last scan: {new Date(data.scannedAt).toLocaleString()}
                </span>
                <span className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono uppercase">
                  Regime: {data.regime}
                </span>
                <span className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono">
                  Eligible: {data.eligibleSize} of {data.universeSize}
                </span>
                <span className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono">
                  SPY 1d: {data.spyChangePct != null ? `${data.spyChangePct >= 0 ? "+" : ""}${data.spyChangePct.toFixed(2)}%` : "—"}
                </span>
              </>
            )}
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-400/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${mutation.isPending ? "animate-spin" : ""}`} />
              {mutation.isPending ? "Scanning…" : "Run new scan"}
            </button>
          </div>
        </header>

        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="min-w-[200px] flex-1">
            <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Symbol or name…" className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-400/50" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Min composite</label>
            <input type="number" value={minComposite} onChange={(e) => setMinComposite(Number(e.target.value))} min={0} max={100} step={5} className="mt-1 w-24 rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm tabular-nums text-slate-100 outline-none focus:border-amber-400/50" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Min confidence</label>
            <input type="number" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} min={0} max={100} step={5} className="mt-1 w-24 rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm tabular-nums text-slate-100 outline-none focus:border-amber-400/50" />
          </div>
          <div className="ml-auto text-xs text-slate-500">Showing {rows.length} of {data?.rows.length ?? 0}</div>
        </div>

        {isLoading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-400">Loading latest scan…</div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error instanceof Error ? error.message : "Failed to load rockets."}
          </div>
        )}
        {data === null && !isLoading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
            <Info className="mx-auto mb-3 h-6 w-6 text-amber-300" />
            <div className="text-sm text-slate-300">No rockets scan yet. Click <b>Run new scan</b> to build the first ranking.</div>
            <div className="mt-1 text-xs text-slate-500">Shares the daily bar cache with Future Leaders — if that scanner already ran today, this one will finish in ~1-2 min.</div>
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
                      <span className="rounded-md bg-amber-400/10 px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-amber-200">{r.composite.toFixed(1)}</span>
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell"><ConfidenceChip value={r.confidence} /></td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <div className="space-y-0.5">
                        <ScoreBar label="Brk" value={r.components.breakout} tone="orange" />
                        <ScoreBar label="Mom" value={r.components.momentum} tone="emerald" />
                        <ScoreBar label="Vol$" value={r.components.volumeSurge} tone="cyan" />
                        <ScoreBar label="Fuel" value={r.components.volatilityFuel} tone="fuchsia" />
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
          <b className="text-slate-400">How this works.</b> Every ticker in the universe is first filtered to small-cap / lower-liquidity names ($20 price OR under $30M/day dollar-volume, with ≥$500k/day floor and not left-for-dead). Eligible names are scored by five short-horizon models: <em>Breakout</em> (proximity to 20/50d highs), <em>Momentum</em> (1m/3m returns + up-day persistence), <em>Volume Surge</em> (5d vs 60d dollar-volume thrust), <em>Volatility Fuel</em> (elevated but not blown-out realized vol), and <em>Risk</em> (illiquidity / drawdown / penny-price guardrails; higher = safer). Composite = weighted 0-100. Confidence = min(agreement across models, data completeness). AI thesis (Lovable AI Gateway, Gemini 3 Flash Preview) turns the numbers into a short-term angle for the top rows only.
        </p>
        <p className="mt-2 text-[11px] text-slate-600">
          Every rank is logged so future short-horizon performance can be measured. This is a research framework — never a promise, prediction, or guarantee. <Link to="/" className="text-cyan-400 underline"><Home className="inline h-3 w-3" /> Back to terminal</Link>
        </p>
      </main>

      {selected && <RowDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
