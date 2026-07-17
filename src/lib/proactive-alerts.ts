import { toast } from "sonner";
import type { ScanRow } from "./market.functions";

// Client-side toast/chime only. All Telegram delivery is server-driven now
// (see src/lib/telegram-notify.server.ts + scan-runner broadcasters), so we
// no longer fan out per-user Telegram sends from the browser.
function fireTelegram(_kind: "APPROACHING_BUY" | "AT_BUY_ZONE", _message: string) {
  /* intentionally empty */
}


export type AlertEvent = {
  id: string;
  symbol: string;
  kind:
    | "REGIME_CHANGE"
    | "STATUS_ARMED"
    | "MOMENTUM_BREAK"
    | "SHALLOW_DIP"
    | "PRICE_THRESHOLD"
    | "APPROACHING_BUY"
    | "AT_BUY_ZONE";
  from?: string;
  to: string;
  message: string;
  at: string;
};

const KEY = "qs_alerts_v1";
const MAX = 100;

// Level-triggered price alerts fire once per (symbol, threshold, session).
// We reset overnight based on the ET trading date so a re-open doesn't
// re-fire yesterday's crossings.
const LEVEL_KEY = "qs_price_levels_v1";
// Thresholds are negative day/session moves in %. Ordered deepest → shallowest.
const PRICE_THRESHOLDS = [-5, -3, -2] as const;

type LevelState = { date: string; fired: Record<string, true> };

function etTradingDate(): string {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.toISOString().slice(0, 10);
}

function loadLevelState(): LevelState {
  if (typeof window === "undefined") return { date: etTradingDate(), fired: {} };
  try {
    const raw = window.localStorage.getItem(LEVEL_KEY);
    if (!raw) return { date: etTradingDate(), fired: {} };
    const parsed = JSON.parse(raw) as LevelState;
    if (parsed.date !== etTradingDate()) return { date: etTradingDate(), fired: {} };
    return parsed;
  } catch {
    return { date: etTradingDate(), fired: {} };
  }
}

function saveLevelState(s: LevelState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEVEL_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadAlerts(): AlertEvent[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "[]") as AlertEvent[];
  } catch {
    return [];
  }
}

function saveAlerts(a: AlertEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX)));
  } catch {
    /* ignore */
  }
}

export function clearAlerts() {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
}

function playChime(freq = 880, dur = 0.25, gain = 0.06) {
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.frequency.exponentialRampToValueAtTime(freq / 2, ctx.currentTime + dur);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.stop(ctx.currentTime + dur + 0.05);
  } catch {
    /* ignore */
  }
}

