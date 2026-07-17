// Client-safe scenario generator for the sandbox Simulation & Testing page.
//
// This module is completely isolated from live market data. It never imports
// from analog-search.server, market.server, twelvedata, or any production
// cache. It only produces deterministic synthetic OHLCV bars that the
// simulation server function feeds through the *exact* production scanner.

export type ScenarioKind =
  | "strong_rally"
  | "sharp_decline"
  | "consolidation"
  | "recovery"
  | "volatility_spike"
  | "trend_reversal"
  | "sector_weakness"
  | "flat_market"
  | "low_volatility"
  | "high_volatility"
  | "gap_up"
  | "gap_down"
  | "prolonged_bear"
  | "prolonged_bull"
  | "contradictory"
  | "sudden_reversal"
  | "minimum_history"
  | "custom";

export type CustomScenarioParams = {
  driftPctPerDay: number; // e.g. 0.05 = +0.05%/day
  volPctPerDay: number;   // e.g. 1.5 = 1.5%/day sigma
  shockPct: number;       // e.g. -12 = single -12% shock day 60 bars from end (0 disables)
  shockOffsetFromEnd: number; // bars from tail (default 60)
};

export type SimulationRequest = {
  scenario: ScenarioKind;
  seed: number;         // deterministic
  length: number;       // number of daily bars, min 400, max 3000
  symbolLabel: string;  // display-only, e.g. "SIM-SMH"
  custom?: CustomScenarioParams;
};

