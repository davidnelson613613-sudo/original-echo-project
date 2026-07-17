import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Quote } from "./quote.server";

// Client-callable batch quote fetch. Used by per-symbol focus mode to
// refresh the highlighted row every ~8s without kicking off a full scan.
//
// Order of providers: Yahoo → Finnhub → TwelveData. Yahoo carries the
// primary load so the site stays responsive overnight without burning
// through TwelveData's per-minute budget; TwelveData only fires for
// symbols Yahoo (and Finnhub) couldn't return.
const inputSchema = z.object({
  symbols: z.array(z.string().min(1).max(12)).min(1).max(12),
});

export type QuoteBatch = { quotes: Record<string, Quote>; at: string; error?: string };

export const fetchQuotes = createServerFn({ method: "GET" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<QuoteBatch> => {
    const { fetchYahooQuoteBatch } = await import("./yahoo-quote.server");
    const { isYahooCircuitOpen } = await import("./yahoo-identities.server");
    const { fetchFinnhubQuoteBatch, hasFinnhubKey } = await import("./finnhub-quote.server");
    const { isYahooOnly } = await import("./market.server");
    const { hasAnyKey, withRotatingKey } = await import("./twelvedata-keys.server");
    const { recordProvider } = await import("./provider-stats.server");

    const merged: Record<string, Quote> = {};
    let lastErr: string | null = null;

    // 1) Yahoo for everything — unless the breaker is open.
    if (!isYahooCircuitOpen()) {
      try {
        Object.assign(merged, await fetchYahooQuoteBatch(data.symbols));
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }

    // 2) Finnhub for equities Yahoo missed.
    const afterYahoo = data.symbols.filter((s) => !merged[s] && !isYahooOnly(s));
    if (afterYahoo.length && hasFinnhubKey()) {
      try {
        Object.assign(merged, await fetchFinnhubQuoteBatch(afterYahoo));
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }

    // 3) TwelveData for whatever's still missing.
    const afterFinnhub = data.symbols.filter((s) => !merged[s] && !isYahooOnly(s));
    if (afterFinnhub.length && hasAnyKey()) {
      const started = Date.now();
      try {
        const { fetchQuoteBatch } = await import("./quote.server");
        const td = await withRotatingKey((key) => fetchQuoteBatch(afterFinnhub, key));
        Object.assign(merged, td);
        recordProvider("twelvedata", Object.keys(td).length > 0, Date.now() - started);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastErr = msg;
        recordProvider("twelvedata", false, Date.now() - started, msg);
      }
    }


    if (Object.keys(merged).length > 0) {
      return { quotes: merged, at: new Date().toISOString() };
    }
    return {
      quotes: merged,
      at: new Date().toISOString(),
      error: lastErr && (/RATE_LIMIT|429/.test(lastErr)) ? "rate_limit" : "fetch_failed",
    };
  });
