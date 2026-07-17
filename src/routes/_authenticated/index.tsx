import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ManualFillDialogLazy as ManualFillDialog,
  PositionsPanelLazy as PositionsPanel,
  TelegramAlertsPanelLazy as TelegramAlertsPanel,
  AlertHistoryPanelLazy as AlertHistoryPanel,
  TrackRecordPanelLazy as TrackRecordPanel,
  HistoricalAnalogPanelLazy as HistoricalAnalogPanel,
  type ManualFillTranche,
} from "@/components/lazy-panels";
import { AskTheStock } from "@/components/AskTheStock";
import { ArrowLeft } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Activity,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Radio,
  Loader2,
  Flame,
  ArrowRight,
  Target,
  Zap,
  Check,
  RotateCcw,
  Sparkles,
  Rocket,
} from "lucide-react";
import { scanUniverse, type ScanRow, type ScanResult } from "@/lib/market.functions";
import { usePositions, type Position } from "@/lib/positions";
import { publishSnapshot, registerActions } from "@/lib/app-bridge";
import {
  loadSpeedMode,
  saveSpeedMode,
  applySpeedMode,
  SPEED_MODE_META,
  type SpeedMode,
  type LadderRung,
} from "@/lib/speed-mode";
import { computeBracketFor, type Bracket } from "@/lib/brackets";
import { augment, shallowDipLadder, momentumLadder, analogLadder } from "@/lib/scan-augmentations";
import { logSignals, scoreOutcomes } from "@/lib/track-record";
import { diffAndAlert } from "@/lib/proactive-alerts";
import { SpeedModeToggle } from "@/components/SpeedModeToggle";
import { BracketExitDisplay } from "@/components/BracketExitDisplay";
import { CsvExportButton } from "@/components/CsvExportButton";
import { IntradayAnalogChartLazy as IntradayAnalogChart } from "@/components/IntradayAnalogChartLazy";
import { narrativeFrom, rungProbabilityNote, rungProbabilityChip } from "@/lib/analog-narrative";
import { fetchQuotes } from "@/lib/quote.functions";
import { TerminalSkeleton } from "@/components/TerminalSkeleton";
import { readCachedScan, writeCachedScan } from "@/lib/scan-cache";


import { useLiquidGlass } from "@/lib/liquid-glass";
import { CrystalTerminal } from "@/crystal/CrystalTerminal";

function TerminalRouteSwitch() {
  const { enabled } = useLiquidGlass();
  return enabled ? <CrystalTerminal /> : <Terminal />;
}

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: zodValidator(
    z.object({ sym: fallback(z.string(), "").default("") }),
  ),
  pendingComponent: TerminalSkeleton,
  component: TerminalRouteSwitch,
});


// ─── Server-driven scenario/tranches ─────────────
// The server is the single source of truth for regime, scenario, ladder,
// risk, and factors. The client formats what it receives and — when
// Speed Mode / Shallow-Dip / Momentum applies — swaps in an alternate
// laddering strategy (all still math-driven, no API round-trip).
type ScenarioKey = ScanRow["scenarioKey"];

type Tranche = {
  n: number;
  day: number;
  pct: number;
  price: number;
  label: string;
  plain: string;
  mode?: "limit" | "market" | "pullback";
  badge?: string;
};

function baseTranches(row: ScanRow): LadderRung[] {
  const aug = augment(row);
  // Prefer analog-derived ladder when the Historical Analog Scanner has
  // usable evidence — rungs are placed at real historical retracement
  // depths, each carrying its own probability of being reached.
  const analog = analogLadder(row, row.analog);
  if (analog) return analog;
  // Momentum breakout: swap in add-into-strength ladder.
  if (aug.momentum === "BREAKOUT") return momentumLadder(row);
  // Shallow dip: swap in tight micro-ladder near current price.
  if (aug.isShallowDip && row.atr14 > 0) return shallowDipLadder(row);
  // Fall back to server-computed adaptive ladder.
  return row.adaptiveLadder ?? [];
}

// Convert the (possibly-swapped) rung list into the Tranche shape used by
// the ladder UI and auto-fill effect. Speed Mode reshapes the split.
function buildTranches(row: ScanRow, speedMode: SpeedMode = "balanced"): Tranche[] {
  const rungs = applySpeedMode(baseTranches(row), speedMode);
  return rungs.map((rung, i) => ({
    n: i + 1,
    day: i + 1,
    pct: rung.pct,
    price: rung.price,
    label: rung.label,
    plain: rung.reason,
    mode: "limit",
  }));
}

// Ladder shown to the user.
//
// Design contract (do not regress):
//   • Filled rungs are LOCKED at the user's actual fill price and their
//     original % allocation — they represent real money already deployed and
//     must never re-price when the market moves.
//   • Unfilled rungs are always recomputed from the LIVE scan (`baseTranches`)
//     so future limit prices, capital deployment, and any other recommendation
//     keep tracking the current market — ATR, price, support, regime. A manual
//     fill on rung #1 must never freeze rungs #2..N at yesterday's prices.
//   • The remaining % allocation is redistributed pro-rata across the still-
//     open live rungs so a partial fill on a rung planned for 60% doesn't
//     leak capital.
function effectiveTranches(
  row: ScanRow,
  speedMode: SpeedMode,
  position?: Position,
): Tranche[] {
  const liveRungs = applySpeedMode(baseTranches(row), speedMode);
  const filledByDay = new Map<number, { price: number; pct: number }>();
  if (position)
    for (const e of position.entries)
      filledByDay.set(e.day, { price: e.price, pct: e.pct });

  const filledPct = [...filledByDay.values()].reduce((a, e) => a + e.pct, 0);
  const remainingPct = Math.max(0, 1 - filledPct);
  const plannedRemaining = liveRungs.reduce(
    (a, r, i) => (filledByDay.has(i + 1) ? a : a + r.pct),
    0,
  );
  const scale = plannedRemaining > 0 ? remainingPct / plannedRemaining : 1;

  return liveRungs.map((rung, i) => {
    const day = i + 1;
    const filled = filledByDay.get(day);
    if (filled) {
      return {
        n: day,
        day,
        pct: filled.pct,
        price: filled.price,
        label: `Filled · ${rung.label}`,
        plain: rung.reason,
        mode: "limit",
      };
    }
    return {
      n: day,
      day,
      pct: rung.pct * scale,
      price: rung.price,
      label: rung.label,
      plain: rung.reason,
      mode: "limit",
    };
  });
}




// Bracket exits (TP1 / TP2 / hard stop) — analog-derived when available,
// ATR fallback otherwise. Provenance is stamped on each Bracket for the UI.
function bracketsFor(row: ScanRow, tranches: Tranche[]): Bracket[] {
  return tranches.map((t) => computeBracketFor(t.price, row.atr14, row.analog));
}

