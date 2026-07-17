// Curated historical validation scenarios for the sandbox.
//
// Each scenario walks a real symbol backwards from "today" using
// runHistoricalReplay. `startOffsetFromEnd` selects the window; `steps` /
// `stride` control how densely we walk it. Regime is a human label used to
// bucket metrics — accuracy per regime is one of the key outputs.
//
// Nothing here touches production caches, watchlists, or analytics. The
// replay engine is fully read-only and lives entirely in the sandbox.

export type ValidationRegime =
  | "bull"
  | "bear"
  | "crash"
  | "recovery"
  | "sideways"
  | "high_vol"
  | "reversal"
  | "sector_rotation";

export type ValidationScenario = {
  id: string;
  label: string;
  symbol: string;
  regime: ValidationRegime;
  startOffsetFromEnd: number;
  steps: number;
  stride: number;
  description: string;
};

// Approx trading-day offsets (assuming ~252/yr) from present:
//   ~120 = last ~6mo, ~500 = ~2yr ago, ~1000 = ~4yr ago, ~1500 = ~6yr ago.
// Windows are chosen to overlap well-known regimes across SMH / SOXX / SPY /
// QQQ / SOXQ, the same universe the live scanner scores.
export const VALIDATION_SCENARIOS: ValidationScenario[] = [
  {
    id: "smh_bear_2022",
    label: "SMH — 2022 semi bear market",
    symbol: "SMH",
    regime: "bear",
    startOffsetFromEnd: 900,
    steps: 45,
    stride: 5,
    description: "Persistent downtrend through 2022; tests scanner in a prolonged bear regime.",
  },
  {
    id: "smh_recovery_2023",
    label: "SMH — 2023 recovery leg",
    symbol: "SMH",
    regime: "recovery",
    startOffsetFromEnd: 620,
    steps: 45,
    stride: 5,
    description: "Post-bear recovery; tests analog switching from bear to bull.",
  },
  {
    id: "smh_bull_2024",
    label: "SMH — 2024 AI-led bull",
    symbol: "SMH",
    regime: "bull",
    startOffsetFromEnd: 340,
    steps: 40,
    stride: 5,
    description: "Sustained uptrend at elevated momentum; tests bull-regime accuracy.",
  },
  {
    id: "spy_crash_2020",
    label: "SPY — 2020 covid crash & rebound",
    symbol: "SPY",
    regime: "crash",
    startOffsetFromEnd: 1450,
    steps: 40,
    stride: 4,
    description: "Fast crash followed by sharp V-bounce; tests capitulation & V_BOUNCE detection.",
  },
  {
    id: "qqq_2018q4",
    label: "QQQ — 2018 Q4 selloff",
    symbol: "QQQ",
    regime: "reversal",
    startOffsetFromEnd: 1780,
    steps: 40,
    stride: 4,
    description: "Late-cycle trend break; tests trend-reversal identification.",
  },
  {
    id: "soxx_sideways_2019",
    label: "SOXX — 2019 chop & grind",
    symbol: "SOXX",
    regime: "sideways",
    startOffsetFromEnd: 1500,
    steps: 40,
    stride: 5,
    description: "Range-bound with modest drift; tests scanner behaviour in no-signal regime.",
  },
  {
    id: "smh_recent_120",
    label: "SMH — trailing 6 months",
    symbol: "SMH",
    regime: "high_vol",
    startOffsetFromEnd: 130,
    steps: 25,
    stride: 5,
    description: "Recent regime; sanity-check that current predictions align with realized outcomes.",
  },
  {
    id: "soxq_bull_2024",
    label: "SOXQ — 2024 sector rotation into semis",
    symbol: "SOXQ",
    regime: "sector_rotation",
    startOffsetFromEnd: 360,
    steps: 30,
    stride: 5,
    description: "Sector-rotation window; validates relative-strength features.",
  },
];

export const REGIME_LABELS: Record<ValidationRegime, string> = {
  bull: "Bull",
  bear: "Bear",
  crash: "Crash",
  recovery: "Recovery",
  sideways: "Sideways",
  high_vol: "High vol",
  reversal: "Trend reversal",
  sector_rotation: "Sector rotation",
};
