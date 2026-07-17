export type SpeedMode = "conservative" | "balanced" | "aggressive";

const KEY = "qs_speed_mode_v1";

export function loadSpeedMode(): SpeedMode {
  if (typeof window === "undefined") return "balanced";
  const v = window.localStorage.getItem(KEY);
  return v === "conservative" || v === "aggressive" ? v : "balanced";
}

export function saveSpeedMode(m: SpeedMode) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, m);
}

export const SPEED_MODE_META: Record<
  SpeedMode,
  { label: string; short: string; desc: string; starterMult: number; cls: string; activeCls: string }
> = {
  conservative: {
    label: "CONSERVATIVE",
    short: "CONS",
    desc: "Waits for 2/3 engine agreement. Starter 0.75×. Best for capital preservation.",
    starterMult: 0.75,
    cls: "border-sky-500/30 text-sky-300 bg-sky-500/5 hover:bg-sky-500/10",
    activeCls: "border-sky-400/60 text-sky-100 bg-sky-500/20 shadow-[0_0_20px_rgba(56,189,248,0.25)]",
  },
  balanced: {
    label: "BALANCED",
    short: "BAL",
    desc: "Default. 1× starter, waits for 1/2 confirmations.",
    starterMult: 1.0,
    cls: "border-cyan-500/30 text-cyan-300 bg-cyan-500/5 hover:bg-cyan-500/10",
    activeCls: "border-cyan-400/60 text-cyan-100 bg-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.3)]",
  },
  aggressive: {
    label: "AGGRESSIVE",
    short: "AGG",
    desc: "Deploys on any dip ≥1%. Starter 1.4×. Catches shallow bounces; higher risk of adding into further weakness.",
    starterMult: 1.4,
    cls: "border-orange-500/30 text-orange-300 bg-orange-500/5 hover:bg-orange-500/10",
    activeCls: "border-orange-400/60 text-orange-100 bg-orange-500/20 shadow-[0_0_20px_rgba(251,146,60,0.3)]",
  },
};

export type LadderRungSource = "analog" | "atr_heuristic" | "insufficient_data";

export type LadderRung = {
  pct: number;
  price: number;
  label: string;
  reason: string;
  // Provenance — attached where available so UI can show sample size /
  // "insufficient data" instead of quietly serving a heuristic number.
  source?: LadderRungSource;
  probReached?: number;   // 0..1 — historical probability price reached this rung within 90d
  sample?: number;        // number of historical matches backing this rung
  confidence?: number;    // 0..100
};

// Renormalizes: scales starter by mult, distributes the delta across the rest.
export function applySpeedMode(rungs: LadderRung[], mode: SpeedMode): LadderRung[] {
  if (rungs.length < 2 || mode === "balanced") return rungs;
  const mult = SPEED_MODE_META[mode].starterMult;
  const cur0 = rungs[0].pct;
  const new0 = Math.min(0.85, Math.max(0.05, cur0 * mult));
  const remainder = Math.max(0, 1 - new0);
  const restSum = rungs.slice(1).reduce((a, r) => a + r.pct, 0) || 1;
  return rungs.map((r, i) =>
    i === 0
      ? { ...r, pct: new0 }
      : { ...r, pct: (r.pct / restSum) * remainder },
  );
}