function buildRecoveryCaptureActions({
  row,
  unfilled,
  avgCost,
  filledPct,
}: {
  row: ScanRow;
  unfilled: Tranche[];
  avgCost: number;
  filledPct: number;
}): Tranche[] {
  const r = (n: number) => Math.round(n * 100) / 100;
  const remainingPct = Math.max(0, 1 - filledPct);
  if (unfilled.length === 0 || avgCost <= 0 || remainingPct <= 0) return [];

  const premiumPct = ((row.price - avgCost) / avgCost) * 100;
  const atrPct = (row.atr14 / row.price) * 100;
  const acceptablePremium = Math.max(0.8, Math.min(2.5, atrPct * 0.65));
  const tightPullback = r(Math.max(avgCost, row.price - 0.35 * row.atr14));
  const normalPullback = r(Math.max(avgCost, row.price - 0.6 * row.atr14));
  const firstDay = unfilled[0].day;
  const secondDay = unfilled[1]?.day ?? firstDay;

  const marketAction = (pctOfOriginal: number, label: string, plain: string): Tranche => ({
    n: firstDay, day: firstDay, pct: pctOfOriginal, price: r(row.price),
    label, plain, mode: "market", badge: "RECOVERY BUY NOW",
  });

  if (row.price <= avgCost) {
    return [marketAction(remainingPct, "Recovery Capture · Average-Down Fill",
      "Price is at or below your average cost. Deploy the remaining capital now instead of chasing stale lower bids.")];
  }
  if (premiumPct <= acceptablePremium) {
    return [marketAction(remainingPct, "Recovery Capture · Early Bounce Confirmed",
      "Bounce is still close to your first fill. Deploy the remaining capital before the ladder gets left behind.")];
  }
  if (premiumPct <= acceptablePremium * 2 && unfilled.length > 1) {
    const nowPct = remainingPct * 0.65;
    return [
      marketAction(nowPct, "Recovery Capture · Partial Top-Up Now",
        "Price is moving away from your fill but not too extended. Buy most of the remaining now."),
      { n: secondDay, day: secondDay, pct: remainingPct - nowPct, price: tightPullback,
        label: "Recovery Pullback · Keep Some Dry Powder",
        plain: "Rest on a tight pullback near your average cost, not the old deep Day-3 disaster bid.",
        mode: "pullback", badge: "TIGHT PULLBACK" },
    ];
  }
  if (unfilled.length > 1) {
    const starterPct = remainingPct * 0.25;
    return [
      marketAction(starterPct, "Recovery Capture · Small Momentum Add",
        "Price has run far above your fill. Add only a small piece so you're not fully in cash."),
      { n: secondDay, day: secondDay, pct: remainingPct - starterPct, price: normalPullback,
        label: "Recovery Pullback · Main Add",
        plain: "Put most remaining capital on a shallow pullback — closer to market than the old ladder.",
        mode: "pullback", badge: "SHALLOW PULLBACK" },
    ];
  }
  return [{ n: firstDay, day: firstDay, pct: remainingPct, price: normalPullback,
    label: "Recovery Pullback · Last Add",
    plain: "Price is too far above your fill for a full market buy. Use a shallow pullback.",
    mode: "pullback", badge: "SHALLOW PULLBACK" }];
}





// ─── Formatting ─────────────
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const pct = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

