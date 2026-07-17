// Shared AI agent tools available to both the web /api/chat endpoint and
// the Telegram webhook. All tools are user-scoped: given a userId, they
// read that user's positions, prefs, alerts, and can call market data.
import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

function logToolCall(tool: string, meta: Record<string, unknown>) {
  try {
    console.log(`[agent-tool] ${tool}`, JSON.stringify({ at: new Date().toISOString(), ...meta }));
  } catch {
    /* ignore log failures */
  }
}

/**
 * Grounded market/scanner/analog/earnings/simulation/knowledge tools.
 * These do NOT need a signed-in user and are ALWAYS attached so the model
 * can retrieve verified data instead of fabricating it.
 */
export function buildMarketTools() {
  return {
    get_live_quotes: tool({
      description:
        "Fetch the current live market price for up to 12 symbols using the same Yahoo → Finnhub → TwelveData waterfall the website uses. Returns price, previous close, %change, and the exact quote timestamp. ALWAYS call this before answering any price question. Never guess a price.",
      inputSchema: z.object({ symbols: z.array(z.string()).min(1).max(12) }),
      execute: async ({ symbols }) => {
        const started = Date.now();
        const syms = symbols.map((s) => s.toUpperCase());
        try {
          const { fetchYahooQuoteBatch } = await import("./yahoo-quote.server");
          const { isYahooCircuitOpen } = await import("./yahoo-identities.server");
          const { fetchFinnhubQuoteBatch, hasFinnhubKey } = await import("./finnhub-quote.server");
          const { isYahooOnly } = await import("./market.server");
          const { hasAnyKey, withRotatingKey } = await import("./twelvedata-keys.server");

          const merged: Record<string, import("./quote.server").Quote> = {};
          const sources: Record<string, string> = {};
          let lastErr: string | null = null;

          if (!isYahooCircuitOpen()) {
            try {
              const y = await fetchYahooQuoteBatch(syms);
              for (const [k, v] of Object.entries(y)) { merged[k] = v; sources[k] = "yahoo"; }
            } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
          }
          const afterY = syms.filter((s) => !merged[s] && !isYahooOnly(s));
          if (afterY.length && hasFinnhubKey()) {
            try {
              const f = await fetchFinnhubQuoteBatch(afterY);
              for (const [k, v] of Object.entries(f)) { merged[k] = v; sources[k] = "finnhub"; }
            } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
          }
          const afterF = syms.filter((s) => !merged[s] && !isYahooOnly(s));
          if (afterF.length && hasAnyKey()) {
            try {
              const td = await withRotatingKey((key) => fetchQuoteBatchLoader(key, afterF));
              for (const [k, v] of Object.entries(td)) { merged[k] = v; sources[k] = "twelvedata"; }
            } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
          }

          const fetchedAt = new Date().toISOString();
          const enriched = Object.fromEntries(
            Object.entries(merged).map(([sym, q]) => [
              sym,
              { ...q, quoteAt: q.ts ? new Date(q.ts).toISOString() : null, source: sources[sym], fetchedAt },
            ]),
          );
          const missing = syms.filter((s) => !enriched[s]);
          logToolCall("get_live_quotes", {
            ok: Object.keys(enriched).length > 0,
            latencyMs: Date.now() - started,
            requested: syms.length,
            returned: Object.keys(enriched).length,
            missing,
            lastErr,
          });
          if (Object.keys(enriched).length === 0) {
            return { error: `Live quote fetch failed via Yahoo/Finnhub/TwelveData${lastErr ? `: ${lastErr}` : ""}. Do not fabricate a price — tell the user the live price is temporarily unavailable.` };
          }
          return { quotes: enriched, fetchedAt, missing };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logToolCall("get_live_quotes", { ok: false, error: msg });
          return { error: `Live quote fetch failed: ${msg}. Do not fabricate a price — tell the user the live price is temporarily unavailable.` };
        }
      },
    }),

    run_market_scan: tool({
      description:
        "Run the full LADDRX market scanner (NDX, QQQ, SMH, SOXX, SOXQ + SPY context) — the identical pipeline the website uses. Returns per-symbol price, regime, status, scenario, adaptive ladder, risk, analog, and factors. Use for 'what's the market doing?', 'any setups?', 'scan now'. Every price and metric here is real; never re-write or round them.",
      inputSchema: z.object({ force: z.boolean().optional() }),
      execute: async ({ force }) => {
        const started = Date.now();
        try {
          const { scanUniverse } = await import("./market.functions");
          const res = await scanUniverse({ data: { force: force ?? false } });
          logToolCall("run_market_scan", {
            ok: !res.failed,
            source: "market.functions.scanUniverse",
            scannedAt: res.scannedAt,
            rows: res.rows.length,
            failed: res.failed,
            warning: res.warning ?? null,
            latencyMs: Date.now() - started,
          });
          if (res.failed || res.rows.length === 0) {
            return {
              error: `Scanner returned no rows${res.warning ? `: ${res.warning}` : ""}. Do not invent scanner results — tell the user the scan is temporarily unavailable.`,
              scannedAt: res.scannedAt,
              warning: res.warning ?? null,
            };
          }
          return {
            scannedAt: res.scannedAt,
            source: "laddrx.scanUniverse",
            spyChangePct: res.spyChangePct,
            failed: res.failed,
            warning: res.warning ?? null,
            rows: res.rows.map((r) => ({
              symbol: r.symbol,
              name: r.name,
              price: r.price,
              change1d: r.change1d,
              intraday: r.intraday,
              regime: r.regime,
              regimeLabel: r.regimeLabel,
              status: r.status,
              statusReason: r.statusReason,
              scenarioKey: r.scenarioKey,
              scenarioTitle: r.scenarioTitle,
              riskLevel: r.riskLevel,
              marketContext: r.marketContext,
              confidence: r.confidence,
              setupQuality: r.setupQuality,
              executionConfidence: r.executionConfidence,
              adaptiveLadder: r.adaptiveLadder,
              analogStatus: r.analogStatus,
              analog: r.analog,
              ladderFlags: r.ladderFlags,
              setupFactors: r.setupFactors,
              executionFactors: r.executionFactors,
            })),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logToolCall("run_market_scan", { ok: false, error: msg });
          return { error: `Scanner error: ${msg}. Do not fabricate scanner results.` };
        }
      },
    }),

    get_scanner_recommendations: tool({
      description:
        "Return a compact recommendation list (only symbols showing PROBE / BUY_STARTER / BUY_LADDER) from the latest scanner run.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { scanUniverse } = await import("./market.functions");
          const res = await scanUniverse({ data: { force: false } });
          const active = res.rows.filter((r) => r.status !== "WATCH");
          logToolCall("get_scanner_recommendations", {
            ok: !res.failed,
            scannedAt: res.scannedAt,
            active: active.length,
          });
          if (res.failed) {
            return { error: "Scanner unavailable — do not fabricate recommendations.", scannedAt: res.scannedAt };
          }
          return {
            scannedAt: res.scannedAt,
            source: "laddrx.scanUniverse",
            recommendations: active.map((r) => ({
              symbol: r.symbol,
              price: r.price,
              status: r.status,
              scenario: r.scenarioTitle,
              why: r.statusReason,
              nextRung: r.adaptiveLadder?.[0] ?? null,
              risk: r.riskLevel,
              confidence: r.confidence,
            })),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logToolCall("get_scanner_recommendations", { ok: false, error: msg });
          return { error: `Scanner error: ${msg}` };
        }
      },
    }),

    run_analog_search: tool({
      description:
        "Run the historical analog scanner for one symbol. Returns similarity, probability distribution, expected forward returns, and market phase for the closest past matches.",
      inputSchema: z.object({ symbol: z.string().min(1).max(12) }),
      execute: async ({ symbol }) => {
        try {
          const { computeAnalogFor, evidenceFromResult } = await import("./analog-search.functions");
          const out = await computeAnalogFor(symbol.toUpperCase());
          logToolCall("run_analog_search", { symbol: symbol.toUpperCase(), status: out.status });
          if (out.status !== "ok") {
            return {
              status: out.status,
              reason: "reason" in out ? out.reason : undefined,
              error: `No usable analog for ${symbol.toUpperCase()} right now — do not invent one.`,
            };
          }
          const evidence = evidenceFromResult(out.result);
          return {
            status: "ok",
            source: "laddrx.computeAnalogFor",
            evidence,
            best: out.result.best,
            phase: out.result.marketPhase,
            phaseNarrative: out.result.phaseNarrative,
            aggregate: out.result.aggregate,
            traderAnswers: out.result.traderAnswers,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logToolCall("run_analog_search", { symbol, ok: false, error: msg });
          return { error: `Analog search failed: ${msg}` };
        }
      },
    }),

    get_earnings: tool({
      description: "Return the next earnings date and days-until for a symbol.",
      inputSchema: z.object({ symbol: z.string().min(1).max(12) }),
      execute: async ({ symbol }) => {
        try {
          const { fetchNextEarnings } = await import("./earnings.server");
          const info = await fetchNextEarnings(symbol.toUpperCase());
          logToolCall("get_earnings", { symbol: symbol.toUpperCase(), ok: true });
          return { earnings: info, source: "finnhub", fetchedAt: new Date().toISOString() };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logToolCall("get_earnings", { symbol, ok: false, error: msg });
          return { error: `Earnings lookup failed: ${msg}` };
        }
      },
    }),

    get_app_knowledge: tool({
      description:
        "Look up how a Laddrx feature works (search by keyword, e.g. 'ladder', 'auto-fill', 'validation', 'analog').",
      inputSchema: z.object({ topic: z.string().min(1) }),
      execute: async ({ topic }) => {
        const { matchKnowledge } = await import("./app-knowledge");
        const hits = matchKnowledge(topic, undefined, 4);
        logToolCall("get_app_knowledge", { topic, hits: hits.length });
        return { entries: hits };
      },
    }),
  };
}

async function fetchQuoteBatchLoader(key: string, symbols: string[]) {
  const { fetchQuoteBatch } = await import("./quote.server");
  return fetchQuoteBatch(symbols, key);
}

export function buildServerTools(userId: string, admin: Admin) {
  const marketTools = buildMarketTools();
  return {
    ...marketTools,
    get_my_positions: tool({
      description:
        "Return every open ladder position the signed-in user has: symbol, total capital, scenario, entries, avg cost, deployed capital.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await admin
          .from("positions")
          .select("symbol,total_capital,scenario,created_at,entries,planned_ladder")
          .eq("user_id", userId);
        if (error) return { error: error.message };
        return {
          positions: (data ?? []).map((row) => {
            const entries = Array.isArray(row.entries)
              ? (row.entries as Array<{ shares: number; price: number; pct: number; day: number; auto: boolean; filledAt: string }>)
              : [];
            const shares = entries.reduce((a, e) => a + e.shares, 0);
            const deployed = entries.reduce((a, e) => a + e.shares * e.price, 0);
            return {
              symbol: row.symbol,
              totalCapital: row.total_capital,
              scenario: row.scenario,
              filledPct: entries.reduce((a, e) => a + e.pct, 0),
              shares,
              deployed,
              avgCost: shares > 0 ? deployed / shares : 0,
              entries,
            };
          }),
        };
      },
    }),

    get_notification_preferences: tool({
      description: "Return the user's alert preferences (email, phone, approach/at-zone thresholds).",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await admin
          .from("notification_preferences")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) return { error: error.message };
        return { preferences: data ?? null };
      },
    }),

    list_recent_alerts: tool({
      description: "Return the user's most recent alert deliveries (default 10).",
      inputSchema: z.object({ limit: z.number().min(1).max(50).optional() }),
      execute: async ({ limit }) => {
        const { data, error } = await admin
          .from("alert_deliveries")
          .select("symbol,alert_kind,message,target_price,live_price,distance_pct,created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit ?? 10);
        if (error) return { error: error.message };
        return { alerts: data ?? [] };
      },
    }),

    // Market tools (get_live_quotes, run_market_scan, get_scanner_recommendations,
    // run_analog_search, get_earnings, get_app_knowledge) are spread in from
    // buildMarketTools() above — do NOT re-declare them here.


    get_position: tool({
      description: "Return one specific position for the signed-in user (by symbol).",
      inputSchema: z.object({ symbol: z.string().min(1).max(12) }),
      execute: async ({ symbol }) => {
        const sym = symbol.toUpperCase();
        const { data, error } = await admin
          .from("positions")
          .select("symbol,total_capital,scenario,created_at,entries,planned_ladder")
          .eq("user_id", userId)
          .eq("symbol", sym)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { position: null };
        const entries = Array.isArray(data.entries)
          ? (data.entries as Array<{ shares: number; price: number; pct: number; day: number; auto: boolean; filledAt: string }>)
          : [];
        const shares = entries.reduce((a, e) => a + e.shares, 0);
        const deployed = entries.reduce((a, e) => a + e.shares * e.price, 0);
        return {
          position: {
            symbol: data.symbol,
            totalCapital: data.total_capital,
            scenario: data.scenario,
            createdAt: data.created_at,
            plannedLadder: data.planned_ladder,
            entries,
            shares,
            deployed,
            avgCost: shares > 0 ? deployed / shares : 0,
            filledPct: entries.reduce((a, e) => a + e.pct, 0),
          },
        };
      },
    }),

    get_position_settings: tool({
      description: "Return the user's ladder execution settings (Auto-Fill Detection, Recovery Capture).",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await admin
          .from("position_settings")
          .select("auto_fill,recovery_capture")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) return { error: error.message };
        return {
          settings: {
            autoFill: data?.auto_fill ?? false,
            recoveryCapture: data?.recovery_capture ?? true,
          },
        };
      },
    }),


    list_saved_reports: tool({
      description: "List the user's saved scanner / analog reports (most recent first).",
      inputSchema: z.object({
        symbol: z.string().optional(),
        kind: z.string().optional(),
        limit: z.number().min(1).max(50).optional(),
      }),
      execute: async ({ symbol, kind, limit }) => {
        let q = admin
          .from("scan_reports")
          .select("id,symbol,kind,created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit ?? 20);
        if (symbol) q = q.eq("symbol", symbol.toUpperCase());
        if (kind) q = q.eq("kind", kind);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { reports: data ?? [] };
      },
    }),

    get_saved_report: tool({
      description: "Fetch the full payload of one saved report by id.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const { data, error } = await admin
          .from("scan_reports")
          .select("id,symbol,kind,payload,created_at")
          .eq("user_id", userId)
          .eq("id", id)
          .maybeSingle();
        if (error) return { error: error.message };
        return { report: data ?? null };
      },
    }),


    simulate_ladder: tool({
      description:
        "Run the Sandbox simulation engine with a synthetic scenario. Useful to stress-test the scanner. Scenarios: strong_rally, sharp_decline, consolidation, recovery, volatility_spike, trend_reversal, sector_weakness, flat_market, low_volatility, high_volatility, gap_up, gap_down, prolonged_bear, prolonged_bull, contradictory, sudden_reversal, minimum_history.",
      inputSchema: z.object({
        scenario: z.string(),
        symbolLabel: z.string().default("SIM"),
        seed: z.number().int().min(0).max(2 ** 31 - 1).default(42),
        length: z.number().int().min(400).max(3000).default(750),
      }),
      execute: async ({ scenario, symbolLabel, seed, length }) => {
        try {
          const { runSimulation } = await import("./simulation.functions");
          const res = await runSimulation({
            data: { scenario: scenario as never, symbolLabel, seed, length },
          });
          return {
            ok: res.ok,
            diagnostics: res.diagnostics,
            aggregate: res.result?.aggregate ?? null,
            phase: res.result?.marketPhase ?? null,
            traderAnswers: res.result?.traderAnswers ?? null,
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  };
}

export const AGENT_SYSTEM = `You are LADDRX AI — a conversational trading copilot. Your #1 job is FACTUAL ACCURACY. Users rely on your numbers to make real money decisions.

## THE ONE HARD RULE — no fabricated data, ever

Every price, position, share count, %change, RSI, probability, ladder rung, alert, and scanner reading MUST come from a tool call THIS TURN. You have NO ability to remember or estimate market data. If you did not just receive a value from a tool, you do not know it — say so instead of guessing.

Never invent, estimate, round from memory, or "approximate" a price, holding, or metric. Do not use training data for market prices. Do not carry a price from earlier in the conversation as if it were current — always re-fetch.

## Tool contract

- Price / quote question ("what is SMH at?", "current NVDA price") → call get_live_quotes. Cite the price and the quote timestamp.
- "What are my positions?", "what do I hold?", "what did I fill?" → call get_my_positions (or get_position for one symbol). Only report what the tool returned. If it returned an empty list, say the user has no open ladder positions — do not invent any.
- Scanner / market state / "any setups?" → call run_market_scan or get_scanner_recommendations. Cite scannedAt.
- Historical analog / probabilities / "similar past dips" → call run_analog_search.
- Alerts history → list_recent_alerts. Preferences → get_notification_preferences. Settings → get_position_settings. Saved reports → list_saved_reports / get_saved_report. Earnings → get_earnings. Feature how-to → get_app_knowledge.

## When a tool returns error or empty data

Say plainly what happened and stop. Example: "The live quote feed is temporarily unavailable, so I can't give you a verified price right now." Do NOT substitute a guess, an old value, a "roughly" figure, or a made-up range.

## When no user tools are available

If you were not given user-scoped tools (no signed-in user for this chat), you cannot answer questions about "my positions", "my alerts", or "my settings" — say so plainly. Market/scanner/quote tools still work.

## Style

- Plain-English sentences. Short and warm for casual questions; deeper analysis when asked.
- After every price/number, include a short freshness tag when you have one — e.g. "SMH is $268.14 (quote 10:37 ET)".
- Never dump raw JSON. Never mention tool names.
- Add a one-line "not financial advice" caveat when giving directional interpretation.

## Identity

You use the same scanner, quote provider, and analog engine as the website. Your answers must match the website exactly for the same question at the same time.`;
