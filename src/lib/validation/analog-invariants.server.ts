// Runtime invariant checks for the Historical Analog Scanner.
// These throw in dev and log-with-count in prod so silent regressions
// (NaN poisoning, lookahead bias, symbol mismatch, non-monotonic dates)
// become visible immediately.

import type { Bar } from "@/lib/market.server";

const isDev = process.env.NODE_ENV !== "production";

type Violation = { rule: string; detail: string; at?: string };
const violations: Violation[] = [];

function report(v: Violation) {
  violations.push(v);
  if (violations.length > 500) violations.shift();
  if (isDev) throw new Error(`[analog-invariant] ${v.rule}: ${v.detail}`);
  else console.warn(`[analog-invariant] ${v.rule}: ${v.detail}`);
}

export function assertMonotonicDates(bars: Bar[], symbol: string): void {
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].datetime <= bars[i - 1].datetime) {
      report({
        rule: "monotonic_dates",
        detail: `${symbol}: bar[${i}]=${bars[i].datetime} not > bar[${i - 1}]=${bars[i - 1].datetime}`,
      });
      return;
    }
  }
}

export function assertNoLookahead(
  currentIdx: number,
  matchIdx: number,
  forwardHorizon: number,
): void {
  if (matchIdx + forwardHorizon >= currentIdx) {
    report({
      rule: "no_lookahead",
      detail: `match idx=${matchIdx} + horizon=${forwardHorizon} overlaps current idx=${currentIdx}`,
    });
  }
}

export function assertFiniteFeatures(obj: Record<string, unknown>, symbol: string): void {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && !Number.isFinite(v)) {
      report({
        rule: "finite_features",
        detail: `${symbol}: feature ${k} = ${v}`,
      });
      return;
    }
  }
}

export function assertSymbolMatch(requested: string, returned: string): void {
  const norm = (s: string) => s.toUpperCase().replace(/\.US$/, "").trim();
  if (norm(requested) !== norm(returned)) {
    report({
      rule: "symbol_match",
      detail: `requested=${requested} returned=${returned}`,
    });
  }
}

export function getViolations(): ReadonlyArray<Violation> {
  return violations.slice();
}

export function clearViolations(): void {
  violations.length = 0;
}

// Structured logger for analog scanner. Prefix stays greppable in worker logs.
export const analogLog = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[analog] ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[analog] ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg: string, err?: unknown) =>
    console.error(`[analog] ${msg}`, err instanceof Error ? err.message : err),
};