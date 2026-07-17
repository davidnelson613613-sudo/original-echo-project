// Client-safe wrappers around FRED ingestion. Callable from the UI by
// authenticated users (e.g. an admin "backfill now" button on the events page).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const runFredBackfillFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fullBackfill?: boolean; sinceDays?: number }) => input)
  .handler(async ({ data }) => {
    const { ingestAllFredStarter } = await import("./fred-ingest.server");
    return ingestAllFredStarter({
      fullBackfill: data.fullBackfill ?? false,
      sinceDays: data.sinceDays ?? 90,
    });
  });

export const runFredSeriesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { series_id: string; fullBackfill?: boolean }) => input)
  .handler(async ({ data }) => {
    const { ingestFredSeries } = await import("./fred-ingest.server");
    return ingestFredSeries(data.series_id, { fullBackfill: data.fullBackfill ?? false });
  });

export const listMarketEventsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("market_events")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const listRecentIngestRunsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("data_ingest_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const marketSeriesCoverageFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Group per (source, series_id) — compute min/max/count.
    const { data, error } = await supabaseAdmin
      .from("market_series")
      .select("source, series_id, date")
      .order("date", { ascending: true });
    if (error) throw new Error(error.message);
    const map = new Map<string, { source: string; series_id: string; count: number; min: string; max: string }>();
    for (const row of data ?? []) {
      const key = `${row.source}|${row.series_id}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { source: row.source, series_id: row.series_id, count: 1, min: row.date, max: row.date });
      } else {
        existing.count += 1;
        if (row.date < existing.min) existing.min = row.date;
        if (row.date > existing.max) existing.max = row.date;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.series_id.localeCompare(b.series_id));
  });
