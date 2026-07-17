// Lazy wrappers + per-panel skeletons for the heavy widgets used inside
// the authenticated terminal route. Each panel is code-split out of the
// main terminal chunk so the initial JS the user has to parse to *see*
// the ladder is much smaller. Panels stream in behind matched-shape
// skeletons so the layout never jumps.
//
// The exported `preload*` functions are used by the root idle-preloader
// to warm these chunks in the background — the first time the user
// scrolls to a panel, it's already in cache.

import { lazy, Suspense, type ComponentProps } from "react";
import type { HistoricalAnalogPanel as HistoricalAnalogPanelT } from "@/components/HistoricalAnalogPanel";
import type { PositionsPanel as PositionsPanelT } from "@/components/PositionsPanel";
import type { TrackRecordPanel as TrackRecordPanelT } from "@/components/TrackRecordPanel";
import type { ManualFillDialog as ManualFillDialogT } from "@/components/ManualFillDialog";

export type { ManualFillTranche, ExistingFill } from "@/components/ManualFillDialog";

// ── Lazy imports ─────────────────────────────────────────────────────────
const importHistoricalAnalog = () =>
  import("@/components/HistoricalAnalogPanel").then((m) => ({ default: m.HistoricalAnalogPanel }));
const importPositions = () =>
  import("@/components/PositionsPanel").then((m) => ({ default: m.PositionsPanel }));
const importTelegram = () =>
  import("@/components/TelegramAlertsPanel").then((m) => ({ default: m.TelegramAlertsPanel }));
const importTrackRecord = () =>
  import("@/components/TrackRecordPanel").then((m) => ({ default: m.TrackRecordPanel }));
const importManualFill = () =>
  import("@/components/ManualFillDialog").then((m) => ({ default: m.ManualFillDialog }));

const LazyHistoricalAnalog = lazy(importHistoricalAnalog);
const LazyPositions = lazy(importPositions);
const LazyTelegram = lazy(importTelegram);
const LazyTrackRecord = lazy(importTrackRecord);
const LazyManualFill = lazy(importManualFill);

// Fire-and-forget warmers used by the root idle-preloader.
export function preloadTerminalPanels(): void {
  void importHistoricalAnalog().catch(() => {});
  void importPositions().catch(() => {});
  void importTelegram().catch(() => {});
  void importTrackRecord().catch(() => {});
  void importManualFill().catch(() => {});
}

// ── Matched-shape skeletons ──────────────────────────────────────────────
function CardSkeleton({ h = "h-40" }: { h?: string }) {
  return (
    <div
      className={`w-full rounded-2xl border border-slate-800/60 bg-slate-900/40 animate-pulse shimmer ${h}`}
      aria-hidden
    />
  );
}

function HistoricalAnalogSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4 animate-pulse shimmer">
        <div className="h-4 w-40 rounded bg-slate-800/70" />
        <div className="mt-3 h-8 w-2/3 rounded bg-slate-800/70" />
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full rounded bg-slate-800/50" />
          <div className="h-3 w-11/12 rounded bg-slate-800/50" />
          <div className="h-3 w-3/4 rounded bg-slate-800/40" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="h-10 rounded bg-slate-800/50" />
          <div className="h-10 rounded bg-slate-800/50" />
          <div className="h-10 rounded bg-slate-800/50" />
        </div>
      </div>
    </div>
  );
}

function PositionsSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4 animate-pulse shimmer" aria-hidden>
      <div className="h-4 w-32 rounded bg-slate-800/70" />
      <div className="mt-3 space-y-2">
        <div className="h-8 w-full rounded bg-slate-800/50" />
        <div className="h-8 w-full rounded bg-slate-800/40" />
      </div>
    </div>
  );
}

function TelegramSkeleton() {
  return <CardSkeleton h="h-20" />;
}

function TrackRecordSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4 animate-pulse shimmer" aria-hidden>
      <div className="h-4 w-40 rounded bg-slate-800/70" />
      <div className="mt-3 grid grid-cols-4 gap-2">
        <div className="h-10 rounded bg-slate-800/50" />
        <div className="h-10 rounded bg-slate-800/50" />
        <div className="h-10 rounded bg-slate-800/50" />
        <div className="h-10 rounded bg-slate-800/50" />
      </div>
    </div>
  );
}

// ── Exported wrappers ────────────────────────────────────────────────────
export function HistoricalAnalogPanelLazy(props: ComponentProps<typeof HistoricalAnalogPanelT>) {
  return (
    <Suspense fallback={<HistoricalAnalogSkeleton />}>
      <LazyHistoricalAnalog {...props} />
    </Suspense>
  );
}

export function PositionsPanelLazy(props: ComponentProps<typeof PositionsPanelT>) {
  return (
    <Suspense fallback={<PositionsSkeleton />}>
      <LazyPositions {...props} />
    </Suspense>
  );
}

export function TelegramAlertsPanelLazy() {
  return (
    <Suspense fallback={<TelegramSkeleton />}>
      <LazyTelegram />
    </Suspense>
  );
}

const LazyAlertHistory = lazy(() =>
  import("@/components/AlertHistoryPanel").then((m) => ({ default: m.AlertHistoryPanel })),
);
export function AlertHistoryPanelLazy() {
  return (
    <Suspense fallback={<TelegramSkeleton />}>
      <LazyAlertHistory />
    </Suspense>
  );
}

export function TrackRecordPanelLazy(props: ComponentProps<typeof TrackRecordPanelT>) {
  return (
    <Suspense fallback={<TrackRecordSkeleton />}>
      <LazyTrackRecord {...props} />
    </Suspense>
  );
}

export function ManualFillDialogLazy(props: ComponentProps<typeof ManualFillDialogT>) {
  // Dialog UI: while the module streams in, render nothing (there's no
  // visible surface until the user opens it). Preload on idle keeps the
  // first open snappy.
  return (
    <Suspense fallback={null}>
      <LazyManualFill {...props} />
    </Suspense>
  );
}
