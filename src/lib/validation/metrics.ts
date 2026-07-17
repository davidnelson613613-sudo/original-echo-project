// Pure metrics + failure analyzer for validation runs.
//
// Consumes per-step outputs from runHistoricalReplay (`ReplayStep[]`) and a
// ScannerConfig gate policy. Produces filtered accuracy metrics, calibration
// buckets, per-regime rollups, and a categorized failure list.

import type { ReplayResponse, ReplayStep } from "@/lib/simulation.functions";
import type { ScannerConfig } from "./config";
import type { ValidationRegime, ValidationScenario } from "./scenarios";

export type FailureReason =
  | "no_analog"
  | "low_similarity"
  | "low_confidence"
  | "unstable_switch"
  | "wrong_direction"
  | "large_magnitude_error";

export type FailureRow = {
  scenarioId: string;
  regime: ValidationRegime;
  date: string;
  reason: FailureReason;
  detail: string;
  similarity: number | null;
  confidence: number | null;
  predictedFwd30: number | null;
  actualFwd30: number | null;
};

export type BucketStat = {
  bucket: string;
  count: number;
  directionAccuracy: number | null;
  meanAbsError: number | null;
};

export type RegimeStat = {
  regime: ValidationRegime;
  scenarios: number;
  effectiveSteps: number;
  directionAccuracy: number | null;
  meanAbsError: number | null;
};

export type SuiteMetrics = {
  totalScenarios: number;
  totalSteps: number;
  effectiveSteps: number; // steps that survived the gate
  gatedOutSteps: number;
  directionAccuracy: number | null;
  meanAbsFwd30Error: number | null;
  meanSimilarity: number | null;
  meanConfidence: number | null;
  analogSwitchRate: number | null;
  worstRegimeAccuracy: number | null;
  perRegime: RegimeStat[];
  confidenceBuckets: BucketStat[];
  similarityBuckets: BucketStat[];
  brierScore: number | null; // lower is better
  failures: FailureRow[];
};

export type ScenarioRun = {
  scenario: ValidationScenario;
  response: ReplayResponse;
};

/** Apply gate policy to a single step. Returns null if step is gated out. */
function applyGate(step: ReplayStep, cfg: ScannerConfig, cooldownRemaining: number): ReplayStep | null {
  if (!step.hasResult) return null;
  if (cooldownRemaining > 0) return null;
  if (step.similarity !== null && step.similarity < cfg.minSimilarity) return null;
  if (step.confidenceOverall !== null && step.confidenceOverall < cfg.minConfidence) return null;
  if (cfg.discardUnstableSwitches && step.switchReason && (step.switchReason.startsWith("unstable_") || step.switchReason.startsWith("regressive_"))) {
    return null;
  }
  return step;
}

/** Walk a run's steps applying the config; return kept steps + gated count. */
export function applyConfigToRun(run: ScenarioRun, cfg: ScannerConfig): { kept: ReplayStep[]; gated: number } {
  const kept: ReplayStep[] = [];
  let cooldown = 0;
  let gated = 0;
  for (const step of run.response.steps) {
    const survived = applyGate(step, cfg, cooldown);
    if (survived) {
      kept.push(survived);
    } else if (step.hasResult) {
      gated++;
    }
    if (step.analogSwitched) cooldown = cfg.switchCooldownSteps;
    else if (cooldown > 0) cooldown--;
  }
  return { kept, gated };
}

