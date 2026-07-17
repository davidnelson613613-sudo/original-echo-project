// Scanner-config gates applied over replay results.
//
// The live scanner engine is left unchanged. Instead, the validation
// harness applies these gates as a post-processing filter over each
// replay step — this lets us objectively test "would raising min
// similarity have improved calibration?" without mutating production code.
// Every promotion is honest about being a *filter policy*, not an engine
// edit.

export type ScannerConfig = {
  /** Reject a step's prediction if best-analog similarity is below this (%). */
  minSimilarity: number;
  /** Reject a step's prediction if aggregate confidence is below this (%). */
  minConfidence: number;
  /** After an analog switch, ignore predictions for this many steps. */
  switchCooldownSteps: number;
  /** Treat "unstable_switch" / "regressive_switch" flags as no-signal. */
  discardUnstableSwitches: boolean;
};

export const CHAMPION_KEY = "validation.champion.v1";
export const HISTORY_KEY = "validation.history.v1";

export const DEFAULT_CHAMPION: ScannerConfig = {
  minSimilarity: 0,
  minConfidence: 0,
  switchCooldownSteps: 0,
  discardUnstableSwitches: false,
};

export function loadChampion(): ScannerConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CHAMPION };
  try {
    const raw = window.localStorage.getItem(CHAMPION_KEY);
    if (!raw) return { ...DEFAULT_CHAMPION };
    const parsed = JSON.parse(raw) as Partial<ScannerConfig>;
    return { ...DEFAULT_CHAMPION, ...parsed };
  } catch {
    return { ...DEFAULT_CHAMPION };
  }
}

export function saveChampion(cfg: ScannerConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHAMPION_KEY, JSON.stringify(cfg));
}

export function configHash(cfg: ScannerConfig): string {
  return [
    `sim${cfg.minSimilarity}`,
    `cnf${cfg.minConfidence}`,
    `cd${cfg.switchCooldownSteps}`,
    `du${cfg.discardUnstableSwitches ? 1 : 0}`,
  ].join("-");
}

/**
 * Deterministic challenger generator. Produces `count` perturbations of the
 * champion within bounded ranges. Seeded so runs are reproducible.
 */
export function generateChallengers(champion: ScannerConfig, count: number, seed: number): ScannerConfig[] {
  const out: ScannerConfig[] = [];
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // Always include a couple of "grid" candidates
  const grid: ScannerConfig[] = [
    { ...champion, minSimilarity: Math.min(90, champion.minSimilarity + 5) },
    { ...champion, minConfidence: Math.min(90, champion.minConfidence + 10) },
    { ...champion, switchCooldownSteps: Math.min(10, champion.switchCooldownSteps + 2) },
    { ...champion, discardUnstableSwitches: !champion.discardUnstableSwitches },
  ];
  out.push(...grid);
  while (out.length < count) {
    out.push({
      minSimilarity: clamp(0, 90, Math.round(champion.minSimilarity + (rand() * 20 - 10))),
      minConfidence: clamp(0, 90, Math.round(champion.minConfidence + (rand() * 30 - 10))),
      switchCooldownSteps: clamp(0, 10, Math.round(champion.switchCooldownSteps + (rand() * 6 - 2))),
      discardUnstableSwitches: rand() > 0.5,
    });
  }
  return out.slice(0, count);
}

function clamp(min: number, max: number, v: number) {
  return Math.max(min, Math.min(max, v));
}
