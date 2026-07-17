// Crystal Terminal — home / scan surface.
// Reuses ["scan"] query cache with classic mode, no extra network.
// Layout has zero shared DNA with the deleted GlassTerminal.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  RefreshCw,
  Search,
  AlertTriangle,
  ArrowUpRight,
  Waves,
} from "lucide-react";
import { scanUniverse, type ScanRow, type ScanResult } from "@/lib/market.functions";
import { readCachedScan, writeCachedScan } from "@/lib/scan-cache";
import { CrystalRoot } from "./CrystalRoot";
import {
  CrystalSlab,
  CrystalPane,
  CrystalPill,
  CrystalOrb,
  CrystalSegmented,
  MicroLabel,
  StatNum,
  Serif,
} from "./primitives";
import { riseDelay } from "./motion";

type Filter = "all" | "falling" | "green";

const REGIME_TONE: Record<string, { color: string; label: string }> = {
  NO_DIP:          { color: "#5eead4", label: "Steady" },
  FAKE_OUT:        { color: "#a7f3d0", label: "Fake-out" },
  FAST_CRASH:      { color: "#fb7185", label: "Fast crash" },
  SLOW_BLEED:      { color: "#fbbf24", label: "Slow bleed" },
  V_BOUNCE_LIKELY: { color: "#67e8f9", label: "V-bounce" },
  SUPPORT_TEST:    { color: "#818cf8", label: "Support test" },
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

export function CrystalTerminal() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const cached = readCachedScan();
  const scan = useQuery<ScanResult, Error>({
    queryKey: ["scan"],
    queryFn: () => scanUniverse(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.savedAt,
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const rows = scan.data?.rows ?? [];
  const spy = scan.data?.spyChangePct ?? null;
  const isDip = (r: ScanRow) => r.regime !== "NO_DIP" && r.change1d <= -1.2;

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === "falling") list = list.filter(isDip);
    else if (filter === "green") list = list.filter((r) => !isDip(r));
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      list = list.filter((r) => r.symbol.includes(q) || r.name?.toUpperCase().includes(q));
    }
    return list;
  }, [rows, filter, query]);

  const rescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      const fresh = await scanUniverse({ data: { force: true } });
      queryClient.setQueryData(["scan"], fresh);
      writeCachedScan(fresh);
      toast.success(`Rescan complete · ${fresh.rows.length} names`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  };

  const spyTone =
    spy == null ? "#67e8f9" : spy >= 0.3 ? "#5eead4" : spy <= -0.3 ? "#fb7185" : "#a7f3d0";

  return (
    <CrystalRoot>
      <div className="mx-auto max-w-6xl px-4 pb-40 pt-10 sm:pt-16">
        {/* Hero — SPY regime orb + oversized change numeral */}
        <section className="mb-14 grid gap-8 sm:mb-20 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex justify-center sm:justify-start cr-rise">
            <div className="relative cr-float">
              <div
                className="relative grid h-40 w-40 place-items-center rounded-full cr-halo"
                style={{
                  background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.42), ${spyTone}55 42%, rgba(3,22,40,0.55) 100%)`,
                  border: "1px solid rgba(255,255,255,0.24)",
                  color: spyTone,
                }}
                aria-label="SPY regime orb"
              >
                <div className="text-center">
                  <MicroLabel>SPY</MicroLabel>
                  <div className="cr-serif mt-1 text-2xl text-white">
                    {spy == null ? "—" : pct(spy, 2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="min-w-0 cr-rise" style={{ animationDelay: "80ms" }}>
            <MicroLabel>Laddrx · Crystal Terminal</MicroLabel>
            <Serif className="mt-3 block text-4xl leading-[0.95] sm:text-6xl text-white">
              The market, softly refracted.
            </Serif>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-white/65">
              Every ladder, every regime, every dip — surfacing as it happens.
              Same scanner underneath, sculpted into transparent layers above.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <CrystalPill active={scan.data != null && !scan.isError}>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: spyTone, boxShadow: `0 0 8px ${spyTone}` }}
                />
                {scan.isError ? "Feed error" : scan.data ? "Live" : "Waking"}
              </CrystalPill>
              <CrystalPill ghost>
                <StatNum>{rows.length}</StatNum>&nbsp;names tracked
              </CrystalPill>
            </div>
          </div>
        </section>

        {/* Filter + search — arc segmented above the row column */}
        <section className="mb-10 flex flex-wrap items-center justify-between gap-4 cr-rise" style={{ animationDelay: "160ms" }}>
          <CrystalSegmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All · ${rows.length}` },
              { value: "falling", label: `Falling · ${rows.filter(isDip).length}` },
              { value: "green", label: `Steady · ${rows.filter((r) => !isDip(r)).length}` },
            ]}
          />
          <label
            className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.09] px-4 py-2.5 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur"
            style={{ minWidth: 240 }}
          >
            <Search className="h-4 w-4 text-white/50" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol…"
              className="w-full bg-transparent text-sm text-white placeholder:text-white/40 outline-none"
            />
          </label>
        </section>

        {/* Row column */}
        {scan.isLoading && rows.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <CrystalSlab key={i} className="h-24 opacity-40 animate-pulse" />
            ))}
          </div>
        ) : scan.isError ? (
          <CrystalSlab className="p-8">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertTriangle className="h-4 w-4" />
              <MicroLabel>Scan failed</MicroLabel>
            </div>
            <p className="mt-3 text-sm text-white/70">{scan.error?.message}</p>
          </CrystalSlab>
        ) : filtered.length === 0 ? (
          <CrystalSlab className="p-10 text-center">
            <Waves className="mx-auto mb-3 h-6 w-6 text-white/40" />
            <p className="text-sm text-white/65">No names match this filter.</p>
          </CrystalSlab>
        ) : (
          <div className="space-y-3">
            {filtered.map((r, i) => (
              <CapsuleRow
                key={r.symbol}
                row={r}
                expanded={expanded === r.symbol}
                style={riseDelay(i)}
                onToggle={() =>
                  setExpanded((cur) => (cur === r.symbol ? null : r.symbol))
                }
                onOpen={() => navigate({ to: "/", search: { sym: r.symbol } })}
              />
            ))}
          </div>
        )}

        <p className="mt-16 text-center text-[11px] tracking-[0.22em] uppercase text-white/40">
          Same scanner. Same alerts. New surface. ·{" "}
          <button
            type="button"
            className="underline decoration-dotted underline-offset-4"
            onClick={() => {
              document.documentElement.classList.remove("crystal");
              try { window.localStorage.setItem("laddrx.liquidGlass", "0"); } catch { /* ignore */ }
              window.location.reload();
            }}
          >
            Switch to classic
          </button>
        </p>
      </div>

      {/* Floating rescan orb — bottom-right */}
      <div className="pointer-events-none fixed bottom-24 right-4 z-30 sm:bottom-28 sm:right-8">
        <CrystalOrb
          label="Rescan"
          size={56}
          onClick={rescan}
          disabled={rescanning || scan.isFetching}
          className="pointer-events-auto"
        >
          <RefreshCw
            className={`h-5 w-5 ${rescanning || scan.isFetching ? "animate-spin" : ""}`}
          />
        </CrystalOrb>
      </div>
    </CrystalRoot>
  );
}

