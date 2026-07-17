import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listPositionsFn,
  upsertPositionFn,
  deletePositionFn,
  getSettingsFn,
  updateSettingsFn,
} from "./positions.functions";
import {
  DEFAULT_POSITION_SETTINGS as DEFAULT_SETTINGS,
  type FillEntry,
  type Position,
  type PositionMap,
  type PositionSettings,
} from "./positions-shared";
import type { LadderRung } from "./speed-mode";

export type { FillEntry, Position, PositionMap, PositionSettings } from "./positions-shared";

const POS_KEY = "qs_positions_v2";
const SET_KEY = "qs_position_settings_v2";

// ─── Storage helpers ─────────────
function readPositions(): PositionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as PositionMap) : {};
  } catch {
    return {};
  }
}
function writePositions(m: PositionMap) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(POS_KEY, JSON.stringify(m)); } catch { /* quota */ }
}
function readSettings(): PositionSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SET_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function writeSettings(s: PositionSettings) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

// ─── Shared external store ─────────────
// CRITICAL: A single source of truth for every hook instance. Previously each
// call to usePositions() kept its own useState copy; when one component saved a
// manual fill, other instances still held stale state and their next update
// wrote the stale copy back to localStorage — silently wiping the user's edits
// on reload. useSyncExternalStore keeps every consumer in lockstep.
let positionsState: PositionMap = {};
let settingsState: PositionSettings = DEFAULT_SETTINGS;
let hydratedFlag = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function hydrateOnce() {
  if (hydratedFlag || typeof window === "undefined") return;
  positionsState = readPositions();
  settingsState = readSettings();
  hydratedFlag = true;
  emit();
  // Kick off cloud sync in the background — non-blocking.
  syncFromCloud();
}

// ─── Cloud sync ─────────────
let cloudReady = false;
let currentUserId: string | null = null;

async function syncFromCloud() {
  if (typeof window === "undefined") return;
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id ?? null;
    currentUserId = uid;
    if (!uid) { cloudReady = false; return; }
    const [cloudPositions, cloudSettings] = await Promise.all([
      listPositionsFn(),
      getSettingsFn(),
    ]);
    // If cloud is empty but we have local data → one-time migration upload.
    if (Object.keys(cloudPositions).length === 0 && Object.keys(positionsState).length > 0) {
      await Promise.allSettled(
        Object.values(positionsState).map((p) => upsertPositionFn({ data: p })),
      );
      cloudReady = true;
      // keep local as-is; DB now matches
    } else {
      positionsState = cloudPositions;
      writePositions(cloudPositions);
    }
    settingsState = cloudSettings;
    writeSettings(cloudSettings);
    cloudReady = true;
    emit();
  } catch (e) {
    console.warn("[positions] cloud sync failed", e);
  }
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
      syncFromCloud();
    }
  });
}

function pushPositionToCloud(p: Position) {
  if (!cloudReady || !currentUserId) return;
  upsertPositionFn({ data: p }).catch((e) => console.warn("[positions] upsert failed", e));
}
function deletePositionFromCloud(symbol: string) {
  if (!cloudReady || !currentUserId) return;
  deletePositionFn({ data: { symbol } }).catch((e) => console.warn("[positions] delete failed", e));
}
function pushSettingsToCloud(s: PositionSettings) {
  if (!cloudReady || !currentUserId) return;
  updateSettingsFn({ data: s }).catch((e) => console.warn("[positions] settings failed", e));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === POS_KEY) {
      positionsState = readPositions();
      emit();
    } else if (e.key === SET_KEY) {
      settingsState = readSettings();
      emit();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

function getPositions() { return positionsState; }
function getSettings() { return settingsState; }
const EMPTY_POS: PositionMap = {};
function getServerPositions() { return EMPTY_POS; }
function getServerSettings() { return DEFAULT_SETTINGS; }

function updatePositions(fn: (prev: PositionMap) => PositionMap) {
  // Guarantee we start from the latest persisted value even if hydration
  // hasn't run yet in this instance — this is what prevents stale-state
  // clobbers between hook consumers.
  if (!hydratedFlag) hydrateOnce();
  const next = fn(positionsState);
  if (next === positionsState) return;
  // Detect removed & changed symbols to push to cloud.
  const prev = positionsState;
  positionsState = next;
  writePositions(next);
  emit();
  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));
  for (const k of prevKeys) if (!nextKeys.has(k)) deletePositionFromCloud(k);
  for (const k of nextKeys) {
    if (prev[k] !== next[k]) pushPositionToCloud(next[k]);
  }
}
function updateSettings(fn: (prev: PositionSettings) => PositionSettings) {
  if (!hydratedFlag) hydrateOnce();
  const next = fn(settingsState);
  if (next === settingsState) return;
  settingsState = next;
  writeSettings(next);
  emit();
  pushSettingsToCloud(next);
}

// ─── Hook ─────────────
export function usePositions() {
  const positions = useSyncExternalStore(subscribe, getPositions, getServerPositions);
  const settings = useSyncExternalStore(subscribe, getSettings, getServerSettings);
  const [isHydrated, setIsHydrated] = useState(hydratedFlag);

  useEffect(() => {
    hydrateOnce();
    if (!isHydrated) setIsHydrated(true);
  }, [isHydrated]);

  const setSetting = useCallback((k: keyof PositionSettings, v: boolean) => {
    updateSettings((prev) => ({ ...prev, [k]: v }));
  }, []);

  const markFilled = useCallback(
    (
      symbol: string,
      entry: Omit<FillEntry, "filledAt"> & { filledAt?: string },
      meta: { totalCapital: number; scenario: string; plannedLadder?: LadderRung[] },
    ) => {
      updatePositions((prev) => {
        const existing =
          prev[symbol] ??
          ({
            symbol,
            totalCapital: meta.totalCapital,
            scenario: meta.scenario,
            createdAt: new Date().toISOString(),
            entries: [],
            plannedLadder: meta.plannedLadder,
          } as Position);
        const filledAt = entry.filledAt ?? new Date().toISOString();
        const plannedLadder =
          existing.plannedLadder ?? meta.plannedLadder ?? undefined;
        // Upsert by day — overwrite any existing fill for the same rung so
        // callers can correct mistakes without a separate edit path.
        const others = existing.entries.filter((e) => e.day !== entry.day);
        return {
          ...prev,
          [symbol]: {
            ...existing,
            plannedLadder,
            entries: [...others, { ...entry, filledAt }],
          },
        };
      });
    },
    [],
  );

  const removeFill = useCallback((symbol: string, day: number) => {
    updatePositions((prev) => {
      const existing = prev[symbol];
      if (!existing) return prev;
      const entries = existing.entries.filter((e) => e.day !== day);
      const next: PositionMap = { ...prev };
      if (entries.length === 0) delete next[symbol];
      else next[symbol] = { ...existing, entries };
      return next;
    });
  }, []);

  const resetPosition = useCallback((symbol: string) => {
    updatePositions((prev) => {
      if (!prev[symbol]) return prev;
      const { [symbol]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  return { positions, hydrated: isHydrated, settings, setSetting, markFilled, removeFill, resetPosition };
}