export type SimBar = {
  datetime: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Mulberry32 seeded PRNG — deterministic across client + server.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller standard normal.
function makeNormal(rand: () => number) {
  return () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

type Regime = { drift: number; vol: number; shock?: number };

function scenarioRegime(kind: ScenarioKind, i: number, n: number, custom?: CustomScenarioParams): Regime {
  const tailStart = n - 80;
  const midStart = Math.floor(n * 0.55);
  switch (kind) {
    case "strong_rally":
      return { drift: 0.0015, vol: 0.010 };
    case "sharp_decline":
      if (i >= tailStart) return { drift: -0.006, vol: 0.032, shock: i === n - 20 ? -0.08 : undefined };
      return { drift: 0.0008, vol: 0.013 };
    case "consolidation":
      return { drift: 0.0, vol: 0.007 };
    case "recovery": {
      if (i < midStart) return { drift: 0.0012, vol: 0.012 };
      if (i < midStart + 40) return { drift: -0.010, vol: 0.028 };
      return { drift: 0.0018, vol: 0.017 };
    }
    case "volatility_spike":
      if (i >= n - 40) return { drift: -0.001, vol: 0.045 };
      return { drift: 0.0006, vol: 0.011 };
    case "trend_reversal": {
      const half = Math.floor(n * 0.67);
      if (i < half) return { drift: 0.0015, vol: 0.011 };
      return { drift: -0.0025, vol: 0.022 };
    }
    case "sector_weakness":
      return { drift: -0.0022, vol: 0.020 };
    case "flat_market":
      // Very tight range, near-zero drift — tests scanner in "no signal" regime.
      return { drift: 0.0, vol: 0.004 };
    case "low_volatility":
      // Gentle uptrend at unusually low vol.
      return { drift: 0.0008, vol: 0.003 };
    case "high_volatility":
      // Persistent very high vol, mildly negative drift.
      return { drift: -0.0002, vol: 0.055 };
    case "gap_up":
      // Base trend + single massive gap-up in tail.
      if (i === n - 25) return { drift: 0.0, vol: 0.010, shock: 0.15 };
      return { drift: 0.0004, vol: 0.010 };
    case "gap_down":
      if (i === n - 25) return { drift: 0.0, vol: 0.010, shock: -0.18 };
      return { drift: 0.0004, vol: 0.010 };
    case "prolonged_bear": {
      // 300+ bars of steady decline.
      const bearStart = Math.floor(n * 0.3);
      if (i >= bearStart) return { drift: -0.0018, vol: 0.020 };
      return { drift: 0.0004, vol: 0.010 };
    }
    case "prolonged_bull": {
      // Long steady uptrend.
      return { drift: 0.0020, vol: 0.011 };
    }
    case "contradictory": {
      // Trend up but momentum weakening: alternating drift blocks with rising vol.
      const block = Math.floor(i / 15) % 2;
      const late = i >= n - 120;
      return {
        drift: block === 0 ? 0.0018 : -0.0012,
        vol: late ? 0.024 : 0.013,
      };
    }
    case "sudden_reversal": {
      // Strong rally then a single-week collapse.
      const collapseStart = n - 12;
      if (i >= collapseStart)
        return { drift: -0.012, vol: 0.030, shock: i === n - 5 ? -0.09 : undefined };
      return { drift: 0.0018, vol: 0.011 };
    }
    case "minimum_history":
      // Ordinary drift — used with a short length param to stress limited history.
      return { drift: 0.0005, vol: 0.012 };
    case "custom": {
      const c = custom ?? { driftPctPerDay: 0, volPctPerDay: 1, shockPct: 0, shockOffsetFromEnd: 60 };
      const shockIdx = n - Math.max(1, Math.round(c.shockOffsetFromEnd));
      return {
        drift: c.driftPctPerDay / 100,
        vol: Math.max(0.002, c.volPctPerDay / 100),
        shock: i === shockIdx && c.shockPct !== 0 ? c.shockPct / 100 : undefined,
      };
    }
  }
}

// Business-day date walk ending today.
function generateDates(length: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const d = new Date(today);
  while (out.length < length) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

function synth(
  length: number,
  start: number,
  seed: number,
  regimeAt: (i: number) => Regime,
): SimBar[] {
  const rand = mulberry32(seed);
  const norm = makeNormal(rand);
  const dates = generateDates(length);
  const bars: SimBar[] = [];
  let close = start;
  for (let i = 0; i < length; i++) {
    const r = regimeAt(i);
    let ret = r.drift + r.vol * norm();
    if (r.shock) ret += r.shock;
    const open = close;
    close = Math.max(0.01, open * (1 + ret));
    const wickHi = r.vol * Math.abs(norm());
    const wickLo = r.vol * Math.abs(norm());
    const high = Math.max(open, close) * (1 + wickHi);
    const low = Math.min(open, close) * (1 - wickLo);
    const baseVol = 3_000_000;
    const volume = Math.max(
      100_000,
      Math.round(baseVol * (1 + Math.abs(ret) * 20) * (0.7 + rand() * 0.6)),
    );
    bars.push({ datetime: dates[i], open, high, low, close, volume });
  }
  return bars;
}

export type SimulationBundle = {
  primary: SimBar[];
  spy: SimBar[];
  sector: SimBar[];
  meta: { scenario: ScenarioKind; seed: number; length: number; symbolLabel: string };
};

// Generate the primary symbol plus a synthetic SPY and sector so the
// production `attachMarketContext` path runs identically to live scans.
export function generateSimulation(req: SimulationRequest): SimulationBundle {
  const length = Math.max(400, Math.min(3000, Math.round(req.length)));
  const primary = synth(length, 100, req.seed, (i) =>
    scenarioRegime(req.scenario, i, length, req.custom),
  );
  const spy = synth(length, 400, req.seed ^ 0x9e3779b9, (i) => {
    if (req.scenario === "sector_weakness") return { drift: 0.0004, vol: 0.008 };
    if (req.scenario === "sharp_decline" && i >= length - 80) return { drift: -0.002, vol: 0.018 };
    if (req.scenario === "volatility_spike" && i >= length - 40) return { drift: -0.0005, vol: 0.020 };
    if (req.scenario === "trend_reversal" && i >= Math.floor(length * 0.67))
      return { drift: -0.0010, vol: 0.014 };
    return { drift: 0.0004, vol: 0.008 };
  });
  const sector = synth(length, 200, req.seed ^ 0x243f6a88, (i) => {
    const base = scenarioRegime(req.scenario, i, length, req.custom);
    // Sector rides ~70% of the symbol regime — realistic co-movement.
    return { drift: base.drift * 0.7, vol: Math.max(0.006, base.vol * 0.8) };
  });
  return {
    primary,
    spy,
    sector,
    meta: {
      scenario: req.scenario,
      seed: req.seed,
      length,
      symbolLabel: req.symbolLabel,
    },
  };
}

export const SCENARIO_LABELS: Record<ScenarioKind, string> = {
  strong_rally: "Strong rally",
  sharp_decline: "Sharp decline",
  consolidation: "Consolidation",
  recovery: "Recovery after drawdown",
  volatility_spike: "Volatility spike",
  trend_reversal: "Trend reversal",
  sector_weakness: "Sector weakness (idio)",
  flat_market: "Flat market",
  low_volatility: "Extremely low volatility",
  high_volatility: "Extremely high volatility",
  gap_up: "Gap-up event",
  gap_down: "Gap-down event",
  prolonged_bear: "Prolonged bear market",
  prolonged_bull: "Prolonged bull market",
  contradictory: "Contradictory signals",
  sudden_reversal: "Sudden reversal",
  minimum_history: "Minimum history (short series)",
  custom: "Custom",
};