/** Categorize misses (post-gate) into reason codes. */
function classifyFailures(scenario: ValidationScenario, kept: ReplayStep[], allSteps: ReplayStep[]): FailureRow[] {
  const out: FailureRow[] = [];
  // no_analog + low_conf/sim + unstable are pre-gate; look at allSteps
  for (const s of allSteps) {
    if (!s.hasResult) {
      out.push({
        scenarioId: scenario.id, regime: scenario.regime, date: s.date, reason: "no_analog",
        detail: "scanner returned no analog", similarity: null, confidence: null,
        predictedFwd30: null, actualFwd30: s.actualFwd30,
      });
      continue;
    }
    if (s.switchReason && (s.switchReason.startsWith("unstable_") || s.switchReason.startsWith("regressive_"))) {
      out.push({
        scenarioId: scenario.id, regime: scenario.regime, date: s.date, reason: "unstable_switch",
        detail: s.switchReason, similarity: s.similarity, confidence: s.confidenceOverall,
        predictedFwd30: s.meanFwd30, actualFwd30: s.actualFwd30,
      });
    }
  }
  // wrong_direction + large_magnitude_error look at kept steps
  for (const s of kept) {
    if (s.directionCorrect === false) {
      out.push({
        scenarioId: scenario.id, regime: scenario.regime, date: s.date, reason: "wrong_direction",
        detail: `predicted ${s.meanFwd30?.toFixed(2)}%, actual ${s.actualFwd30?.toFixed(2)}%`,
        similarity: s.similarity, confidence: s.confidenceOverall,
        predictedFwd30: s.meanFwd30, actualFwd30: s.actualFwd30,
      });
    } else if (s.fwd30Error !== null && Math.abs(s.fwd30Error) > 15) {
      out.push({
        scenarioId: scenario.id, regime: scenario.regime, date: s.date, reason: "large_magnitude_error",
        detail: `|error| ${Math.abs(s.fwd30Error).toFixed(1)}pp`,
        similarity: s.similarity, confidence: s.confidenceOverall,
        predictedFwd30: s.meanFwd30, actualFwd30: s.actualFwd30,
      });
    }
  }
  return out;
}

function bucketStats(steps: (ReplayStep & { _bucket: string })[]): BucketStat[] {
  const groups = new Map<string, (ReplayStep & { _bucket: string })[]>();
  for (const s of steps) {
    const arr = groups.get(s._bucket) ?? [];
    arr.push(s);
    groups.set(s._bucket, arr);
  }
  const buckets: BucketStat[] = [];
  Array.from(groups.keys()).sort().forEach((b) => {
    const arr = groups.get(b)!;
    const dir = arr.filter((s) => s.directionCorrect !== null);
    const err = arr.filter((s) => s.fwd30Error !== null);
    buckets.push({
      bucket: b,
      count: arr.length,
      directionAccuracy: dir.length
        ? dir.filter((s) => s.directionCorrect).length / dir.length
        : null,
      meanAbsError: err.length
        ? err.reduce((sum, s) => sum + Math.abs(s.fwd30Error!), 0) / err.length
        : null,
    });
  });
  return buckets;
}

function bucketBy(steps: ReplayStep[], get: (s: ReplayStep) => number | null, edges: number[], labels: string[]): BucketStat[] {
  const tagged: (ReplayStep & { _bucket: string })[] = [];
  for (const s of steps) {
    const v = get(s);
    if (v === null) continue;
    let idx = edges.length;
    for (let i = 0; i < edges.length; i++) {
      if (v < edges[i]) { idx = i; break; }
    }
    tagged.push({ ...s, _bucket: labels[idx] ?? labels[labels.length - 1] });
  }
  return bucketStats(tagged);
}

/** Brier score for direction prediction, using confidence/100 as probability. */
function brier(steps: ReplayStep[]): number | null {
  const usable = steps.filter((s) => s.confidenceOverall !== null && s.directionCorrect !== null);
  if (usable.length === 0) return null;
  let sum = 0;
  for (const s of usable) {
    const p = (s.confidenceOverall ?? 0) / 100;
    const outcome = s.directionCorrect ? 1 : 0;
    sum += (p - outcome) ** 2;
  }
  return sum / usable.length;
}

