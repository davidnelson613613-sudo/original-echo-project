// Runtime bridge between the app UI (Terminal) and the AI bubble.
// The Terminal registers the live scan snapshot + local app state; the
// bubble reads them to build read-only system-prompt context.

import type { ScanResult } from "@/lib/market.functions";
import type { PositionMap, PositionSettings } from "@/lib/positions";
import type { SpeedMode } from "@/lib/speed-mode";

export type AppSnapshot = {
  scan: ScanResult | null;
  scanLoading: boolean;
  scanError: string | null;
  positions: PositionMap;
  posSettings: PositionSettings;
  capital: number;
  fractional: boolean;
  marketOpen: boolean;
  speedMode: SpeedMode;
};

export type AppActions = {
  rescan: () => Promise<{ ok: boolean; message?: string }>;
  resetPosition: (symbol: string) => { ok: boolean; message?: string };
  setAutoFill: (on: boolean) => void;
  setRecoveryCapture: (on: boolean) => void;
  setCapital: (n: number) => void;
  setFractional: (on: boolean) => void;
  setSpeedMode: (m: SpeedMode) => void;
  openLiveRegime?: () => void;
};


// ---------------------------------------------------------------------------
// Capability registry — a living catalog of app features the AI assistant
// can explain and (when permitted) guide the user through. Features register
// themselves at module load so the bubble automatically picks them up as new
// pages / panels / workflows come online.
// ---------------------------------------------------------------------------

export type Capability = {
  id: string;
  name: string;
  description: string;
  routes: string[];            // routes where this capability lives
  actions: string[];           // action ids from AppActions or route names
  tags: string[];              // free-form tags used for retrieval
  since?: string;              // ISO date the capability was added (optional)
};

const listeners = new Set<() => void>();
const SAVED_SCAN_KEY = "qs_latest_scan_snapshot_v1";
let snapshot: AppSnapshot = {
  scan: null,
  scanLoading: false,
  scanError: null,
  positions: {},
  posSettings: { autoFill: false, recoveryCapture: true },
  capital: 5000,
  fractional: false,
  marketOpen: false,
  speedMode: "balanced",
};
let actions: AppActions | null = null;
let navigator: ((path: string) => void) | null = null;
const capabilities = new Map<string, Capability>();

export function publishSnapshot(next: AppSnapshot) {
  snapshot = next;
  if (typeof window !== "undefined" && next.scan?.rows?.length) {
    try {
      window.localStorage.setItem(
        SAVED_SCAN_KEY,
        JSON.stringify({ savedAt: new Date().toISOString(), scan: next.scan }),
      );
    } catch {
      /* ignore storage quota */
    }
  }
  listeners.forEach((l) => l());
}

