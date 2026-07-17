// Crystal — Momentum Rockets scanner (vertical light-ray timeline).
// Reuses ["momentum-rockets-latest"] query cache.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Search, Shield, X, Flame } from "lucide-react";
import { toast } from "sonner";
import {
  getLatestMomentumRockets,
  runMomentumRocketsScan,
  type RocketRow,
} from "@/lib/momentum-rockets/scan.functions";
import { CrystalRoot } from "./CrystalRoot";
import {
  CrystalSlab,
  CrystalPane,
  CrystalPill,
  CrystalOrb,
  MicroLabel,
  Serif,
  StatNum,
  ProgressArc,
  ScoreRay,
} from "./primitives";
import { riseDelay } from "./motion";

export function CrystalMomentumRockets() {
  const qc = useQueryClient();
  const fetchLatest = useServerFn(getLatestMomentumRockets);
  const runScan = useServerFn(runMomentumRocketsScan);
  const { data, isLoading, error } = useQuery({
    queryKey: ["momentum-rockets-latest"],
    queryFn: () => fetchLatest(),
    refetchInterval: 60_000,
  });
  const scan = useMutation({
    mutationFn: () => runScan({ data: { aiTopN: 15 } }),
    onSuccess: (r) => {
      toast.success(`Scan complete — ${r.ranked} ranked, ${r.failed} failed`);
      qc.invalidateQueries({ queryKey: ["momentum-rockets-latest"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const [minC, setMinC] = useState(0);
  const [minConf, setMinConf] = useState(0);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<RocketRow | null>(null);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    const s = q.trim().toUpperCase();
    return data.rows.filter(
      (r) =>
        r.composite >= minC &&
        r.confidence >= minConf &&
        (s === "" || r.symbol.includes(s) || r.name.toUpperCase().includes(s)),
    );
  }, [data, minC, minConf, q]);

  return (
    <CrystalRoot>
      <div className="mx-auto max-w-6xl px-4 pb-40 pt-10 sm:pt-16">
        <header className="mb-10 flex flex-wrap items-start justify-between gap-6 cr-rise">
          <div className="max-w-2xl">
            <MicroLabel>Momentum Rockets · Short-horizon</MicroLabel>
            <Serif className="mt-3 block text-4xl leading-[0.95] sm:text-5xl text-white">
              Small-caps launching, caught mid-arc.
            </Serif>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/60">
              Days-to-weeks setups tuned for small-cap and lower-liquidity names
              showing active breakout, momentum, and volume-surge fingerprints.
            </p>
          </div>
          <CrystalOrb
            label={scan.isPending ? "Scanning" : "Rescan"}
            size={52}
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
          >
            <RefreshCw className={`h-4 w-4 ${scan.isPending ? "animate-spin" : ""}`} />
          </CrystalOrb>
        </header>

        {data && (
          <div className="mb-8 flex flex-wrap items-center gap-2 cr-rise" style={{ animationDelay: "80ms" }}>
            <CrystalPill active>Regime · {data.regime}</CrystalPill>
            <CrystalPill ghost>
              Eligible · {data.eligibleSize}/{data.universeSize}
            </CrystalPill>
            <CrystalPill ghost>
              SPY ·{" "}
              {data.spyChangePct != null
                ? `${data.spyChangePct >= 0 ? "+" : ""}${data.spyChangePct.toFixed(2)}%`
                : "—"}
            </CrystalPill>
            <CrystalPill ghost>
              Showing {rows.length} of {data.rows.length}
            </CrystalPill>
          </div>
        )}

        <CrystalSlab rise className="mb-10 flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <label className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.07] px-4 py-2 text-sm">
            <Search className="h-4 w-4 text-white/50" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Symbol or name…"
              className="bg-transparent text-sm text-white placeholder:text-white/40 outline-none"
              style={{ width: 160 }}
            />
          </label>
          <NumField label="Min composite" value={minC} onChange={setMinC} />
          <NumField label="Min confidence" value={minConf} onChange={setMinConf} />
        </CrystalSlab>

        {isLoading && !data && (
          <CrystalSlab className="p-12 text-center text-white/60">Loading latest scan…</CrystalSlab>
        )}
        {error && (
          <CrystalSlab className="p-5 text-sm" style={{ color: "#fecaca" }}>
            {error instanceof Error ? error.message : "Failed to load."}
          </CrystalSlab>
        )}

        {rows.length > 0 && (
          <div className="relative pl-10 sm:pl-16">
            {/* Vertical light ray */}
            <div
              className="pointer-events-none absolute bottom-4 left-4 top-2 w-px origin-top sm:left-8"
              style={{
                background:
                  "linear-gradient(180deg, rgba(103,232,249,0.7), rgba(94,234,212,0.5) 45%, rgba(103,232,249,0.15))",
                boxShadow: "0 0 12px rgba(103,232,249,0.5)",
                animation: "crRayGrow 900ms cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            />
            <div className="space-y-6">
              {rows.map((r, i) => (
                <TimelineNode
                  key={r.symbol}
                  row={r}
                  onOpen={() => setSelected(r)}
                  index={i}
                  style={riseDelay(i, 70)}
                />
              ))}
            </div>
          </div>
        )}

        {selected && <RocketDetail row={selected} onClose={() => setSelected(null)} />}
      </div>
    </CrystalRoot>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={0}
        max={100}
        step={5}
        className="mt-1 w-24 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-sm tabular-nums text-white outline-none focus:border-amber-300/50"
      />
    </div>
  );
}

function TimelineNode({
  row,
  onOpen,
  index,
  style,
}: {
  row: RocketRow;
  onOpen: () => void;
  index: number;
  style?: React.CSSProperties;
}) {
  const tone =
    row.confidence >= 70 ? "#a7f3d0" : row.confidence >= 50 ? "#fbbf24" : "#fb7185";
  const alignRight = index % 2 === 1;
  return (
    <div className="relative cr-rise" style={style}>
      {/* Node dot */}
      <span
        className="absolute top-6 -left-[26px] grid h-3 w-3 place-items-center rounded-full sm:-left-[42px]"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), rgba(103,232,249,0.65) 55%, transparent 100%)",
          boxShadow: "0 0 14px rgba(103,232,249,0.6)",
        }}
      />
      <div className={alignRight ? "sm:ml-auto sm:max-w-[85%]" : "sm:max-w-[85%]"}>
        <CrystalSlab
          hoverable
          className="cursor-pointer p-5"
          onClick={onOpen}
        >
          <div className="flex items-center gap-4">
            <ProgressArc value={row.composite} tone="#fbbf24" size={48} label={row.composite.toFixed(0)} />
            <div className="min-w-0 flex-1">
              <MicroLabel>Rank #{row.rank} · {row.sector}</MicroLabel>
              <div className="mt-1 flex items-baseline gap-2">
                <Serif className="text-2xl text-white leading-none">{row.symbol}</Serif>
                <span className="truncate text-[11px] text-white/50">{row.name}</span>
              </div>
            </div>
            <span
              className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[10px]"
              style={{ color: tone }}
            >
              <Shield className="h-3 w-3" /> {row.confidence.toFixed(0)}
            </span>
          </div>
          <div className="mt-4 grid gap-1.5 sm:grid-cols-2 sm:gap-x-6">
            <ScoreRay label="Break" value={row.components.breakout} tone="#fbbf24" />
            <ScoreRay label="Mom" value={row.components.momentum} tone="#fb923c" />
            <ScoreRay label="Vol" value={row.components.volumeSurge} tone="#f97316" />
            <ScoreRay label="Fuel" value={row.components.volatilityFuel} tone="#fde68a" />
          </div>
        </CrystalSlab>
      </div>
    </div>
  );
}

function RocketDetail({ row, onClose }: { row: RocketRow; onClose: () => void }) {
  const sections: Array<[string, string[]]> = [
    ["Breakout", row.reasons.breakout],
    ["Momentum", row.reasons.momentum],
    ["Volume surge", row.reasons.volumeSurge],
    ["Volatility fuel", row.reasons.volatilityFuel],
    ["Risk guardrails", row.reasons.risk],
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-md sm:items-center"
      onClick={onClose}
    >
      <CrystalSlab
        rise
        className="relative max-h-[88vh] w-full max-w-3xl overflow-y-auto p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-white/12 text-white/60 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <MicroLabel>Rank #{row.rank} · {row.sector}</MicroLabel>
        <div className="mt-2 flex items-baseline gap-3">
          <Serif className="text-5xl text-white leading-[0.9]">{row.symbol}</Serif>
          <StatNum className="text-lg text-white/50">{row.name}</StatNum>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <CrystalPill active>Composite {row.composite.toFixed(1)}</CrystalPill>
          <CrystalPill ghost>Confidence {row.confidence.toFixed(0)}</CrystalPill>
          <CrystalPill ghost>Price {row.features.price.toFixed(2)}</CrystalPill>
        </div>

        {row.aiThesis && (
          <CrystalPane className="mt-6 p-5">
            <div className="mb-2 flex items-center gap-2">
              <Flame className="h-3 w-3 text-orange-300" />
              <MicroLabel>AI Thesis</MicroLabel>
            </div>
            <p className="text-sm leading-relaxed text-white/80">
              {row.aiThesis.thesis}
            </p>
          </CrystalPane>
        )}

        <div className="mt-6 space-y-4">
          {sections.map(([title, list]) =>
            list.length ? (
              <section key={title}>
                <MicroLabel>{title}</MicroLabel>
                <ul className="mt-2 space-y-1.5">
                  {list.map((r, i) => (
                    <CrystalPane key={i} className="px-3.5 py-2 text-xs text-white/80">
                      {r}
                    </CrystalPane>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      </CrystalSlab>
    </div>
  );
}
