// FRED ingestion — pulls historical time series from the St. Louis Fed's
// FRED API and upserts them into `market_series`. Idempotent; safe to run
// daily. Every run logs to `data_ingest_runs` for observability.

import { FRED_STARTER_SERIES } from "./fred-series";
export { FRED_STARTER_SERIES } from "./fred-series";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

type FredObservation = { date: string; value: string };
type FredResponse = { observations?: FredObservation[]; error_message?: string };

async function fetchFredSeries(seriesId: string, apiKey: string, sinceIso?: string): Promise<FredObservation[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
  });
  if (sinceIso) params.set("observation_start", sinceIso);
  const url = `${FRED_BASE}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FRED ${seriesId} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as FredResponse;
  if (json.error_message) throw new Error(`FRED ${seriesId}: ${json.error_message}`);
  return json.observations ?? [];
}

export type IngestResult = {
  series_id: string;
  rows_upserted: number;
  status: "ok" | "error";
  error?: string;
  duration_ms: number;
};

export async function ingestFredSeries(
  seriesId: string,
  opts: { fullBackfill?: boolean; sinceDays?: number } = {},
): Promise<IngestResult> {
  const started = Date.now();
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY is not configured");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let runId: string | null = null;
  try {
    const { data: runRow } = await supabaseAdmin
      .from("data_ingest_runs")
      .insert({ source: "fred", series_id: seriesId, status: "running" })
      .select("id")
      .single();
    runId = runRow?.id ?? null;

    let sinceIso: string | undefined;
    if (!opts.fullBackfill) {
      const days = opts.sinceDays ?? 90;
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - days);
      sinceIso = d.toISOString().slice(0, 10);
    }

    const observations = await fetchFredSeries(seriesId, apiKey, sinceIso);
    const rows = observations
      .filter((o) => o.value !== "." && o.value !== "" && o.value != null)
      .map((o) => ({
        source: "fred",
        series_id: seriesId,
        date: o.date,
        value: Number(o.value),
      }))
      .filter((r) => Number.isFinite(r.value));

    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabaseAdmin
        .from("market_series")
        .upsert(chunk, { onConflict: "source,series_id,date" });
      if (error) throw new Error(`upsert failed: ${error.message}`);
      inserted += chunk.length;
    }

    const duration_ms = Date.now() - started;
    if (runId) {
      await supabaseAdmin
        .from("data_ingest_runs")
        .update({
          status: "ok",
          rows_upserted: inserted,
          finished_at: new Date().toISOString(),
          duration_ms,
        })
        .eq("id", runId);
    }
    return { series_id: seriesId, rows_upserted: inserted, status: "ok", duration_ms };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const duration_ms = Date.now() - started;
    if (runId) {
      await supabaseAdmin
        .from("data_ingest_runs")
        .update({
          status: "error",
          error,
          finished_at: new Date().toISOString(),
          duration_ms,
        })
        .eq("id", runId);
    }
    return { series_id: seriesId, rows_upserted: 0, status: "error", error, duration_ms };
  }
}

export async function ingestAllFredStarter(
  opts: { fullBackfill?: boolean; sinceDays?: number } = {},
): Promise<{ results: IngestResult[]; total_rows: number; errors: number }> {
  const results: IngestResult[] = [];
  for (const s of FRED_STARTER_SERIES) {
    // eslint-disable-next-line no-await-in-loop
    const r = await ingestFredSeries(s.series_id, opts);
    results.push(r);
  }
  const total_rows = results.reduce((a, r) => a + r.rows_upserted, 0);
  const errors = results.filter((r) => r.status === "error").length;
  return { results, total_rows, errors };
}
