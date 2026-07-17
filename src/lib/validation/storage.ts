// Persistence for validation runs (localStorage, sandbox-only).
// Prefix "validation.*" — no writes touch any live app data.

import type { ScannerConfig } from "./config";
import type { SuiteMetrics } from "./metrics";
import { HISTORY_KEY } from "./config";

export type RunVerdict = "promoted" | "rejected" | "champion_baseline";

export type StoredRun = {
  id: string;
  ranAt: number;
  config: ScannerConfig;
  configHash: string;
  metrics: SuiteMetrics;
  verdict: RunVerdict;
  reasons: string[];
  championHashAtRun: string;
};

export function loadHistory(): StoredRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredRun[];
  } catch {
    return [];
  }
}

export function saveHistory(runs: StoredRun[]) {
  if (typeof window === "undefined") return;
  // Keep last 40 runs to bound storage.
  const trimmed = runs.slice(0, 40);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export function appendRun(run: StoredRun): StoredRun[] {
  const existing = loadHistory();
  const next = [run, ...existing];
  saveHistory(next);
  return next;
}
