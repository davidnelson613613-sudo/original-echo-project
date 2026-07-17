// Track record: log every scan signal to localStorage, retroactively score
// outcomes 3d/5d later using the live prices from subsequent scans.

export type SignalLog = {
  id: string; // dedupe key: symbol:YYYY-MM-DD:regime
  symbol: string;
  regime: string;
  regimeLabel: string;
  scenario: string;
  price: number;
  confidence: number;
  at: string; // ISO
  outcome1d?: number; // % change vs entry
  outcome3d?: number;
  outcome5d?: number;
};

const KEY = "qs_track_record_v1";
const MAX_ENTRIES = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export function loadLog(): SignalLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SignalLog[]) : [];
  } catch {
    return [];
  }
}

function saveLog(log: SignalLog[]) {
  if (typeof window === "undefined") return;
  const trimmed = log.slice(-MAX_ENTRIES);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Quota — silently drop.
  }
}

export type SignalInput = {
  symbol: string;
  regime: string;
  regimeLabel: string;
  scenarioKey: string;
  price: number;
  confidence: number;
};

export function logSignals(rows: SignalInput[], now: number = Date.now()): void {
  if (rows.length === 0) return;
  const log = loadLog();
  const dayStr = new Date(now).toISOString().slice(0, 10);
  let added = 0;
  for (const r of rows) {
    if (r.regime === "NO_DIP") continue;
    const id = `${r.symbol}:${dayStr}:${r.regime}`;
    if (log.some((e) => e.id === id)) continue;
    log.push({
      id,
      symbol: r.symbol,
      regime: r.regime,
      regimeLabel: r.regimeLabel,
      scenario: r.scenarioKey,
      price: r.price,
      confidence: r.confidence,
      at: new Date(now).toISOString(),
    });
    added++;
  }
  if (added > 0) saveLog(log);
}

export function scoreOutcomes(
  currentPrices: Record<string, number>,
  now: number = Date.now(),
): SignalLog[] {
  const log = loadLog();
  let changed = false;
  for (const e of log) {
    const cp = currentPrices[e.symbol];
    if (!cp) continue;
    const age = now - new Date(e.at).getTime();
    const pct = ((cp - e.price) / e.price) * 100;
    if (age >= 1 * DAY_MS && e.outcome1d === undefined) {
      e.outcome1d = pct;
      changed = true;
    }
    if (age >= 3 * DAY_MS && e.outcome3d === undefined) {
      e.outcome3d = pct;
      changed = true;
    }
    if (age >= 5 * DAY_MS && e.outcome5d === undefined) {
      e.outcome5d = pct;
      changed = true;
    }
  }
  if (changed) saveLog(log);
  return log;
}

export type RegimeStats = {
  regime: string;
  regimeLabel: string;
  total: number;
  scored3d: number;
  win3d: number;
  avg3d: number;
  scored5d: number;
  win5d: number;
  avg5d: number;
  hitRate3d: number; // 0-100
  hitRate5d: number;
};

export function computeStats(log: SignalLog[]): RegimeStats[] {
  const map = new Map<string, RegimeStats>();
  for (const e of log) {
    const key = e.regime;
    const cur =
      map.get(key) ??
      {
        regime: e.regime,
        regimeLabel: e.regimeLabel,
        total: 0,
        scored3d: 0,
        win3d: 0,
        avg3d: 0,
        scored5d: 0,
        win5d: 0,
        avg5d: 0,
        hitRate3d: 0,
        hitRate5d: 0,
      };
    cur.total++;
    if (e.outcome3d !== undefined) {
      cur.scored3d++;
      cur.avg3d += e.outcome3d;
      if (e.outcome3d > 0) cur.win3d++;
    }
    if (e.outcome5d !== undefined) {
      cur.scored5d++;
      cur.avg5d += e.outcome5d;
      if (e.outcome5d > 0) cur.win5d++;
    }
    map.set(key, cur);
  }
  return Array.from(map.values()).map((s) => ({
    ...s,
    avg3d: s.scored3d ? s.avg3d / s.scored3d : 0,
    avg5d: s.scored5d ? s.avg5d / s.scored5d : 0,
    hitRate3d: s.scored3d ? (s.win3d / s.scored3d) * 100 : 0,
    hitRate5d: s.scored5d ? (s.win5d / s.scored5d) * 100 : 0,
  }));
}

export function clearLog() {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
}