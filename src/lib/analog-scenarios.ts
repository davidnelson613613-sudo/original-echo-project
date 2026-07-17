// Scenario Forecasting — cluster historical analog forward paths into
// bullish / base / bearish scenarios by quantile bucketing. Each scenario
// reports historical frequency, expected price range, typical timing, and
// the top supporting matches.

import type { AnalogHit, AnalogSearchResult } from "./analog-search.server";

export type ScenarioKind = "bullish" | "base" | "bearish";

export type Scenario = {
  kind: ScenarioKind;
  label: string;
  frequency: number; // 0..1 — historical share of analogs in this bucket
  avgReturn30d: number;
  avgReturn90d: number;
  priceLow: number;
  priceHigh: number;
  typicalDaysToPeak: number | null;
  typicalDaysToTrough: number | null;
  supporting: Array<{ date: string; symbol: string; similarity: number; fwd90: number | null }>;
  narrative: string;
};

export type ScenarioReport = {
  scenarios: Scenario[];  // always length 3 in kind order: base, bullish, bearish
  disclaimer: string;
};

function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function bucket(matches: AnalogHit[]): Record<ScenarioKind, AnalogHit[]> {
  const withFwd = matches.filter((m) => m.forward.fwd90 !== null);
  if (withFwd.length === 0) return { bullish: [], base: [], bearish: [] };
  const sorted = [...withFwd].sort((a, b) => (a.forward.fwd90! - b.forward.fwd90!));
  const n = sorted.length;
  const bearN = Math.max(1, Math.round(n * 0.25));
  const bullN = Math.max(1, Math.round(n * 0.25));
  return {
    bearish: sorted.slice(0, bearN),
    base: sorted.slice(bearN, n - bullN),
    bullish: sorted.slice(n - bullN),
  };
}

function summarize(
  hits: AnalogHit[],
  kind: ScenarioKind,
  price: number,
  totalCount: number,
): Scenario {
  const label =
    kind === "bullish" ? "Bullish scenario"
    : kind === "bearish" ? "Bearish scenario"
    : "Base scenario";

  if (hits.length === 0) {
    return {
      kind, label, frequency: 0,
      avgReturn30d: 0, avgReturn90d: 0,
      priceLow: price, priceHigh: price,
      typicalDaysToPeak: null, typicalDaysToTrough: null,
      supporting: [],
      narrative: "No matching analogs fell into this scenario bucket.",
    };
  }

  const r30 = hits.map((h) => h.forward.fwd30).filter((v): v is number => v !== null);
  const r90 = hits.map((h) => h.forward.fwd90).filter((v): v is number => v !== null);
  const mean30 = avg(r30);
  const mean90 = avg(r90);
  const lows = hits.map((h) => h.forward.minLowPct);
  const rallies = hits.map((h) => h.forward.maxRallyPct);
  const troughDays = hits.map((h) => h.forward.daysToTrough);
  const recoveryDays = hits.map((h) => h.forward.daysToRecovery).filter((v): v is number => v !== null);

  const priceLow = price * (1 + avg(lows) / 100);
  const priceHigh = price * (1 + avg(rallies) / 100);

  const supporting = [...hits]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
    .map((h) => ({
      date: h.date, symbol: h.symbol, similarity: h.similarity, fwd90: h.forward.fwd90,
    }));

  const freq = hits.length / Math.max(1, totalCount);

  const narrative =
    kind === "bullish"
      ? `In the ${Math.round(freq * 100)}% of matches that fit this bullish path, price averaged ${signed(mean90)} over 90 trading days after typically rallying ${signed(avg(rallies))} at peak.`
      : kind === "bearish"
        ? `In the ${Math.round(freq * 100)}% of matches that fit this bearish path, price averaged ${signed(mean90)} over 90 days with an average trough of ${signed(avg(lows))} reached in ~${Math.round(avg(troughDays))} days.`
        : `The most common ${Math.round(freq * 100)}% of matches averaged ${signed(mean90)} at 90 days with a range from ${signed(avg(lows))} to ${signed(avg(rallies))}.`;

  return {
    kind, label,
    frequency: freq,
    avgReturn30d: mean30,
    avgReturn90d: mean90,
    priceLow, priceHigh,
    typicalDaysToPeak: rallies.length ? Math.round(avg(troughDays.map((_, i) => (rallies[i] > 0 ? troughDays[i] : 0)))) || null : null,
    typicalDaysToTrough: troughDays.length ? Math.round(avg(troughDays)) : null,
    supporting,
    narrative: recoveryDays.length
      ? `${narrative} Recovery to prior peak took ~${Math.round(avg(recoveryDays))} days on average.`
      : narrative,
  };
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function buildScenarios(r: AnalogSearchResult): ScenarioReport {
  const buckets = bucket(r.matches);
  const total = buckets.bullish.length + buckets.base.length + buckets.bearish.length;
  const price = r.current.price;

  return {
    scenarios: [
      summarize(buckets.base, "base", price, total),
      summarize(buckets.bullish, "bullish", price, total),
      summarize(buckets.bearish, "bearish", price, total),
    ],
    disclaimer:
      "Scenarios are historical clusters from the closest analog matches — not forecasts. Each shows what happened in similar past setups, weighted by how often.",
  };
}