/* ─────────── Row: horizontal capsule that expands to reveal ladder ─────────── */
function CapsuleRow({
  row,
  expanded,
  style,
  onToggle,
  onOpen,
}: {
  row: ScanRow;
  expanded: boolean;
  style?: React.CSSProperties;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const rungs = (row.adaptiveLadder ?? []).slice(0, 5);
  const tone = REGIME_TONE[row.regime] ?? { color: "#67e8f9", label: row.regimeLabel };
  const changeTone = row.change1d >= 0 ? "#a7f3d0" : "#fb7185";

  return (
    <div className="cr-rise" style={style}>
      <div
        className="cr-slab cr-hoverable cursor-pointer px-5 py-4 sm:px-7"
        onClick={onToggle}
        style={{ borderRadius: expanded ? 32 : 999 }}
      >
        {/* Collapsed row content */}
        <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
          {/* Symbol + name */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5">
              <Serif className="text-2xl text-white leading-none">{row.symbol}</Serif>
              <StatNum className="text-sm text-white/60">{usd(row.price)}</StatNum>
            </div>
            {row.name && (
              <div className="mt-1 truncate text-[11px] text-white/45">{row.name}</div>
            )}
          </div>

          {/* Regime chip */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-[10px] uppercase tracking-[0.18em]"
            style={{ color: tone.color }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: tone.color, boxShadow: `0 0 6px ${tone.color}` }}
            />
            {tone.label}
          </span>

          {/* Ladder rungs as crystal dots */}
          <div className="hidden items-center gap-1.5 sm:flex" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full"
                style={{
                  background:
                    i < rungs.length
                      ? "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), rgba(103,232,249,0.55) 55%, transparent 100%)"
                      : "rgba(255,255,255,0.12)",
                  boxShadow: i < rungs.length ? "0 0 8px rgba(103,232,249,0.6)" : undefined,
                }}
              />
            ))}
          </div>

          {/* Change */}
          <StatNum
            className="text-base font-semibold"
            style={{ color: changeTone }}
          >
            {pct(row.change1d)}
          </StatNum>

          <span
            className="grid h-8 w-8 place-items-center rounded-full border border-white/12 text-white/60 transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : undefined }}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>

        {/* Expanded ladder arc */}
        {expanded && (
          <div className="mt-5 border-t border-white/10 pt-5 cr-rise" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <MicroLabel>Ladder · {row.scenarioTitle}</MicroLabel>
              <CrystalPill
                icon={<ArrowUpRight className="h-3.5 w-3.5" />}
                onClick={onOpen}
                className="!py-1 !px-3 !text-xs"
              >
                Full analysis
              </CrystalPill>
            </div>
            {rungs.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {rungs.map((rung, i) => (
                  <CrystalPane key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="grid h-6 w-6 place-items-center rounded-full border border-white/12 text-[10px] text-white/70 tabular-nums"
                      >
                        {i + 1}
                      </span>
                      <span className="truncate text-xs text-white/80">{rung.label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <MicroLabel>{Math.round(rung.pct * 100)}%</MicroLabel>
                      <StatNum className="text-white/90">{usd(rung.price)}</StatNum>
                    </div>
                  </CrystalPane>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/50">
                No ladder yet — waiting for a qualifying dip.
              </p>
            )}
            {row.scenarioWhy && (
              <p className="mt-4 text-xs leading-relaxed text-white/55">
                {row.scenarioWhy}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Silent inline "open classic" link for accessibility */}
      <Link
        to="/"
        search={{ sym: row.symbol }}
        className="sr-only"
        aria-label={`Open full analysis for ${row.symbol}`}
      >
        Open {row.symbol}
      </Link>
    </div>
  );
}
