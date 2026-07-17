// Crystal — Future Leaders scanner (asymmetric ranked column + spotlight).
// Reuses ["future-leaders-latest"] query cache.

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Search, Shield } from "lucide-react";
import { toast } from "sonner";
import {
  continueFutureLeadersScan,
  getLatestFutureLeaders,
  startFutureLeadersScan,
  type LeaderRow,
} from "@/lib/future-leaders/scan.functions";
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

export function CrystalFutureLeaders() {
  const qc = useQueryClient();
  const fetchLatest = useServerFn(getLatestFutureLeaders);
  const startScan = useServerFn(startFutureLeadersScan);
  const continueScan = useServerFn(continueFutureLeadersScan);
  const { data, isLoading, error } = useQuery({
    queryKey: ["future-leaders-latest"],
    queryFn: () => fetchLatest(),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2_500 : 60_000),
  });
  const start = useMutation({
    mutationFn: () => startScan({ data: { aiTopN: 15 } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["future-leaders-latest"] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });
  const cont = useMutation({
    mutationFn: (snapshotId: string) => continueScan({ data: { snapshotId, aiTopN: 15 } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["future-leaders-latest"] });
      if (r.status === "completed") toast.success(`Scan complete — ${r.ranked} ranked`);
    },
  });

  useEffect(() => {
    if (data?.status !== "running" || !data.snapshotId || cont.isPending) return;
    const id = window.setTimeout(
      () => cont.mutate(data.snapshotId),
      data.rows.length ? 700 : 100,
    );
    return () => window.clearTimeout(id);
  }, [cont, data?.snapshotId, data?.status, data?.processed, data?.rows.length]);

  const [q, setQ] = useState("");
  const [minC, setMinC] = useState(0);
  const [minConf, setMinConf] = useState(0);
  const [focused, setFocused] = useState<LeaderRow | null>(null);

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

  useEffect(() => {
    if (!focused && rows.length > 0) setFocused(rows[0]);
    if (focused && !rows.find((r) => r.symbol === focused.symbol) && rows.length > 0) {
      setFocused(rows[0]);
    }
  }, [rows, focused]);

  const scanning = start.isPending || data?.status === "running";

  return (
    <CrystalRoot>
      <div className="mx-auto max-w-6xl px-4 pb-40 pt-10 sm:pt-16">
        {/* Header */}
        <header className="mb-10 flex flex-wrap items-start justify-between gap-6 cr-rise">
          <div className="max-w-2xl">
            <MicroLabel>Future Leaders · Compounder Scanner</MicroLabel>
            <Serif className="mt-3 block text-4xl leading-[0.95] sm:text-5xl text-white">
              Tomorrow's compounders, refracted from evidence.
            </Serif>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/60">
              Multi-factor engine ranking names whose price-action fingerprint
              resembles the greatest historical winners. Research framework — not advice.
            </p>
          </div>
          <CrystalOrb
            label={scanning ? "Scanning" : "Rescan"}
            size={52}
            onClick={() => start.mutate()}
            disabled={scanning}
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
          </CrystalOrb>
        </header>

        {/* Status pills */}
        {data && (
          <div className="mb-8 flex flex-wrap items-center gap-2 cr-rise" style={{ animationDelay: "80ms" }}>
            <CrystalPill active>
              {data.status === "running"
                ? `Scanning ${data.processed}/${data.universeSize}`
                : data.status.toUpperCase()}
            </CrystalPill>
            <CrystalPill ghost>Regime · {data.regime}</CrystalPill>
            <CrystalPill ghost>Universe · {data.universeSize}</CrystalPill>
            <CrystalPill ghost>
              Showing {rows.length} of {data.rows.length}
            </CrystalPill>
          </div>
        )}

        {/* Filter bar */}
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

        {/* Two-column asymmetric layout */}
        {rows.length > 0 && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            {/* Left — ranked stack */}
            <div className="space-y-2.5">
              {rows.map((r, i) => (
                <LeaderRow
                  key={r.symbol}
                  row={r}
                  active={focused?.symbol === r.symbol}
                  onFocus={() => setFocused(r)}
                  style={riseDelay(i)}
                />
              ))}
            </div>

            {/* Right — spotlight */}
            <div className="md:sticky md:top-6 md:h-fit">
              {focused && <Spotlight row={focused} />}
            </div>
          </div>
        )}
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
        className="mt-1 w-24 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-sm tabular-nums text-white outline-none focus:border-cyan-300/50"
      />
    </div>
  );
}

function LeaderRow({
  row,
  active,
  onFocus,
  style,
}: {
  row: LeaderRow;
  active: boolean;
  onFocus: () => void;
  style?: React.CSSProperties;
}) {
  const tone =
    row.confidence >= 70 ? "#a7f3d0" : row.confidence >= 50 ? "#fbbf24" : "#fb7185";
  return (
    <button
      type="button"
      onClick={onFocus}
      className={`cr-slab cr-hoverable w-full text-left px-5 py-4 cr-rise transition ${
        active ? "!border-cyan-300/40" : ""
      }`}
      style={{
        ...style,
        borderRadius: 24,
        boxShadow: active
          ? "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.28), 0 0 0 1px rgba(103,232,249,0.35), 0 30px 80px -20px rgba(103,232,249,0.35)"
          : undefined,
      }}
    >
      <div className="flex items-center gap-4">
        <ProgressArc
          value={row.composite}
          tone={active ? "#a7f3d0" : "#67e8f9"}
          size={44}
          label={row.composite.toFixed(0)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Serif className="text-xl text-white leading-none">{row.symbol}</Serif>
            <MicroLabel>#{row.rank}</MicroLabel>
          </div>
          <div className="mt-1 truncate text-[11px] text-white/50">
            {row.name} · {row.sector}
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[10px]"
          style={{ color: tone }}
        >
          <Shield className="h-3 w-3" /> {row.confidence.toFixed(0)}
        </span>
      </div>
    </button>
  );
}

function Spotlight({ row }: { row: LeaderRow }) {
  const c = row.components;
  const bars: Array<[string, number, string]> = [
    ["Historical", c.historical, "#67e8f9"],
    ["Momentum", c.momentum, "#5eead4"],
    ["Quality", c.quality, "#a7f3d0"],
    ["Rel Strength", c.relativeStrength, "#818cf8"],
    ["Risk", c.risk, "#fbbf24"],
  ];
  const sections: Array<[string, string[]]> = [
    ["Historical fingerprint", row.reasons.historical],
    ["Momentum", row.reasons.momentum],
    ["Quality", row.reasons.quality],
    ["Relative strength", row.reasons.relativeStrength],
    ["Risk guardrails", row.reasons.risk],
  ];
  return (
    <CrystalSlab rise className="p-6 sm:p-8">
      <MicroLabel>Spotlight · Rank #{row.rank}</MicroLabel>
      <div className="mt-3 flex items-baseline gap-4">
        <Serif className="text-5xl sm:text-6xl text-white leading-[0.9]">{row.symbol}</Serif>
        <StatNum className="text-2xl text-white/50">
          {row.composite.toFixed(1)}
        </StatNum>
      </div>
      <p className="mt-2 text-sm text-white/60">
        {row.name} · {row.sector}
      </p>

      <div className="mt-6 grid gap-2.5">
        {bars.map(([label, val, tone]) => (
          <ScoreRay key={label} label={label} value={val} tone={tone} />
        ))}
      </div>

      <div className="mt-8 space-y-4">
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
  );
}