// Diff previous vs current scan, emit toast + persist an event log.
export function diffAndAlert(
  prev: ScanRow[] | null,
  curr: ScanRow[],
  now: number = Date.now(),
): AlertEvent[] {
  const events: AlertEvent[] = [];

  // ── Level-triggered price alerts ──
  // These fire regardless of regime/status transitions, once per threshold
  // per (symbol, trading day). Both daily change and intraday drop-from-open
  // are checked; whichever crossed deeper triggers.
  const state = loadLevelState();
  const nowIsoLevel = new Date(now).toISOString();
  for (const r of curr) {
    const daily = r.change1d ?? 0;
    // A green/flat name is not a dip, even if it pulled back from the open.
    // This keeps alerts aligned with the scanner's hard green-day guard.
    if (daily >= -0.05) continue;
    const intraday = r.intraday?.dropFromOpenPct ?? 0;
    const worst = Math.min(daily, intraday); // most negative
    for (const t of PRICE_THRESHOLDS) {
      if (worst > t) continue; // hasn't reached this depth yet
      const key = `${r.symbol}|${t}`;
      if (state.fired[key]) continue;
      state.fired[key] = true;
      const magnitude = Math.abs(t);
      const source = daily <= intraday ? "day" : "intraday";
      const value = source === "day" ? daily : intraday;
      const msg = `${r.symbol} ${value.toFixed(1)}% ${source === "day" ? "on the day" : "from open"} (crossed ${t}%)`;
      events.push({
        id: `${r.symbol}-lvl${t}-${now}`,
        symbol: r.symbol,
        kind: "PRICE_THRESHOLD",
        to: `${t}%`,
        message: msg,
        at: nowIsoLevel,
      });
      const description =
        magnitude >= 5 ? "Deep drop — check risk levels & liquidity."
        : magnitude >= 3 ? "Significant intraday move."
        : "Moderate dip.";
      if (magnitude >= 5) {
        toast.error(msg, { description, duration: 12_000 });
        playChime(440, 0.45, 0.09);
      } else if (magnitude >= 3) {
        toast.warning(msg, { description, duration: 8_000 });
        playChime(620, 0.35, 0.075);
      } else {
        toast(msg, { description });
        playChime(820, 0.25, 0.065);
      }
      break; // only fire the deepest new threshold this scan
    }
  }
  saveLevelState(state);

  // ── Proximity-to-buy-zone alerts ──
  // Fire when the live price gets within 1.5% of any adaptive-ladder rung
  // (approaching) or within 0.4% / crosses through it (at zone). Level-
  // triggered — each (symbol, rung price, day) fires at most once per bucket
  // so we don't spam the toast queue on every 60s tick.
  for (const r of curr) {
    if (!r.adaptiveLadder || r.adaptiveLadder.length === 0) continue;
    // Hard gates against false BUY alerts:
    //   • Skip anything not in a real dip regime.
    //   • Skip anything green on the day (a rung near the 50-SMA can sit
    //     ~1% below a green tape and would otherwise spam "approaching buy").
    //   • Skip WAITING/HOLD statuses — the ladder is informational, not armed.
    if (r.regime === "NO_DIP") continue;
    if ((r.change1d ?? 0) >= 0) continue;
    const armed = r.status === "BUY_STARTER" || r.status === "BUY_LADDER" || r.status === "PROBE";
    if (!armed) continue;
    const price = r.price;
    if (!price || !isFinite(price)) continue;
    for (const rung of r.adaptiveLadder) {
      if (!rung.price || price < rung.price) continue; // only alert when we're above/near
      // Probe rungs are anchored at spot price, so distPct is always ~0
      // and would fire AT_BUY_ZONE the moment status flips to PROBE — even
      // when the stock is barely down. Real buy targets only.
      if (typeof rung.label === "string" && rung.label.startsWith("Probe")) continue;
      const distPct = ((price - rung.price) / rung.price) * 100;
      if (distPct > 1.5) continue; // still too far above
      const bucket = distPct <= 0.4 ? "AT" : "NEAR";
      const key = `prox|${r.symbol}|${rung.price.toFixed(2)}|${bucket}`;
      if (state.fired[key]) continue;
      state.fired[key] = true;
      const label = rung.label || `${rung.pct}%`;
      const msg =
        bucket === "AT"
          ? `${r.symbol} at buy zone ${label} — $${rung.price.toFixed(2)} (live $${price.toFixed(2)})`
          : `${r.symbol} approaching buy ${label} — $${rung.price.toFixed(2)} (live $${price.toFixed(2)}, ${distPct.toFixed(2)}% away)`;
      events.push({
        id: `${r.symbol}-prox-${bucket}-${rung.price.toFixed(2)}-${now}`,
        symbol: r.symbol,
        kind: bucket === "AT" ? "AT_BUY_ZONE" : "APPROACHING_BUY",
        to: `$${rung.price.toFixed(2)}`,
        message: msg,
        at: nowIsoLevel,
      });
      if (bucket === "AT") {
        toast.success(msg, { description: rung.reason || "Live price hit the recommended buy level.", duration: 14_000 });
        playChime(1100, 0.35, 0.09);
        fireTelegram("AT_BUY_ZONE", msg + (rung.reason ? `\n${rung.reason}` : ""));
      } else {
        toast(msg, { description: rung.reason || "Getting close to the recommended buy level." });
        playChime(880, 0.22, 0.06);
        fireTelegram("APPROACHING_BUY", msg + (rung.reason ? `\n${rung.reason}` : ""));
      }
    }
  }
  saveLevelState(state);

  if (!prev || prev.length === 0) {
    if (events.length) saveAlerts([...loadAlerts(), ...events]);
    return events;
  }
  const prevMap = new Map(prev.map((r) => [r.symbol, r]));
  const nowIso = new Date(now).toISOString();

  for (const r of curr) {
    const p = prevMap.get(r.symbol);
    if (!p) continue;

    // Regime change (skip going into NO_DIP)
    if (p.regime !== r.regime && r.regime !== "NO_DIP") {
      const msg = `${r.symbol}: regime → ${r.regimeLabel} (was ${p.regimeLabel})`;
      events.push({
        id: `${r.symbol}-regime-${now}`,
        symbol: r.symbol,
        kind: "REGIME_CHANGE",
        from: p.regimeLabel,
        to: r.regimeLabel,
        message: msg,
        at: nowIso,
      });
      toast(msg, { description: r.statusReason || "" });
    }

    // Status armed
    const armStates = new Set(["BUY_STARTER", "BUY_LADDER", "PROBE"]);
    if (p.status !== r.status && armStates.has(r.status)) {
      const msg = `${r.symbol}: ${r.status.replace(/_/g, " ")}`;
      events.push({
        id: `${r.symbol}-status-${now}`,
        symbol: r.symbol,
        kind: "STATUS_ARMED",
        from: p.status,
        to: r.status,
        message: msg,
        at: nowIso,
      });
      toast.success(msg, { description: r.statusReason });
      playChime(1050, 0.22);
    }

    // Momentum breakout (price crosses 20-day high)
    if (p.price < p.high20 && r.price >= r.high20) {
      const msg = `${r.symbol}: momentum breakout above 20-day high (${r.high20.toFixed(2)})`;
      events.push({
        id: `${r.symbol}-mom-${now}`,
        symbol: r.symbol,
        kind: "MOMENTUM_BREAK",
        to: "BREAKOUT",
        message: msg,
        at: nowIso,
      });
      toast(msg);
      playChime(1320, 0.2);
    }
  }

  if (events.length) saveAlerts([...loadAlerts(), ...events]);
  return events;
}