export function readSavedScanSnapshot(): { savedAt: string; scan: ScanResult } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SAVED_SCAN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: string; scan?: ScanResult };
    if (!parsed.scan || !Array.isArray(parsed.scan.rows)) return null;
    return { savedAt: parsed.savedAt ?? parsed.scan.scannedAt, scan: parsed.scan };
  } catch {
    return null;
  }
}
export function registerActions(a: AppActions) {
  actions = a;
}
export function registerNavigator(fn: (path: string) => void) {
  navigator = fn;
}
export function getNavigator() {
  return navigator;
}
export function getSnapshot(): AppSnapshot {
  return snapshot;
}
export function getActions(): AppActions | null {
  return actions;
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Deep context readers — pull rich local state so the AI can reason about
// anything this browser has produced across every feature.
export function getDeepContext() {
  if (typeof window === "undefined") return {};
  const read = <T>(k: string, fallback: T): T => {
    try {
      const raw = window.localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const trackRecord = read<unknown[]>("qs_track_record_v1", []);
  const validationHistory = read<unknown[]>("validation.history.v1", []);
  const champion = read<unknown>("validation.champion.v1", null);
  const threads = read<unknown[]>("qs_ai_bubble_threads_v1", []);
  const savedScan = readSavedScanSnapshot();
  return {
    latestBrowserScan: savedScan
      ? {
          savedAt: savedScan.savedAt,
          scannedAt: savedScan.scan.scannedAt,
          spyChangePct: savedScan.scan.spyChangePct,
          rowCount: savedScan.scan.rows.length,
          failed: savedScan.scan.failed,
          rows: savedScan.scan.rows,
        }
      : null,
    trackRecordRecent: Array.isArray(trackRecord) ? trackRecord.slice(-30) : [],
    trackRecordCount: Array.isArray(trackRecord) ? trackRecord.length : 0,
    validationHistoryRecent: Array.isArray(validationHistory) ? validationHistory.slice(0, 8) : [],
    validationHistoryCount: Array.isArray(validationHistory) ? validationHistory.length : 0,
    validationChampion: champion,
    threadCount: Array.isArray(threads) ? threads.length : 0,
  };
}

export function registerCapability(cap: Capability) {
  capabilities.set(cap.id, cap);
  listeners.forEach((l) => l());
}
export function listCapabilities(): Capability[] {
  return Array.from(capabilities.values());
}
export function describeCapability(id: string): Capability | null {
  return capabilities.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Baseline capability catalog — registered eagerly so the AI assistant has
// full app awareness from first load. New features should call
// `registerCapability` from their own module to auto-extend this catalog.
// ---------------------------------------------------------------------------

registerCapability({
  id: "scanner",
  name: "Live Pattern Scanner",
  description:
    "Scores NDX, QQQ, SMH, SOXX, SOXQ for dip-buy opportunities using regime detection, ATR-scaled ladders, and adaptive recommendations. SPY is fetched for market context only.",
  routes: ["/"],
  actions: ["rescan"],
  tags: ["scan", "recommend", "regime", "signals"],
});
registerCapability({
  id: "positions",
  name: "Positions & Auto-Fill",
  description:
    "Tracks saved buy-ladder plans per symbol. Supports Auto-Fill (record fills when scan-time price crosses a rung) and Recovery Capture (fill remaining rungs after a partial fill and quick rebound).",
  routes: ["/"],
  actions: ["resetPosition", "setAutoFill", "setRecoveryCapture", "setCapital", "setFractional"],
  tags: ["position", "ladder", "fill", "capital"],
});
registerCapability({
  id: "historical-analog",
  name: "Historical Analog Panel",
  description:
    "Finds the closest historical setup for the current symbol using engineered features (RSI, ATR, drawdowns, relative strength, moving-average distance, correlation with SPY). Explains why the analog was picked.",
  routes: ["/"],
  actions: [],
  tags: ["analog", "pattern", "similarity", "history"],
});
registerCapability({
  id: "track-record",
  name: "Signal Track Record",
  description:
    "Local log of scanner signals with outcomes. Used to review how signals played out over time — stored in this browser only.",
  routes: ["/"],
  actions: [],
  tags: ["track", "history", "signals"],
});
registerCapability({
  id: "csv-export",
  name: "CSV Export",
  description:
    "Exports the current scan + ladder tables as CSV for offline analysis.",
  routes: ["/"],
  actions: [],
  tags: ["export", "csv"],
});
registerCapability({
  id: "speed-mode",
  name: "Speed Mode",
  description:
    "Trades cache freshness for latency: fast (aggressive cache), balanced (default), fresh (bypass cache). Configurable from the top menu.",
  routes: ["/"],
  actions: ["setSpeedMode"],
  tags: ["performance", "cache"],
});
registerCapability({
  id: "sandbox-simulation",
  name: "Simulation & Testing Sandbox",
  description:
    "Fully isolated environment for exercising the scanner against synthetic scenarios, historical replays, and sensitivity sweeps. Never touches production data or caches.",
  routes: ["/simulation"],
  actions: [],
  tags: ["sandbox", "simulation", "replay", "testing"],
});
registerCapability({
  id: "ai-validation",
  name: "AI Validation & Optimization",
  description:
    "Continuous quality-control system for the pattern scanner. Runs multi-scenario historical replay under strict no-look-ahead, computes accuracy / calibration / stability metrics, generates challenger configs, and only promotes changes that pass a regression gate. Sandbox-only.",
  routes: ["/simulation/validation"],
  actions: [],
  tags: ["validation", "optimization", "champion", "challenger", "calibration", "regression"],
});
registerCapability({
  id: "assistant",
  name: "AI Assistant Bubble",
  description:
    "This assistant. Explains any feature, reads visible app text, cites live scanner state, positions, settings, and saved scan data. It is read-only and does not control the app.",
  routes: ["*"],
  actions: [],
  tags: ["assistant", "chat", "help"],
});