// ─── Main ─────────────
function Terminal() {
  const CAPITAL_KEY = "qs_capital_v1";
  const CAPITAL_DEFAULT = 5000;
  const [capital, setCapitalState] = useState<number>(CAPITAL_DEFAULT);
  const [capitalInput, setCapitalInput] = useState<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CAPITAL_KEY);
      if (raw != null) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) {
          setCapitalState(n);
          setCapitalInput(String(n));
        }
      }
    } catch {}
  }, []);
  const setCapital = useCallback((n: number) => {
    const v = Math.max(1, Math.round(n));
    setCapitalState(v);
    setCapitalInput(String(v));
    try {
      window.localStorage.setItem(CAPITAL_KEY, String(v));
    } catch {}
  }, []);
  const [fractional, setFractional] = useState(false);
  const [speedMode, setSpeedModeState] = useState<SpeedMode>("balanced");
  const speedModeRef = useRef<SpeedMode>("balanced");
  const setSpeedMode = (m: SpeedMode) => {
    speedModeRef.current = m;
    setSpeedModeState(m);
    saveSpeedMode(m);
    toast(`Speed mode: ${SPEED_MODE_META[m].label}`, {
      description: SPEED_MODE_META[m].desc,
    });
  };
  const prevRowsRef = useRef<ScanRow[] | null>(null);
  const [trackRecordTick, setTrackRecordTick] = useState(0);
  const [warningDismissed, setWarningDismissed] = useState<string | null>(null);
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);
  const [liveRegimeOpen, setLiveRegimeOpen] = useState(false);



  // Auto-rescan cadence:
  //  • Market closed → every 6 hours.
  //  • Market open, quiet tape → every 60 seconds.
  //  • Market open, active tape → every 30 seconds.
  // "Active" = at least one scanned symbol is in a non-NO_DIP regime,
  // or shows |change1d| ≥ 1% or |dropFromOpenPct| ≥ 1% on the latest scan.
  // Manual rescan via the button is always available.
  const isUsMarketOpen = () => {
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = et.getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;
    const mins = et.getHours() * 60 + et.getMinutes();
    return mins >= 9 * 60 + 30 && mins < 16 * 60;
  };
  const [marketOpen, setMarketOpen] = useState<boolean>(() => isUsMarketOpen());
  useEffect(() => {
    const id = setInterval(() => setMarketOpen(isUsMarketOpen()), 60_000);
    return () => clearInterval(id);
  }, []);

  const queryClient = useQueryClient();

  // Session-cache hydration: if the user has a recent scan in this tab,
  // seed the query with it so the terminal renders real data on the very
  // first frame while a fresh scan revalidates in the background.
  const cachedScan = readCachedScan();

  const scan = useQuery<ScanResult, Error>({
    queryKey: ["scan"],
    queryFn: () => scanUniverse(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    initialData: cachedScan?.data,
    initialDataUpdatedAt: cachedScan?.savedAt,
    refetchInterval: (query) => {
      if (!marketOpen) return 6 * 60 * 60_000;
      const data = query.state.data as ScanResult | undefined;
      const rows = data?.rows ?? [];
      const hasActivity = rows.some(
        (r) =>
          r.regime !== "NO_DIP" ||
          Math.abs(r.change1d ?? 0) >= 1 ||
          Math.abs(r.intraday?.dropFromOpenPct ?? 0) >= 1,
      );
      return hasActivity ? 30_000 : 60_000;
    },
    refetchIntervalInBackground: true,
    retry: (count, err) =>
      count < 2 && /429|rate limit/i.test(err?.message ?? ""),
    retryDelay: (attempt) => 5_000 * (attempt + 1),
  });

  // Persist fresh scans to sessionStorage for instant re-entry.
  useEffect(() => {
    if (scan.data && !scan.isFetching) writeCachedScan(scan.data);
  }, [scan.data, scan.isFetching]);

  // When the primary scan refetches, cascade an invalidation so every
  // dependent panel (analog, earnings, track record, positions, momentum,
  // future leaders) actually pulls fresh data too. Without this the header
  // spinner stops but the panels keep showing the previous scan's numbers.
  const lastScanFetchAt = scan.dataUpdatedAt;
  useEffect(() => {
    if (!lastScanFetchAt) return;
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return typeof k === "string" && k !== "scan";
      },
    });
    setTrackRecordTick((t) => t + 1);
  }, [lastScanFetchAt, queryClient]);

  const [rescanning, setRescanning] = useState(false);
  const forceRescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    const t0 = Date.now();
    try {
      console.log("[rescan] start");
      // 1) Force-refresh the primary scan (bypasses server-side caches).
      const fresh = await scanUniverse({ data: { force: true } });
      if (fresh.rows.length === 0 && fresh.warning) {
        toast.warning("Fresh scan unavailable", { description: fresh.warning });
        queryClient.setQueryData<ScanResult | undefined>(["scan"], (prev) =>
          prev ? { ...prev, warning: fresh.warning, scannedAt: fresh.scannedAt } : fresh,
        );
        return;
      }
      queryClient.setQueryData(["scan"], fresh);
      console.log(`[rescan] scan ok · ${fresh.rows.length} rows · ${Date.now() - t0}ms`);
      // 2) Invalidate & refetch every other panel query so the whole page
      //    reflects the new tape (analog, earnings, momentum, future leaders,
      //    positions, telegram links, track record, etc.).
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && k !== "scan";
        },
        refetchType: "active",
      });
      // 3) Remount the track-record panel so it re-reads from Supabase.
      setTrackRecordTick((t) => t + 1);
      console.log(`[rescan] full refresh done · ${Date.now() - t0}ms`);
      toast.success(`Rescan complete · ${fresh.rows.length} names · ${Math.round((Date.now() - t0) / 100) / 10}s`);
    } catch (e) {
      console.error("[rescan] failed", e);
      toast.error(e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem("qs_fractional");
    if (v === "1") setFractional(true);
    const m = loadSpeedMode();
    speedModeRef.current = m;
    setSpeedModeState(m);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined")
      window.localStorage.setItem("qs_fractional", fractional ? "1" : "0");
  }, [fractional]);

  useEffect(() => {
    if (scan.error) {
      const msg = scan.error.message || "Scan failed";
      if (msg.includes("TWELVEDATA_API_KEY"))
        toast.error("Server missing TWELVEDATA_API_KEY.");
      else toast.error(msg);
    }
  }, [scan.error]);

  // Proactive: diff scans, log signals, retroactively score outcomes.
  useEffect(() => {
    const rows = scan.data?.rows;
    if (!rows || rows.length === 0) return;
    const alertRows = rows.filter(
      (r) =>
        r.regime !== "NO_DIP" &&
        (r.change1d ?? 0) < -0.05 &&
        r.score > 0,
    );
    const prevAlertRows = prevRowsRef.current?.filter(
      (r) =>
        r.regime !== "NO_DIP" &&
        (r.change1d ?? 0) < -0.05 &&
        r.score > 0,
    ) ?? null;
    diffAndAlert(prevAlertRows, alertRows);
    logSignals(
      rows.map((r) => ({
        symbol: r.symbol,
        regime: r.regime,
        regimeLabel: r.regimeLabel,
        scenarioKey: r.scenarioKey,
        price: r.price,
        confidence: r.confidence,
      })),
    );
    // Historical analog engine now runs fully server-side per symbol.
    const priceMap: Record<string, number> = {};
    for (const r of rows) priceMap[r.symbol] = r.price;
    scoreOutcomes(priceMap);
    prevRowsRef.current = rows;
    setTrackRecordTick((t) => t + 1);
  }, [scan.data]);

  const rows = scan.data?.rows ?? [];
  const isQualifiedDip = (r: ScanRow) =>
    r.regime !== "NO_DIP" && r.change1d <= -1.2;
  const falling = rows.filter(isQualifiedDip);
  const green = rows.filter((r) => !isQualifiedDip(r));
  // Universe symbols the provider failed to serve this scan (e.g. Yahoo hiccup
  // on an index like NDX). Surface them so the user always sees the full tracked
  // set instead of a silently-dropped ticker.
  const failedSymbols: string[] = Array.isArray(scan.data?.failed) ? scan.data!.failed : [];
  const trackedButMissing = failedSymbols.filter(
    (s) => !rows.some((r) => r.symbol === s),
  );
  const topPick = falling[0] ?? null;

  // Active symbol: URL search param (?sym=SMH) wins; otherwise the top pick.
  // Tapping a card in "Other Falling Names" navigates here so every
  // recommendation renders the same full analysis page.
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const activePick =
    (search.sym && falling.find((r) => r.symbol === search.sym.toUpperCase())) ||
    topPick;
  const isViewingAlternate = !!activePick && !!topPick && activePick.symbol !== topPick.symbol;
  const setActiveSymbol = (sym: string | null) => {
    navigate({ search: { sym: sym ?? "" } });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };


  // Position tracking
  const {
    positions,
    settings: posSettings,
    setSetting: setPosSetting,
    markFilled,
    resetPosition,
  } = usePositions();

  // ── AI bubble bridge: publish live snapshot + expose actions ──
  useEffect(() => {
    publishSnapshot({
      scan: scan.data ?? null,
      scanLoading: scan.isFetching,
      scanError: scan.error?.message ?? null,
      positions,
      posSettings,
      capital,
      fractional,
      marketOpen,
      speedMode,
    });
  }, [scan.data, scan.isFetching, scan.error, positions, posSettings, capital, fractional, marketOpen, speedMode]);

  useEffect(() => {
    registerActions({
      rescan: async () => {
        try {
          await forceRescan();
          return { ok: true, message: "Rescan complete" };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      },
      resetPosition: (symbol: string) => {
        const sym = symbol.toUpperCase();
        if (!positions[sym]) return { ok: false, message: `No plan for ${sym}` };
        resetPosition(sym);
        return { ok: true, message: `${sym} plan reset` };
      },
      setAutoFill: (on) => setPosSetting("autoFill", on),
      setRecoveryCapture: (on) => setPosSetting("recoveryCapture", on),
      setCapital: (n) => setCapital(Math.max(1, Math.round(n))),
      setFractional: (on) => setFractional(on),
      setSpeedMode: (m) => setSpeedMode(m),
      openLiveRegime: () => setLiveRegimeOpen(true),
    });
  }, [forceRescan, positions, resetPosition, setPosSetting]);


  // Auto-fill: after each scan, if the current price has traded to/through an
  // unfilled limit — or Recovery Capture says to buy now — log it. Approximation;
  // real fills still need broker confirmation.
  useEffect(() => {
    if (!posSettings.autoFill || !scan.data) return;
    for (const row of scan.data.rows) {
      const pos = positions[row.symbol];
      if (!pos) continue;
      const scenarioKey = row.scenarioKey;
      const base = effectiveTranches(row, speedModeRef.current, pos);
      const filledPct = pos.entries.reduce((a, e) => a + e.pct, 0);
      const capDeployed = pos.entries.reduce((a, e) => a + e.shares * e.price, 0);
      const sharesOwned = pos.entries.reduce((a, e) => a + e.shares, 0);
      const avgCost = sharesOwned > 0 ? capDeployed / sharesOwned : 0;
      const filledDays = new Set(pos.entries.map((e) => e.day));
      const unfilled = base.filter((t) => !filledDays.has(t.day));
      const recovery = posSettings.recoveryCapture && pos.entries.length > 0
        ? buildRecoveryCaptureActions({ row, unfilled, avgCost, filledPct })
        : [];
      const candidates = recovery.length > 0 ? recovery : unfilled;
      // Snapshot the raw planned ladder (without speed-mode transforms) so the
      // freeze is stable across speed-mode toggles later.
      const plannedLadder = pos.plannedLadder ?? baseTranches(row);
      for (const t of candidates) {
        if (pos.entries.some((e) => e.day === t.day)) continue;
        if (t.mode === "market" || row.price <= t.price) {
          const capForDay = pos.totalCapital * t.pct;
          const shares = fractional
            ? Math.round((capForDay / t.price) * 10000) / 10000
            : Math.floor(capForDay / t.price);
          if (shares <= 0) continue;
          markFilled(
            row.symbol,
            { day: t.day, pct: t.pct, shares, price: t.price, auto: true },
            { totalCapital: pos.totalCapital, scenario: scenarioKey, plannedLadder },
          );
        }
      }

    }
  }, [scan.data, posSettings.autoFill, posSettings.recoveryCapture, positions, fractional, markFilled]);

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 selection:bg-cyan-500/30">
      {/* Background grid */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(59,130,246,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,.15) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-cyan-500/10 bg-[#0b0f1a]/90 backdrop-blur-xl">
        <div className="mx-auto max-w-[1600px] px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_30px_rgba(34,211,238,0.35)]">
              <Zap className="h-4 w-4 text-[#0b0f1a]" strokeWidth={3} />
            </div>
            <div className="min-w-0 leading-tight">
              <h1 className="text-sm font-black tracking-tight truncate">
                LADDRX <span className="text-cyan-400">·</span> DIP SCANNER
              </h1>
              <div className="text-[10px] uppercase tracking-[0.25em] text-slate-500 truncate">
                Auto-router for falling securities
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant="outline"
              className={
                scan.isError
                  ? "border-rose-500/40 text-rose-400 bg-rose-500/5"
                  : scan.data?.warning
                    ? "border-amber-500/40 text-amber-300 bg-amber-500/5"
                  : scan.data
                    ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5"
                    : "border-slate-700 text-slate-400 bg-slate-800/40"
              }
            >
              <Radio className="h-3 w-3 mr-1" />
              {scan.isError ? "ERR" : scan.data?.warning ? "CACHED" : scan.data ? "LIVE" : "…"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="border-cyan-500/30 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
              onClick={forceRescan}
              disabled={rescanning || scan.isFetching}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1 ${rescanning || scan.isFetching ? "animate-spin" : ""}`}
              />
              {rescanning ? "Rescanning…" : "Rescan"}
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1600px] px-4 py-6 space-y-6">
        {/* STALE / RATE-LIMIT BANNER */}
        {scan.data?.warning && warningDismissed !== scan.data.warning && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs sm:text-sm text-amber-100 font-mono leading-relaxed">
              <div className="font-bold uppercase tracking-widest text-[10px] text-amber-300 mb-1">
                Data fallback active
              </div>
              {scan.data.warning}
            </div>
            <button
              type="button"
              onClick={() => setWarningDismissed(scan.data?.warning ?? null)}
              className="text-amber-300/70 hover:text-amber-200 text-xs font-mono uppercase tracking-widest"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* HOW IT WORKS */}
        <Card className="border-cyan-500/20 bg-[#131a2b]/60">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-[0.25em] text-cyan-300 font-mono font-bold">
                How this works
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Tracks <span className="text-cyan-300 font-mono">NDX · QQQ · SMH · SOXX · SOXQ · NVDA</span> —
              NASDAQ 100 + semiconductor ETFs. When any of them falls, the scanner grades
              the drawdown, classifies the setup (heavy support test / baseline flush /
              slow bleed), and generates a laddered buy plan with exact limit prices and
              share counts sized to your capital. If your first buy fills and price starts
              recovering, it stops waiting for stale lower bids and switches to recovery
              top-ups so cash does not sit behind the market. When nothing's falling, it
              tells you to sit on hands.
            </p>
          </CardContent>
        </Card>

        {/* LIVE REGIME PANEL — now accessed via the hamburger menu */}
        <Sheet open={liveRegimeOpen} onOpenChange={setLiveRegimeOpen}>
          <SheetContent
            side="right"
            className="w-full sm:max-w-2xl border-l border-slate-800 bg-slate-950/95 p-0 text-slate-100 backdrop-blur-xl overflow-y-auto"
          >
            <SheetHeader className="border-b border-slate-800/70 px-4 py-3">
              <SheetTitle className="text-left text-sm font-black tracking-tight text-slate-50">
                Live Regime · Intraday Analysis
              </SheetTitle>
            </SheetHeader>
            <div className="p-3 sm:p-4">
              {scan.data && scan.data.rows.length > 0 ? (
                <LiveRegimePanel
                  rows={scan.data.rows}
                  spyChangePct={scan.data.spyChangePct}
                  focusedSymbol={focusedSymbol}
                  onToggleFocus={(s) => setFocusedSymbol((cur) => (cur === s ? null : s))}
                />
              ) : (
                <div className="text-sm text-slate-400 p-4">Waiting for scan data…</div>
              )}
            </div>
          </SheetContent>
        </Sheet>





        {/* CAPITAL BAR */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
              Capital to Deploy
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400 font-mono">
                $
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={100000000}
                step={100}
                placeholder={String(CAPITAL_DEFAULT)}
                value={capitalInput}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const raw = e.target.value;
                  setCapitalInput(raw);
                  if (raw === "") {
                    setCapitalState(CAPITAL_DEFAULT);
                    try { window.localStorage.removeItem(CAPITAL_KEY); } catch {}
                    return;
                  }
                  const n = Number(raw);
                  if (Number.isFinite(n) && n > 0) {
                    const clamped = Math.min(100000000, Math.round(n));
                    setCapitalState(clamped);
                    try { window.localStorage.setItem(CAPITAL_KEY, String(clamped)); } catch {}
                  }
                }}
                onBlur={() => {
                  if (capitalInput === "") setCapitalState(CAPITAL_DEFAULT);
                }}
                className="h-12 pl-7 font-mono text-lg bg-[#131a2b] border-cyan-500/20 focus-visible:border-cyan-400/60 focus-visible:ring-cyan-400/20"
              />
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 rounded-lg border border-cyan-500/20 bg-[#131a2b] px-4 h-12">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Fractional
            </div>
            <Switch checked={fractional} onCheckedChange={setFractional} />
          </div>
        </div>

        {/* POSITION SETTINGS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-cyan-500/20 bg-[#131a2b] px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-mono font-bold">
                Auto-Fill Detection
              </div>
              <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                Mark tranches filled when price ≤ limit at scan time. Approximate — verify against your broker.
              </div>
            </div>
            <Switch
              checked={posSettings.autoFill}
              onCheckedChange={(v) => setPosSetting("autoFill", v)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-[#131a2b] px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-amber-300 font-mono font-bold">
                Recovery Capture
              </div>
              <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                After a fill, stop chasing stale lower limits; buy recovery strength or a shallow pullback.
              </div>
            </div>
            <Switch
              checked={posSettings.recoveryCapture}
              onCheckedChange={(v) => setPosSetting("recoveryCapture", v)}
            />
          </div>
        </div>

        <TelegramAlertsPanel />
        <AlertHistoryPanel />



        {/* SPEED MODE */}
        <SpeedModeToggle value={speedMode} onChange={setSpeedMode} />

        {/* LIVE POSITIONS with P&L */}
        {scan.data && (
          <PositionsPanel
            positions={positions}
            scanRows={scan.data.rows}
            onReset={resetPosition}
            onFocusSymbol={setFocusedSymbol}
          />
        )}

        {/* TRACK RECORD */}
        <TrackRecordPanel refreshKey={trackRecordTick} />

        {/* LOADING — content-shaped skeleton, not a full-screen spinner */}
        {scan.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="h-4 w-16 rounded bg-slate-800/70 animate-pulse" />
                  <div className="h-4 w-12 rounded bg-slate-800/50 animate-pulse" />
                </div>
                <div className="mt-3 h-8 w-28 rounded bg-slate-800/70 animate-pulse" />
                <div className="mt-4 space-y-2">
                  <div className="h-3 w-full rounded bg-slate-800/50 animate-pulse" />
                  <div className="h-3 w-5/6 rounded bg-slate-800/40 animate-pulse" />
                  <div className="h-3 w-2/3 rounded bg-slate-800/40 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ERROR */}
        {scan.isError && !scan.isLoading && (
          <Card className="border-2 border-rose-500/50 bg-rose-950/20">
            <CardContent className="p-6 space-y-2">
              <div className="flex items-center gap-2 text-rose-300 font-bold">
                <AlertTriangle className="h-5 w-5" />
                Scan Failed
              </div>
              <div className="text-sm text-rose-200/80 font-mono break-words">
                {scan.error?.message}
              </div>
              <Button
                size="sm"
                onClick={() => scan.refetch()}
                className="mt-2 bg-rose-500 hover:bg-rose-600"
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* SCAN RESULTS */}
        {scan.data && (
          <>
            {rows.length === 0 && scan.data.warning ? (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardContent className="p-8 text-center">
                  <div className="text-amber-300 font-black text-2xl mb-1">
                    Fresh scan unavailable.
                  </div>
                  <div className="text-slate-400 text-sm">
                    The data provider is rate-limited, so no dip ranking is being shown until fresh data is available.
                  </div>
                </CardContent>
              </Card>
            ) : activePick ? (
              <>
                {isViewingAlternate && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2">
                    <div className="text-[11px] font-mono text-cyan-300">
                      Viewing <span className="font-bold">{activePick.symbol}</span> · not
                      today's top pick ({topPick?.symbol})
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActiveSymbol(null)}
                      className="h-7 text-[11px] text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10"
                    >
                      <ArrowLeft className="h-3 w-3 mr-1" /> Back to Top Pick
                    </Button>
                  </div>
                )}
                <TopPickHero
                  row={activePick}
                  capital={capital}
                  fractional={fractional}
                  speedMode={speedMode}
                  isAlternate={isViewingAlternate}
                />
                <AskTheStock row={activePick} />
                <IntradayAnalogChart symbol={activePick.symbol} />
                {/* Only mount the analog panel for names that qualified for
                    analog search server-side. Quiet / green rows have
                    analog=null with a "skipped_quiet" status, and rendering
                    the panel for them would fire a needless server search
                    that returns "no comparable dip". */}
                {(activePick.analog || activePick.analogStatus === "ok" || activePick.score > 0 || activePick.regime !== "NO_DIP") && (
                  <HistoricalAnalogPanel symbol={activePick.symbol} price={activePick.price} />
                )}
                {activePick.symbol !== "SMH" && (() => {
                  const smh = rows.find((r) => r.symbol === "SMH");
                  return smh && smh.score > 0 && (smh.analog || smh.regime !== "NO_DIP") ? (
                    <HistoricalAnalogPanel symbol="SMH" price={smh.price} />
                  ) : null;
                })()}
              </>
            ) : (
              <>
                <Card className="border-cyan-500/20 bg-[#131a2b]/60">
                  <CardContent className="p-8 text-center">
                    <div className="text-emerald-400 font-black text-2xl mb-1">
                      Nothing falling.
                    </div>
                    <div className="text-slate-400 text-sm">
                      No tracked name is down at least 1.2% today. Sit on hands.
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* FALLING LIST — every non-active pick opens the same full analysis */}
            {falling.filter((r) => r.symbol !== activePick?.symbol).length > 0 && (
              <section>
                <SectionHeader
                  icon={<Flame className="h-4 w-4 text-orange-400" />}
                  title="Other Falling Names"
                  count={falling.filter((r) => r.symbol !== activePick?.symbol).length}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {falling
                    .filter((r) => r.symbol !== activePick?.symbol)
                    .map((r) => (
                      <ScanCard
                        key={r.symbol}
                        row={r}
                        onOpen={() => setActiveSymbol(r.symbol)}
                      />
                    ))}
                </div>
              </section>
            )}


            {/* GREEN NAMES */}
            {(green.length > 0 || trackedButMissing.length > 0) && (
              <section>
                <SectionHeader
                  icon={<TrendingDown className="h-4 w-4 rotate-180 text-emerald-400" />}
                  title="Not Falling"
                  count={green.length + trackedButMissing.length}
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {green.map((r) => (
                    <div
                      key={r.symbol}
                      className="rounded-md border border-slate-800 bg-[#131a2b]/40 px-3 py-2 min-w-0"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono font-bold text-slate-300 truncate">
                          {r.symbol}
                        </span>
                        <span
                          className={`text-xs font-mono ${
                            r.change1d >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {pct(r.change1d)}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 truncate">
                        {usd(r.price)}
                      </div>
                    </div>
                  ))}
                  {trackedButMissing.map((sym) => (
                    <div
                      key={sym}
                      className="rounded-md border border-slate-800/70 bg-[#131a2b]/30 px-3 py-2 min-w-0"
                      title="Tracked but no data returned this scan"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono font-bold text-slate-400 truncate">
                          {sym}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          no data
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-600 truncate">
                        awaiting next fetch
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

          </>
        )}

        <footer className="pt-6 text-center text-[11px] text-slate-600 font-mono">
          LADDRX · Live data via Twelve Data · Not financial advice ·
          {scan.data?.scannedAt
            ? ` Scanned ${new Date(scan.data.scannedAt).toLocaleTimeString()}`
            : ""}
        </footer>
      </main>
    </div>
  );
}

// ─── Sections ─────────────
function SectionHeader({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h2 className="text-sm font-black tracking-tight uppercase">{title}</h2>
      {count !== undefined && (
        <span className="text-xs font-mono text-slate-500">· {count}</span>
      )}
      <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/20 to-transparent ml-2" />
    </div>
  );
}

// ─── TOP PICK HERO ─────────────
function TopPickHero({
  row,
  capital,
  fractional,
  speedMode,
  isAlternate = false,
}: {
  row: ScanRow;
  capital: number;
  fractional: boolean;
  speedMode: SpeedMode;
  isAlternate?: boolean;
}) {
  const riskStyle = RISK_STYLES[row.riskLevel];
  const aug = augment(row);
  const { positions } = usePositions();
  const tranchesForCsv = effectiveTranches(row, speedMode, positions[row.symbol]);
  const bracketsForCsv = bracketsFor(row, tranchesForCsv);


  return (
    <Card className="relative overflow-hidden border-2 border-cyan-400/40 bg-gradient-to-br from-[#131a2b] via-[#0f1524] to-[#0b0f1a] shadow-[0_0_60px_-15px_rgba(34,211,238,0.4)]">
      <div
        aria-hidden
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(34,211,238,.25), transparent 60%)",
        }}
      />
      <CardContent className="relative p-6 md:p-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
          <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-300 font-mono font-bold">
            {isAlternate ? "Alternate Pick · Full Analysis" : "Top Pick · Best Dip Right Now"}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-start">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-5xl md:text-6xl font-black font-mono tracking-tighter text-white">
                {row.symbol}
              </span>
              <span className="text-slate-400 text-sm truncate">{row.name}</span>
            </div>

            <div className="mt-4 flex items-baseline gap-4 flex-wrap">
              <span className="text-3xl md:text-4xl font-black font-mono text-white">
                {usd(row.price)}
              </span>
              <span
                className={`text-xl font-mono font-bold ${row.change1d >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                {pct(row.change1d)}
              </span>
              <span className="text-xs font-mono text-slate-500">
                5d {pct(row.change5d)} · 60d high {pct(row.drawdown60Pct)}
              </span>
            </div>

            <div className="mt-5 flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded border ${riskStyle.cls}`}>
                {riskStyle.label}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                {row.regimeLabel}
              </span>
              {aug.isShallowDip && (
                <span className="text-[10px] font-mono font-bold px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 uppercase tracking-wider">
                  Shallow Dip
                </span>
              )}
              {aug.momentum === "BREAKOUT" && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-1 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300 uppercase tracking-wider">
                  <Rocket className="h-3 w-3" /> Breakout
                </span>
              )}
              {aug.momentum === "APPROACHING" && (
                <span className="text-[10px] font-mono font-bold px-2 py-1 rounded border border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-300/80 uppercase tracking-wider">
                  Near 20d High
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-1 rounded border uppercase tracking-wider ${
                  aug.conviction >= 80
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : aug.conviction >= 60
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                      : aug.conviction >= 40
                        ? "border-slate-600 bg-slate-800/40 text-slate-300"
                        : "border-slate-700 bg-slate-900/40 text-slate-500"
                }`}
              >
                <Sparkles className="h-3 w-3" /> Conviction {aug.conviction}
              </span>
            </div>
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                Chosen Scenario
              </div>
              <div className="text-xl font-black text-cyan-300">{row.scenarioTitle}</div>
              <p className="text-sm text-slate-300 mt-2 max-w-xl leading-relaxed">
                {row.scenarioWhy}
              </p>
              <p className="text-[11px] text-slate-500 mt-2 max-w-xl leading-relaxed">
                {row.marketContextNote}
              </p>
            </div>

          </div>

          <div className="flex flex-col items-start lg:items-end gap-3 shrink-0">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">
                Dip Score
              </div>
              <div className="text-5xl font-black font-mono text-cyan-400 leading-none">
                {row.score.toFixed(0)}
              </div>
            </div>
          </div>

        </div>

        {/* Mini ladder preview */}
        <div className="mt-6 pt-5 border-t border-cyan-500/10">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.25em] text-cyan-300 font-mono font-bold">
              Buy Plan · Speed {SPEED_MODE_META[speedMode].short} · Exits per Rung
            </span>
            <CsvExportButton
              symbol={row.symbol}
              capital={capital}
              fractional={fractional}
              tranches={tranchesForCsv}
              brackets={bracketsForCsv}
            />
          </div>
          <TrancheStrip
            row={row}
            capital={capital}
            fractional={fractional}
            speedMode={speedMode}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SCAN CARD ─────────────
function ScanCard({
  row,
  onOpen,
}: {
  row: ScanRow;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left w-full rounded-xl border border-slate-800 bg-[#131a2b]/60 p-4 transition-all group min-w-0 hover:border-cyan-500/50 hover:bg-[#131a2b] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 cursor-pointer"
    >


      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-black text-lg text-white truncate">
              {row.symbol}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 truncate">
              {row.group}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 truncate">{row.name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] uppercase tracking-widest text-slate-500">Score</div>
          <div className="text-xl font-black font-mono text-cyan-400 leading-none">
            {row.score.toFixed(0)}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-mono">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Price</div>
          <div className="text-slate-200">{usd(row.price)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">1D</div>
          <div className={row.change1d >= 0 ? "text-emerald-400" : "text-rose-400"}>
            {pct(row.change1d)}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">5D</div>
          <div className={row.change5d >= 0 ? "text-emerald-400" : "text-rose-400"}>
            {pct(row.change5d)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {row.reasons.slice(0, 2).map((r, i) => (
          <span
            key={i}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
          >
            {r}
          </span>
        ))}
      </div>
    </button>
  );

}

// ─── TRANCHE STRIP (compact horizontal ladder) ─────────────
function TrancheStrip({
  row,
  capital,
  fractional,
  speedMode,
  showBrackets = true,
}: {
  row: ScanRow;
  capital: number;
  fractional: boolean;
  speedMode: SpeedMode;
  showBrackets?: boolean;
}) {
  const { positions, markFilled, removeFill } = usePositions();
  const position = positions[row.symbol];
  const tranches = effectiveTranches(row, speedMode, position);
  const brackets = bracketsFor(row, tranches);
  const filledByDay = new Map((position?.entries ?? []).map((e) => [e.day, e]));
  const plannedLadder =
    position?.plannedLadder ?? applySpeedMode(baseTranches(row), speedMode);

  const [fillTarget, setFillTarget] = useState<ManualFillTranche | null>(null);
  const [editingExisting, setEditingExisting] = useState<{ price: number; shares: number } | null>(null);

  if (tranches.length === 0)
    return (
      <div className="text-xs font-mono text-slate-500">
        No tranches — waiting for setup.
      </div>
    );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {tranches.map((t, i) => {
        const cap = capital * t.pct;
        const shares = fractional
          ? Math.round((cap / t.price) * 10000) / 10000
          : Math.floor(cap / t.price);
        const dist = ((t.price - row.price) / row.price) * 100;
        const b = brackets[i];
        const fill = filledByDay.get(t.day);
        const isFilled = !!fill;
        return (
          <div
            key={t.n}
            className={`rounded-lg border p-3 ${
              isFilled
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-cyan-500/15 bg-[#0b0f1a]/60"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono font-bold text-cyan-300">
                Day {t.day} · {(t.pct * 100).toFixed(0)}%
              </span>
              <span
                className={`text-[9px] font-mono ${
                  dist < 0 ? "text-rose-400" : "text-slate-500"
                }`}
              >
                {pct(dist)}
              </span>
            </div>
            <div className="text-lg font-black font-mono text-emerald-400 leading-none">
              {usd(t.price)}
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-1 truncate">
              {t.label}
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-1">
              {shares}sh · {usd0(cap)}
            </div>
            {isFilled && fill && (
              <div className="text-[10px] font-mono text-emerald-300 mt-1">
                ✓ Filled {fill.shares}sh @ ${fill.price.toFixed(2)} · ${(fill.shares * fill.price).toFixed(0)}
              </div>
            )}
            {showBrackets && b && <BracketExitDisplay bracket={b} />}
            {!isFilled ? (
              <button
                type="button"
                onClick={() => {
                  setEditingExisting(null);
                  setFillTarget({ day: t.day, pct: t.pct, price: t.price, label: t.label });
                }}
                className="mt-2 w-full text-[10px] font-mono uppercase tracking-wider py-1 rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 transition-colors"
              >
                Edit & Mark Filled
              </button>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingExisting({ price: fill!.price, shares: fill!.shares });
                    setFillTarget({ day: t.day, pct: t.pct, price: t.price, label: t.label });
                  }}
                  className="text-[10px] font-mono uppercase tracking-wider py-1 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                >
                  Re-edit
                </button>
                <button
                  type="button"
                  onClick={() => removeFill(row.symbol, t.day)}
                  className="text-[10px] font-mono uppercase tracking-wider py-1 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 transition-colors"
                >
                  Undo
                </button>
              </div>
            )}
          </div>
        );
        })}
      </div>
      <ManualFillDialog
        open={!!fillTarget}
        onOpenChange={(o) => {
          if (!o) {
            setFillTarget(null);
            setEditingExisting(null);
          }
        }}
        symbol={row.symbol}
        tranche={fillTarget}
        capital={capital}
        fractional={fractional}
        plannedLadder={plannedLadder}
        scenarioKey={row.scenarioKey ?? "default"}
        existing={editingExisting}
        onConfirm={(entry, meta) => markFilled(row.symbol, entry, meta)}
      />
    </div>
  );
}


function IndicatorCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "red" | "green";
}) {
  const color =
    tone === "red" ? "text-rose-300" : tone === "green" ? "text-emerald-300" : "text-slate-200";
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-[#0b0f1a]/50 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 truncate">{label}</div>
      <div className={`text-sm font-mono font-bold ${color} truncate`}>{value}</div>
    </div>
  );
}

// ─── Live Regime Panel (Phase 1) ───────────────────────────────
const REGIME_STYLES: Record<
  ScanRow["regime"],
  { badge: string; ring: string; icon: React.ReactNode }
> = {
  NO_DIP: { badge: "bg-slate-700/40 text-slate-300 border-slate-600/40", ring: "border-slate-700/40", icon: <Check className="h-3.5 w-3.5" /> },
  FAKE_OUT: { badge: "bg-amber-500/15 text-amber-300 border-amber-500/40", ring: "border-amber-500/30", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  FAST_CRASH: { badge: "bg-rose-500/20 text-rose-300 border-rose-500/50", ring: "border-rose-500/40", icon: <Flame className="h-3.5 w-3.5" /> },
  SLOW_BLEED: { badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40", ring: "border-indigo-500/30", icon: <TrendingDown className="h-3.5 w-3.5" /> },
  V_BOUNCE_LIKELY: { badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", ring: "border-emerald-500/30", icon: <Zap className="h-3.5 w-3.5" /> },
  SUPPORT_TEST: { badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40", ring: "border-cyan-500/30", icon: <Target className="h-3.5 w-3.5" /> },
};

const STATUS_STYLES: Record<ScanRow["status"], { label: string; cls: string; blurb: string }> = {
  WATCH: { label: "WATCH", cls: "bg-slate-800/60 text-slate-300 border-slate-600/50", blurb: "No capital deployed. Waiting for a meaningful dip." },
  PROBE: { label: "PROBE", cls: "bg-blue-500/20 text-blue-300 border-blue-500/60", blurb: "Meaningful dip detected. Small starter position only. Waiting for confirmation before deploying additional capital." },
  BUY_STARTER: { label: "BUY STARTER", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 animate-pulse", blurb: "Confirmation achieved. Deploy the remaining planned allocation." },
  BUY_LADDER: { label: "BUY LADDER", cls: "bg-cyan-500/20 text-cyan-300 border-cyan-500/60", blurb: "Continue working the ladder as prices trigger." },
};

const RISK_STYLES: Record<ScanRow["riskLevel"], { label: string; cls: string }> = {
  LOW: { label: "LOW RISK", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40" },
  MEDIUM: { label: "MEDIUM RISK", cls: "bg-amber-500/10 text-amber-300 border-amber-500/40" },
  HIGH: { label: "HIGH RISK", cls: "bg-rose-500/15 text-rose-300 border-rose-500/50" },
};

const MARKET_CTX_STYLES: Record<ScanRow["marketContext"], { label: string; cls: string }> = {
  STRONG: { label: "MARKET STRONG", cls: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5" },
  NEUTRAL: { label: "MARKET NEUTRAL", cls: "text-slate-300 border-slate-600/40 bg-slate-800/30" },
  WEAK: { label: "MARKET WEAK", cls: "text-amber-300 border-amber-500/30 bg-amber-500/5" },
  BROAD_SELLOFF: { label: "BROAD SELLOFF", cls: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
};

function FocusedQuotePill({ symbol, refPrice }: { symbol: string; refPrice: number }) {
  const q = useQuery({
    queryKey: ["focus-quote", symbol],
    queryFn: () => fetchQuotes({ data: { symbols: [symbol] } }),
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
    staleTime: 4_000,
  });
  const quote = q.data?.quotes?.[symbol];
  if (q.isLoading && !quote) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/5 text-cyan-300">
        <Loader2 className="h-3 w-3 animate-spin" /> live…
      </span>
    );
  }
  if (q.data?.error) {
    return (
      <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-300">
        live paused ({q.data.error === "rate_limit" ? "rate limit" : "err"})
      </span>
    );
  }
  if (!quote) return null;
  const delta = ((quote.price - refPrice) / refPrice) * 100;
  const ageMs = Date.now() - quote.ts;
  const ageSec = Math.max(0, Math.round(ageMs / 1000));

  // Extended-hours: prefer Pre-Market when marketState === "PRE" and pre data
  // exists; otherwise show After Hours when we have post data. Both come from
  // the same Yahoo /chart meta as the regular price, so they stay in sync.
  const isPre = quote.marketState === "PRE" && typeof quote.preMarketPrice === "number";
  const isPost =
    !isPre &&
    (quote.marketState === "POST" || quote.marketState === "CLOSED") &&
    typeof quote.postMarketPrice === "number";
  const extLabel = isPre ? "Pre-Market" : "After Hours";
  const extPrice = isPre ? quote.preMarketPrice! : isPost ? quote.postMarketPrice! : null;
  const extChange = isPre ? quote.preMarketChange ?? null : isPost ? quote.postMarketChange ?? null : null;
  const extPct = isPre ? quote.preMarketChangePct ?? null : isPost ? quote.postMarketChangePct ?? null : null;
  // Only surface an ext-hours row when the market isn't in the regular session.
  const showExt = quote.marketState && quote.marketState !== "REGULAR";
  const extPositive = (extChange ?? extPct ?? 0) >= 0;

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded border ${
          delta >= 0
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-rose-500/40 bg-rose-500/10 text-rose-300"
        }`}
        title={`Live quote via Yahoo /chart — ${ageSec}s old`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
        LIVE {usd(quote.price)}
        <span className="opacity-70">
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(2)}% vs scan
        </span>
      </span>
      {showExt && extPrice != null ? (
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded border ${
            extPositive
              ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-300/90"
              : "border-rose-500/25 bg-rose-500/5 text-rose-300/90"
          }`}
          title={`${extLabel} price via Yahoo, updates as new trades print`}
        >
          <span className="opacity-70 uppercase tracking-wider text-[9px]">{extLabel}</span>
          {usd(extPrice)}
          {extChange != null && (
            <span className="opacity-80">
              {extChange >= 0 ? "+" : ""}
              {extChange.toFixed(2)}
            </span>
          )}
          {extPct != null && (
            <span className="opacity-70">
              ({extPct >= 0 ? "+" : ""}
              {extPct.toFixed(2)}%)
            </span>
          )}
        </span>
      ) : showExt ? (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-slate-700 bg-slate-800/40 text-slate-400">
          After Hours: Closed
        </span>
      ) : null}
    </span>
  );
}

function SymbolCard({
  r,
  rs,
  ss,
  isFocused,
  onToggleFocus,
}: {
  r: ScanRow;
  rs: (typeof REGIME_STYLES)[keyof typeof REGIME_STYLES];
  ss: (typeof STATUS_STYLES)[keyof typeof STATUS_STYLES];
  isFocused: boolean;
  onToggleFocus: (symbol: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(true);
  const hasDetails =
    !!r.statusReason ||
    r.setupFactors.positive.length > 0 ||
    r.setupFactors.negative.length > 0 ||
    r.executionFactors.positive.length > 0 ||
    r.executionFactors.negative.length > 0 ||
    r.decisionPath.length > 0 ||
    ((r.status === "WATCH" || r.status === "PROBE") && r.watchingFor.length > 0);

  return (
    <div
      id={`sym-card-${r.symbol}`}
      className={`rounded-lg border ${
        isFocused ? "border-cyan-400/60 shadow-[0_0_25px_-8px_rgba(34,211,238,0.5)]" : rs.ring
      } bg-[#0b0f1a]/70 p-4 space-y-3 transition scroll-mt-20`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono font-bold text-slate-100 text-base">{r.symbol}</span>
          <span className="text-[10px] text-slate-500 truncate">{r.name}</span>
          {isFocused && <FocusedQuotePill symbol={r.symbol} refPrice={r.price} />}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className={`${rs.badge} border font-mono text-[10px] gap-1`}>
            {rs.icon} {r.regimeLabel}
          </Badge>
          {r.secondaryRegimeLabel && (
            <Badge variant="outline" className="border-slate-700 bg-[#0b0f1a] text-slate-400 font-mono text-[9px]">
              + {r.secondaryRegimeLabel}
            </Badge>
          )}
          <Badge variant="outline" className={`${ss.cls} border font-mono text-[10px]`}>
            {ss.label}
          </Badge>
          <button
            type="button"
            onClick={() => onToggleFocus(r.symbol)}
            className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border transition ${
              isFocused
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                : "border-slate-700 bg-slate-800/40 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300"
            }`}
            title={isFocused ? "Stop live tracking" : "Track this symbol in real time (8s poll)"}
          >
            {isFocused ? "● Live" : "Track"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className={`${RISK_STYLES[r.riskLevel].cls} border font-mono text-[10px]`}>
          {RISK_STYLES[r.riskLevel].label}
        </Badge>
        <Badge variant="outline" className={`${MARKET_CTX_STYLES[r.marketContext].cls} border font-mono text-[10px]`}>
          {MARKET_CTX_STYLES[r.marketContext].label}
        </Badge>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">{r.regimeExplanation}</p>

      <div className="grid grid-cols-4 gap-2 text-[10px]">
        <IndicatorCell label="Today" value={`${r.change1d >= 0 ? "+" : ""}${r.change1d.toFixed(2)}%`} tone={r.change1d < 0 ? "red" : "green"} />
        <IndicatorCell
          label="Intraday"
          value={r.intraday ? `${r.intraday.dropFromOpenPct >= 0 ? "+" : ""}${r.intraday.dropFromOpenPct.toFixed(2)}%` : "—"}
          tone={r.intraday && r.intraday.dropFromOpenPct < 0 ? "red" : "green"}
        />
        <IndicatorCell
          label="Setup"
          value={`${r.setupQuality}%`}
          tone={r.setupQuality >= 65 ? "green" : r.setupQuality >= 40 ? "neutral" : "red"}
        />
        <IndicatorCell
          label="Execution"
          value={`${r.executionConfidence}%`}
          tone={r.executionConfidence >= 65 ? "green" : r.executionConfidence >= 40 ? "neutral" : "red"}
        />
      </div>

      {(() => {
        const narrative = r.analog ? narrativeFrom(r.analog, r.price) : null;
        const biasCls =
          narrative?.bias === "wait"
            ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
            : narrative?.bias === "buy_now"
              ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-200"
              : "border-slate-700 bg-slate-800/30 text-slate-300";
        return (
          <>
            {narrative && (
              <div className={`rounded border ${biasCls} p-2.5 space-y-1.5`}>
                <div className="text-[9px] uppercase tracking-wider font-mono opacity-80 flex items-center gap-1">
                  <ArrowRight className="h-3 w-3" /> Historical analog probability
                </div>
                <div className="text-[11px] font-semibold leading-snug">{narrative.headline}</div>
                <ul className="text-[10.5px] leading-snug space-y-0.5 opacity-95">
                  {narrative.bullets.map((b, i) => <li key={i}>• {b}</li>)}
                </ul>
                <div className="text-[9px] italic opacity-70 pt-0.5">{narrative.disclaimer}</div>
              </div>
            )}
            {r.adaptiveLadder.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[9px] uppercase tracking-wider text-cyan-400 font-mono flex items-center gap-1">
                  <ArrowRight className="h-3 w-3" /> Adaptive ladder
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {r.adaptiveLadder.map((rung, i) => {
                    const note = r.analog ? rungProbabilityNote(rung, r.analog, r.price) : null;
                    const chip = r.analog ? rungProbabilityChip(rung, r.analog, r.price) : null;
                    return (
                      <div key={i} className="rounded border border-slate-800 bg-[#0f1524] px-2.5 py-1.5 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-cyan-300 font-bold w-9">{Math.round(rung.pct * 100)}%</span>
                            <span className="text-slate-300 truncate">{rung.label}</span>
                          </div>
                          <span className="font-mono text-slate-200">${rung.price.toFixed(2)}</span>
                        </div>
                        {chip && (
                          <div className="flex flex-wrap gap-1 pl-11 text-[9px] font-mono">
                            <span className="rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 px-1.5 py-0.5">reach {chip.reachedPct}%</span>
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 px-1.5 py-0.5">recover {chip.recoverPct}%</span>
                            <span className="rounded border border-rose-500/30 bg-rose-500/10 text-rose-200 px-1.5 py-0.5">stop {chip.stopPct}%</span>
                            <span className="text-slate-500">n={chip.sample}</span>
                          </div>
                        )}
                        {note && (
                          <div className="text-[10px] text-slate-400 leading-snug pl-11">{note}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {hasDetails && (
        <div className="pt-1 border-t border-slate-800/60">
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="w-full text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-cyan-300 transition py-1.5 flex items-center justify-center gap-1.5"
          >
            {showDetails ? "Hide details ▲" : "Show details ▼"}
          </button>

          {showDetails && (
            <div className="space-y-3 pt-2">
              <p className="text-[10px] text-slate-500 italic leading-snug">{ss.blurb}</p>
              {r.marketContextNote && (
                <p className="text-[10px] text-slate-500 leading-snug">{r.marketContextNote}</p>
              )}

              <div className="rounded border border-slate-800 bg-[#0b0f1a] p-2.5 space-y-1.5">
                <div className="text-[9px] uppercase tracking-wider text-slate-500 font-mono">Status reason</div>
                <div className="text-[11px] text-slate-300 leading-snug">{r.statusReason}</div>
              </div>

              {(r.setupFactors.positive.length > 0 || r.setupFactors.negative.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {r.setupFactors.positive.length > 0 && (
                    <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2 space-y-1">
                      <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-mono">Setup +</div>
                      <ul className="text-[10px] text-emerald-200/90 space-y-0.5">
                        {r.setupFactors.positive.map((f, i) => <li key={i}>• {f}</li>)}
                      </ul>
                    </div>
                  )}
                  {r.setupFactors.negative.length > 0 && (
                    <div className="rounded border border-rose-500/20 bg-rose-500/5 p-2 space-y-1">
                      <div className="text-[9px] uppercase tracking-wider text-rose-400 font-mono">Setup −</div>
                      <ul className="text-[10px] text-rose-200/90 space-y-0.5">
                        {r.setupFactors.negative.map((f, i) => <li key={i}>• {f}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {(r.executionFactors.positive.length > 0 || r.executionFactors.negative.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {r.executionFactors.positive.length > 0 && (
                    <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2 space-y-1">
                      <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-mono">Execution +</div>
                      <ul className="text-[10px] text-emerald-200/90 space-y-0.5">
                        {r.executionFactors.positive.map((f, i) => <li key={i}>• {f}</li>)}
                      </ul>
                    </div>
                  )}
                  {r.executionFactors.negative.length > 0 && (
                    <div className="rounded border border-rose-500/20 bg-rose-500/5 p-2 space-y-1">
                      <div className="text-[9px] uppercase tracking-wider text-rose-400 font-mono">Execution −</div>
                      <ul className="text-[10px] text-rose-200/90 space-y-0.5">
                        {r.executionFactors.negative.map((f, i) => <li key={i}>• {f}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {r.decisionPath.length > 0 && (
                <div className="rounded border border-slate-800 bg-[#0b0f1a] p-2.5 space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-mono">Decision path</div>
                  <ul className="space-y-0.5">
                    {r.decisionPath.map((step, i) => (
                      <li key={i} className={`text-[11px] font-mono flex items-center gap-1.5 ${step.done ? "text-emerald-300" : "text-slate-500"}`}>
                        <span className="w-3">{step.done ? "✓" : "○"}</span>
                        <span>{step.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(r.status === "WATCH" || r.status === "PROBE") && r.watchingFor.length > 0 && (
                <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-amber-400 font-mono flex items-center gap-1">
                    <RotateCcw className="h-3 w-3" /> Watching for
                  </div>
                  <ul className="text-[11px] text-slate-300 space-y-0.5 pl-3 list-disc marker:text-amber-500/60">
                    {r.watchingFor.slice(0, 3).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveRegimePanel({

  rows,
  spyChangePct,
  focusedSymbol,
  onToggleFocus,
}: {
  rows: ScanRow[];
  spyChangePct: number | null;
  focusedSymbol: string | null;
  onToggleFocus: (symbol: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const actionable = rows.filter((r) => r.status === "BUY_STARTER" || r.status === "BUY_LADDER" || r.status === "PROBE");
  const broadWeak = spyChangePct !== null && spyChangePct < -0.5;
  const calm = actionable.length === 0 && !broadWeak;

  if (calm && !expanded) {
    const worst = rows.reduce((a, b) => (a.change1d < b.change1d ? a : b), rows[0]);
    return (
      <Card className="border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-950/20 to-[#0b0f1a]">
        <CardContent className="p-5 sm:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
            <span className="text-[10px] uppercase tracking-[0.25em] text-emerald-300 font-mono font-bold">
              Market Status
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-300 leading-tight">
            All calm — nothing to buy right now.
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            Nothing is meaningfully down.
            {spyChangePct !== null && (
              <> SPY is <span className="font-mono text-emerald-300">{spyChangePct >= 0 ? "+" : ""}{spyChangePct.toFixed(2)}%</span>.</>
            )}{" "}
            Biggest mover today: <span className="font-mono text-slate-100">{worst.symbol}</span>{" "}
            <span className={`font-mono ${worst.change1d < 0 ? "text-rose-300" : "text-emerald-300"}`}>
              {worst.change1d >= 0 ? "+" : ""}{worst.change1d.toFixed(2)}%
            </span>. Sit on hands until a real dip shows up.
          </p>
          <div className="pt-1">
            <button
              onClick={() => setExpanded(true)}
              className="text-[11px] font-mono uppercase tracking-wider text-slate-500 hover:text-cyan-300 transition"
            >
              Show technical detail →
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-cyan-500/30 bg-gradient-to-br from-[#0f1524] to-[#0b0f1a]">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-cyan-400 animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.25em] text-cyan-300 font-mono font-bold">
              Live Regime · Intraday Analysis
            </span>
          </div>
          <div className="flex items-center gap-2">
            {spyChangePct !== null && (
              <Badge variant="outline" className="border-slate-700 bg-[#0b0f1a] text-[10px] font-mono">
                SPY {spyChangePct >= 0 ? "+" : ""}{spyChangePct.toFixed(2)}%
                <span className={`ml-1.5 ${spyChangePct < -0.5 ? "text-rose-400" : spyChangePct > 0.2 ? "text-emerald-400" : "text-slate-400"}`}>
                  {spyChangePct < -0.5 ? "· broad weakness" : spyChangePct > 0.2 ? "· broad strength" : "· mixed"}
                </span>
              </Badge>
            )}
            {calm && (
              <button
                onClick={() => setExpanded(false)}
                className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-cyan-300 transition"
              >
                Hide detail
              </button>
            )}
          </div>
        </div>


        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((r) => {
            const rs = REGIME_STYLES[r.regime];
            const ss = STATUS_STYLES[r.status];
            const isFocused = focusedSymbol === r.symbol;
            return (
              <SymbolCard
                key={r.symbol}
                r={r}
                rs={rs}
                ss={ss}
                isFocused={isFocused}
                onToggleFocus={onToggleFocus}
              />
            );
          })}
        </div>

      </CardContent>
    </Card>
  );
}