export function computeSuiteMetrics(runs: ScenarioRun[], cfg: ScannerConfig): SuiteMetrics {
  let totalSteps = 0;
  let effectiveSteps = 0;
  let gatedOutSteps = 0;
  const allKept: ReplayStep[] = [];
  const failures: FailureRow[] = [];
  const perRegime = new Map<ValidationRegime, { steps: ReplayStep[]; scenarios: number }>();

  let switchTotal = 0;
  let switchCount = 0;

  for (const run of runs) {
    const { kept, gated } = applyConfigToRun(run, cfg);
    totalSteps += run.response.steps.length;
    effectiveSteps += kept.length;
    gatedOutSteps += gated;
    allKept.push(...kept);
    failures.push(...classifyFailures(run.scenario, kept, run.response.steps));

    switchTotal += run.response.stability.totalSteps;
    switchCount += run.response.stability.analogSwitches;

    const bucket = perRegime.get(run.scenario.regime) ?? { steps: [], scenarios: 0 };
    bucket.steps.push(...kept);
    bucket.scenarios++;
    perRegime.set(run.scenario.regime, bucket);
  }

  const dirEligible = allKept.filter((s) => s.directionCorrect !== null);
  const errEligible = allKept.filter((s) => s.fwd30Error !== null);

  const directionAccuracy = dirEligible.length
    ? dirEligible.filter((s) => s.directionCorrect).length / dirEligible.length
    : null;
  const meanAbsFwd30Error = errEligible.length
    ? errEligible.reduce((sum, s) => sum + Math.abs(s.fwd30Error!), 0) / errEligible.length
    : null;

  const simVals = allKept.map((s) => s.similarity).filter((v): v is number => v !== null);
  const confVals = allKept.map((s) => s.confidenceOverall).filter((v): v is number => v !== null);
  const meanSimilarity = simVals.length ? simVals.reduce((a, b) => a + b, 0) / simVals.length : null;
  const meanConfidence = confVals.length ? confVals.reduce((a, b) => a + b, 0) / confVals.length : null;

  const regimeStats: RegimeStat[] = [];
  perRegime.forEach((v, k) => {
    const dir = v.steps.filter((s) => s.directionCorrect !== null);
    const err = v.steps.filter((s) => s.fwd30Error !== null);
    regimeStats.push({
      regime: k,
      scenarios: v.scenarios,
      effectiveSteps: v.steps.length,
      directionAccuracy: dir.length
        ? dir.filter((s) => s.directionCorrect).length / dir.length
        : null,
      meanAbsError: err.length
        ? err.reduce((sum, s) => sum + Math.abs(s.fwd30Error!), 0) / err.length
        : null,
    });
  });
  regimeStats.sort((a, b) => a.regime.localeCompare(b.regime));

  const worstRegimeAccuracy = regimeStats
    .map((r) => r.directionAccuracy)
    .filter((v): v is number => v !== null)
    .reduce<number | null>((min, v) => (min === null || v < min ? v : min), null);

  const confidenceBuckets = bucketBy(
    allKept,
    (s) => s.confidenceOverall,
    [40, 55, 70, 85],
    ["<40", "40-55", "55-70", "70-85", "≥85"],
  );
  const similarityBuckets = bucketBy(
    allKept,
    (s) => s.similarity,
    [50, 65, 80, 90],
    ["<50", "50-65", "65-80", "80-90", "≥90"],
  );

  return {
    totalScenarios: runs.length,
    totalSteps,
    effectiveSteps,
    gatedOutSteps,
    directionAccuracy,
    meanAbsFwd30Error,
    meanSimilarity,
    meanConfidence,
    analogSwitchRate: switchTotal ? switchCount / switchTotal : null,
    worstRegimeAccuracy,
    perRegime: regimeStats,
    confidenceBuckets,
    similarityBuckets,
    brierScore: brier(allKept),
    failures: failures.slice(0, 200),
  };
}

/**
 * Regression gate: challenger must be strictly better on direction accuracy
 * AND worst-regime accuracy AND not degrade mean abs error by >0.5pp.
 */
export function isChallengerBetter(champion: SuiteMetrics, challenger: SuiteMetrics): { better: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if ((challenger.directionAccuracy ?? 0) <= (champion.directionAccuracy ?? 0)) {
    reasons.push(`direction accuracy did not improve (${fmtPct(challenger.directionAccuracy)} vs ${fmtPct(champion.directionAccuracy)})`);
  }
  if ((challenger.worstRegimeAccuracy ?? 0) < (champion.worstRegimeAccuracy ?? 0)) {
    reasons.push(`worst-regime accuracy regressed (${fmtPct(challenger.worstRegimeAccuracy)} vs ${fmtPct(champion.worstRegimeAccuracy)})`);
  }
  if (
    challenger.meanAbsFwd30Error !== null &&
    champion.meanAbsFwd30Error !== null &&
    challenger.meanAbsFwd30Error > champion.meanAbsFwd30Error + 0.5
  ) {
    reasons.push(`mean abs error worsened by >0.5pp (${challenger.meanAbsFwd30Error.toFixed(2)} vs ${champion.meanAbsFwd30Error.toFixed(2)})`);
  }
  if (challenger.effectiveSteps < Math.max(20, Math.floor(champion.effectiveSteps * 0.4))) {
    reasons.push(`too few effective steps after gating (${challenger.effectiveSteps} vs ${champion.effectiveSteps}) — not enough evidence`);
  }
  return { better: reasons.length === 0, reasons };
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
