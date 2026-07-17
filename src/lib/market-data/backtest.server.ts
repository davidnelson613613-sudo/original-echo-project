// Validation framework — evaluates the composite Systemic Risk Score against
// historical market events. Measures:
//  - Precision / recall / F1: was risk "Elevated+" before major drawdowns?
//  - Lead time: how many months before each severe event did we cross 50?
//  - Reliability: predicted risk deciles vs. realized 6m drawdown incidence.

export type BacktestMetrics = {
  n_dates: number;
  n_events: number;
  precision: number;
  recall: number;
  f1: number;
  lead_time_months_mean: number | null;
  lead_time_months_median: number | null;
  covered_events: { slug: string; name: string; start_date: string; lead_time_months: number | null; max_pre_event_score: number }[];
};

export type ReliabilityBin = { decile: number; n: number; mean_predicted: number; hit_rate: number };

export async function runBacktest(opts: { startIso?: string; endIso?: string }): Promise<{
  metrics: BacktestMetrics;
  reliability: ReliabilityBin[];
  scope_start: string;
  scope_end: string;
}> {
  const { loadSeriesMap, computeVectorSeries } = await import("./features.server");
  const { runAllModels, composite } = await import("./scoring.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const sm = await loadSeriesMap();
  const scope_start = opts.startIso ?? "1970-01-01";
  const scope_end = opts.endIso ?? new Date().toISOString().slice(0, 10);

  const series = computeVectorSeries(sm, scope_start, scope_end);
  const scored = series.map((fv) => {
    const models = runAllModels(fv);
    const c = composite(fv, models);
    return { as_of: fv.as_of, score: c.composite };
  });

  const { data: events } = await supabaseAdmin
    .from("market_events")
    .select("slug, name, category, start_date, severity, peak_drawdown")
    .in("category", ["bear_market", "recession", "credit_crisis", "banking_crisis", "liquidity_event"]);

  const relevantEvents = (events ?? []).filter((e) =>
    e.start_date >= scope_start && e.start_date <= scope_end && (e.severity === "severe" || e.severity === "moderate"),
  );

  // "Alerted" if score >= 50 in the 12 months prior to event start
  const covered_events: BacktestMetrics["covered_events"] = [];
  const leadTimes: number[] = [];
  let hits = 0;
  for (const ev of relevantEvents) {
    const t = new Date(ev.start_date).getTime();
    const lo = t - 365 * 86_400_000;
    const window = scored.filter((s) => {
      const st = new Date(s.as_of).getTime();
      return st >= lo && st < t;
    });
    const max = window.reduce((m, s) => (s.score > m ? s.score : m), 0);
    const alertMonth = window.find((s) => s.score >= 50);
    let lead: number | null = null;
    if (alertMonth) {
      const monthsBefore = (t - new Date(alertMonth.as_of).getTime()) / (30 * 86_400_000);
      lead = Math.round(monthsBefore * 10) / 10;
      leadTimes.push(lead);
      hits += 1;
    }
    covered_events.push({
      slug: ev.slug,
      name: ev.name,
      start_date: ev.start_date,
      lead_time_months: lead,
      max_pre_event_score: max,
    });
  }

  // Precision: of all "alert" months (score >= 50), how many were within 12m before an event
  const alertMonths = scored.filter((s) => s.score >= 50);
  const eventStartTimes = relevantEvents.map((e) => new Date(e.start_date).getTime());
  const truePositives = alertMonths.filter((s) => {
    const st = new Date(s.as_of).getTime();
    return eventStartTimes.some((et) => et >= st && et - st <= 365 * 86_400_000);
  }).length;
  const precision = alertMonths.length > 0 ? truePositives / alertMonths.length : 0;
  const recall = relevantEvents.length > 0 ? hits / relevantEvents.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const meanLead = leadTimes.length ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : null;
  const medLead = leadTimes.length ? [...leadTimes].sort((a, b) => a - b)[Math.floor(leadTimes.length / 2)] : null;

  const metrics: BacktestMetrics = {
    n_dates: scored.length,
    n_events: relevantEvents.length,
    precision,
    recall,
    f1,
    lead_time_months_mean: meanLead,
    lead_time_months_median: medLead,
    covered_events,
  };

  // Reliability bins — probability that any event started within 12m after this date
  const bins: ReliabilityBin[] = [];
  for (let d = 0; d < 10; d++) {
    const lo = d * 10;
    const hi = (d + 1) * 10;
    const inBin = scored.filter((s) => s.score >= lo && s.score < hi);
    if (inBin.length === 0) {
      bins.push({ decile: d, n: 0, mean_predicted: (lo + hi) / 2, hit_rate: 0 });
      continue;
    }
    const meanPred = inBin.reduce((a, s) => a + s.score, 0) / inBin.length;
    const hits = inBin.filter((s) => {
      const st = new Date(s.as_of).getTime();
      return eventStartTimes.some((et) => et > st && et - st <= 365 * 86_400_000);
    }).length;
    bins.push({ decile: d, n: inBin.length, mean_predicted: meanPred, hit_rate: hits / inBin.length });
  }

  await supabaseAdmin.from("systemic_risk_v2_backtests").insert({
    scope_start,
    scope_end,
    metrics,
    reliability_bins: bins,
    lead_time_stats: { mean_months: meanLead, median_months: medLead, n_hits: leadTimes.length },
    notes: `Composite alert threshold: 50. Events: severe+moderate bear/recession/credit/banking/liquidity.`,
  });

  return { metrics, reliability: bins, scope_start, scope_end };
}
