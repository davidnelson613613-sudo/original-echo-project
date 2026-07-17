# REBUILD.md — LADDRX Auto-Router Complete Recovery Blueprint

> **Purpose.** Self-contained specification for rebuilding the entire LADDRX
> Auto-Router application from a ZIP export of the source. A competent AI or
> human developer should be able to read this document, inspect the exported
> source, and reproduce the app faithfully — no chat history, no hidden
> context. **Whenever a feature is added, removed, renamed or reworked,
> update the relevant section.** This is the single source of truth for a
> rebuild.

---

## 1. Application Overview

**Name:** LADDRX Auto-Router — Institutional Position Sizing Terminal.

**One-liner.** A quantitative dip-buying and position-sizing terminal that
scans a focused universe of index and semiconductor ETFs, generates a
regime-aware adaptive buy-ladder, tracks partial fills, runs a
Historical Pattern Recognition Scanner against decades of daily bars, and
provides an AI copilot reachable from both the web UI and a Telegram bot.
Optional cron loop scans every 5 minutes during US market hours and pushes
proactive Telegram alerts when a symbol enters or approaches a buy zone.

**Users.** A single retail/prosumer trader per account. It is *not* a broker
— it does not place orders. It scores dips, recommends actions
(WATCH / PROBE / BUY_STARTER / BUY_LADDER), builds rung-by-rung ladders, and
(opt-in) auto-logs partial fills from scan-time prices.

**Universe (scored):** `NDX`, `QQQ`, `SMH`, `SOXX`, `SOXQ`.
**Context symbol (fetched, not scored):** `SPY`.

**Problems solved.**
1. Discretionary dip-buying is emotional/inconsistent → deterministic regime label + ladder.
2. Traders lose track of fills → Positions panel persists fills in Supabase and shows avg cost.
3. Hard to know if a dip is normal or catastrophic → Historical Analog Scanner returns closest match + forward outcomes.
4. Scanner changes risk silent regressions → Simulation & Validation sandbox at `/simulation` and `/simulation/validation`.

---

## 2. Technology Stack

- **Framework:** TanStack Start v1.168+ (file-based routing, `createServerFn`, server routes), React 19, Vite 8, TypeScript 5.8 strict.
- **Runtime target:** Cloudflare Workers (via Nitro 3 beta) with `nodejs_compat`. SSR entry redirected to `src/server.ts` (custom `fetch` handler with h3 500-body sanitization).
- **Styling:** Tailwind v4 (`@tailwindcss/vite`) with `tw-animate-css`, tokens in `src/styles.css`. shadcn/ui component set in `src/components/ui/*` (Radix primitives).
- **Data / AI on the client:** TanStack Query 5, TanStack Router 1, `ai` v7 + `@ai-sdk/react` + `@ai-sdk/openai-compatible`.
- **Backend:** Supabase (Postgres + Auth + RLS) accessed through:
  - `@/integrations/supabase/client` (publishable-key browser client, persists session in localStorage).
  - `@/integrations/supabase/client.server` (`supabaseAdmin`, service-role, server-only, lazy Proxy).
  - `@/integrations/supabase/auth-middleware` (`requireSupabaseAuth` for `createServerFn`).
- **Auth broker:** `@lovable.dev/cloud-auth-js` for Google OAuth (`src/integrations/lovable/index.ts`) → hands tokens to `supabase.auth.setSession`. Plus email/password and anonymous guest sessions via native Supabase Auth.
- **AI Gateway:** Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1`) via `LOVABLE_API_KEY`. Model used server-side: `google/gemini-2.5-flash`.
- **Market data providers (priority order):**
  1. **Yahoo Finance** (primary, unauthenticated) — 10,000-fingerprint rotation for anti-abuse.
  2. **Stooq** (CSV fallback for daily bars).
  3. **TwelveData** (pooled up to 12 keys for scan quotes + intraday + analog history).
  4. **Finnhub** (fallback live quote + fallback earnings, gated on `FINNHUB_API_KEY`).
  5. **FMP (Financial Modeling Prep)** (primary next-earnings source, gated on `FMP_API_KEY`).
- **Telegram:** Lovable Connector Gateway (`connector-gateway.lovable.dev/telegram`) using `LOVABLE_API_KEY` + `TELEGRAM_API_KEY`. Webhook secret derived deterministically as `sha256("telegram-webhook:"+TELEGRAM_API_KEY)` (base64url).
- **Scheduling:** Postgres `pg_cron` + `pg_net` posting to `/api/public/hooks/scan-tick` every 5 minutes and a daily pre-market warmup at 13:25 UTC weekdays.
- **Package manager:** Bun (`bunfig.toml` sets a 24-hour supply-chain hold with an allow-list for Lovable packages). `package-lock.json` is also committed.

Full dependency snapshot lives in `package.json`; do not omit any listed
package when rebuilding.

---

## 3. Repository Layout

```
.
├── .env                              # publishable Supabase config (VITE_ + non-VITE mirrors)
├── .lovable/{plan.md, project.json}
├── AGENTS.md                         # short agent guidance
├── LADDER_PARAMS_REPORT.md           # ladder tuning notes
├── REBUILD.md                        # THIS FILE
├── bun.lock, package-lock.json, package.json
├── bunfig.toml                       # supply-chain guard
├── components.json                   # shadcn config
├── eslint.config.js, tsconfig.json, .prettierrc, .prettierignore
├── vite.config.ts                    # wraps @lovable.dev/vite-tanstack-config
├── public/                           # static assets
├── supabase/
│   ├── config.toml                   # generated Supabase project config (do not edit)
│   └── migrations/                   # ordered SQL migrations (see §9)
└── src/
    ├── router.tsx                    # createRouter with per-request QueryClient
    ├── server.ts                     # Worker fetch entry, h3 500 sanitizer
    ├── start.ts                      # createStart(): registers attachSupabaseAuth
    ├── routeTree.gen.ts              # AUTO-GENERATED — never hand-edit
    ├── styles.css                    # Tailwind v4 tokens + @theme
    ├── integrations/
    │   ├── lovable/index.ts          # Google OAuth broker wrapper
    │   └── supabase/
    │       ├── client.ts             # publishable-key browser client (autogen)
    │       ├── client.server.ts      # service-role admin (autogen)
    │       ├── auth-middleware.ts    # requireSupabaseAuth (autogen)
    │       ├── auth-attacher.ts      # attaches Bearer to serverFn calls (autogen)
    │       └── types.ts              # generated Database types (autogen)
    ├── hooks/use-mobile.tsx          # viewport breakpoint hook
    ├── components/                   # see §12
    │   ├── ai-elements/*             # streamdown chat primitives
    │   ├── sim/{HistoricalReplayPanel,SensitivityPanel}.tsx
    │   └── ui/*                      # shadcn primitives
    ├── lib/                          # see §11 (business + server logic)
    │   └── validation/               # /simulation/validation dashboard support
    └── routes/                       # see §4
        ├── __root.tsx                # HTML shell + providers
        ├── auth.tsx                  # public sign-in (email/pw/google/anon)
        ├── _authenticated/
        │   ├── route.tsx             # ssr:false layout gate (integration-managed)
        │   ├── index.tsx             # main dashboard
        │   ├── ai.tsx                # full-page chat
        │   ├── simulation.tsx        # sandbox
        │   └── simulation.validation.tsx  # validation dashboard
        └── api/
            ├── chat.ts               # streaming chat endpoint
            ├── explain.ts            # explainer endpoint
            ├── explain-stt.ts        # speech-to-text explainer
            └── public/
                ├── hooks/scan-tick.ts        # cron target
                └── telegram/webhook.ts        # Telegram bot webhook
```

`src/pages/` MUST NOT exist. All routing is file-based under `src/routes/`.
`src/integrations/supabase/*` (except types) are integration-managed; do not
hand-edit.

---

## 4. Routing

Everything under `src/routes/_authenticated/` is protected by
`_authenticated/route.tsx` (`ssr: false`), which calls
`supabase.auth.getUser()` in `beforeLoad` and redirects to `/auth` when no
user exists. Public routes are top-level.

| Path | File | Auth | Purpose |
|---|---|---|---|
| `/` | `_authenticated/index.tsx` | required | Main dashboard: universe scan, ladder, positions, historical analog, alerts. |
| `/ai` | `_authenticated/ai.tsx` | required | Full-page AI chat surface. |
| `/simulation` | `_authenticated/simulation.tsx` | required | Synthetic + historical replay sandbox for the scanner. |
| `/simulation/validation` | `_authenticated/simulation.validation.tsx` | required | Aggregated validation metrics dashboard. |
| `/auth` | `auth.tsx` | public | Sign-in / sign-up: email+password, Google (via Lovable broker), anonymous guest. |
| `/api/chat` | `api/chat.ts` | required (attaches Bearer) | Streaming AI chat, shared tools from `ai-agent.server.ts`. |
| `/api/explain` | `api/explain.ts` | required | Natural-language explanation of scan/analog output. |
| `/api/explain-stt` | `api/explain-stt.ts` | required | Speech-to-text pass-through. |
| `/api/public/hooks/scan-tick` | `api/public/hooks/scan-tick.ts` | apikey header | pg_cron target: runs `runScanTick()`. |
| `/api/public/telegram/webhook` | `api/public/telegram/webhook.ts` | secret token | Telegram Bot API webhook handler. |

**Public route metadata:** `__root.tsx` defines base `<head>` (title,
description, OG/Twitter). Leaf routes may override.

**Sign-in affordance in the top nav must reflect session** — the root route
subscribes to `supabase.auth.onAuthStateChange` and invalidates the router
on `SIGNED_IN` / `SIGNED_OUT` / `USER_UPDATED`.

---

## 5. Environment Variables & Secrets

### Client-visible (via `.env`, prefixed `VITE_`)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- Non-prefixed mirrors (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID`) for SSR fallback.

### Server-only (Lovable Cloud secrets)
- `SUPABASE_SERVICE_ROLE_KEY` — service-role for `supabaseAdmin`.
- `LOVABLE_API_KEY` — Lovable AI Gateway + connector gateway auth.
- `TELEGRAM_API_KEY` — Lovable connector key for Telegram gateway (also used to derive the webhook secret).
- `TWELVEDATA_API_KEY`, `TWELVEDATA_API_KEY_2` .. `TWELVEDATA_API_KEY_12` — main TwelveData pool (up to 12 rotating keys).
- `TWELVEDATA_ANALOG_API_KEY_1`, `TWELVEDATA_ANALOG_API_KEY_2` — analog-scanner-dedicated pool; falls back to main pool.
- `FINNHUB_API_KEY` — fallback live quote + fallback earnings.
- `FMP_API_KEY` — primary next-earnings.

Read all server-only secrets **inside handlers** via `process.env`, never
at module scope in shared files.

---

## 6. Database Schema (Supabase Postgres)

All tables live in `public`, all have RLS enabled, all follow the GRANT
pattern from the Lovable stack rules. Full column definitions live in
`src/integrations/supabase/types.ts` (generated); this section is
functional summary.

### 6.1 Tables

- **`profiles`** (`id uuid PK = auth.uid()`, `email`, `display_name`,
  timestamps) — created by trigger on `auth.users` insert.
- **`positions`** (`id`, `user_id`, `symbol`, `total_capital numeric`,
  `scenario text`, `entries jsonb`, `planned_ladder jsonb`, timestamps;
  UNIQUE `(user_id, symbol)`). Replaces the old `localStorage
  "qs_positions_v2"` for authenticated users.
- **`position_settings`** (`user_id PK`, `auto_fill bool`,
  `recovery_capture bool`).
- **`notification_preferences`** (`user_id PK`, `email_enabled`,
  `phone_enabled`, `email_address`, `phone_number`,
  `approach_threshold_pct`, `at_threshold_pct`,
  `approaching_buy_enabled`, `at_buy_zone_enabled`, `quiet_minutes`).
- **`alert_deliveries`** (`id`, `user_id`, `symbol`, `alert_key text`
  (UNIQUE per user), `alert_kind text`, `message`, `target_price`,
  `live_price`, `distance_pct`, `email_status`, `phone_status`,
  `created_at`) — audit log; `alert_key` is the idempotency key used
  by `scan-runner.server.ts` to avoid duplicate sends.
- **`chat_conversations`** (`id`, `user_id`, `title`,
  `source text default 'web'` — `'web' | 'telegram'`).
- **`chat_messages`** (`id`, `conversation_id FK`, `user_id`,
  `role check ('user'|'assistant'|'system'|'tool')`, `content jsonb`,
  `created_at`).
- **`telegram_links`** (`user_id PK`, `chat_id bigint UNIQUE`,
  `telegram_username`, `linked_at`).
- **`telegram_link_codes`** (`code PK`, `user_id`, `expires_at`) —
  one-time linking codes.
- **`scan_reports`** (`id`, `user_id`, `symbol`, `kind`, `title`,
  `payload jsonb`, `created_at`) — persisted scanner / analog reports.
- **`market_scan_snapshots`** (`id text PK`, `scanned_at`,
  `rows_count`, `failed_count`, `spy_change_pct`, `payload jsonb`,
  `warning`, `updated_at`) — cron scan cache. `authenticated`-readable
  only after migration `20260714195443` (previously `anon`-readable).

### 6.2 RLS policy pattern

Every user-owned table: separate SELECT / INSERT / UPDATE / DELETE
policies, all keyed on `auth.uid() = user_id`. `telegram_links`
additionally enforces `(auth.jwt() ->> 'is_anonymous')::boolean IS NOT
TRUE` on all four commands (fix for the anon-access finding).
`market_scan_snapshots` allows only `authenticated` role SELECT via
`Authenticated users read snapshots` policy. Anon has no SELECT.

### 6.3 Functions & triggers

- `update_updated_at_column()` — SECURITY DEFINER, sets `NEW.updated_at =
  now()`. Applied via trigger to tables that carry `updated_at`.
- Profile-create trigger on `auth.users` insert (created in the first
  migration) inserts a matching `profiles` row.

### 6.4 pg_cron jobs (migration `20260714190528`)

Two jobs, both POST to
`https://project--980457ed-4fc2-4af4-9e03-1069d7577a4a-dev.lovable.app/api/public/hooks/scan-tick`
with the `apikey` header set to the publishable key:

1. `scan-tick-5min` — `*/5 * * * *` (every 5 min).
2. `scan-tick-premarket-warmup` — `25 13 * * 1-5` (weekdays 13:25 UTC), body `{"force": true}`.

`runScanTick()` self-gates on `isUsMarketHours()` unless `force:true`.

### 6.5 Migrations (in order)

- `20260713180057` — initial: profiles, positions, position_settings, notification_preferences, alert_deliveries, chat_conversations, chat_messages, updated_at fn/triggers, RLS baseline.
- `20260713200005` — telegram_links + telegram_link_codes.
- `20260714062416` — scan_reports.
- `20260714174312` — market_scan_snapshots table.
- `20260714183741`, `20260714183809` — market_scan_snapshots policy tightening (initial versions).
- `20260714190528` — pg_cron / pg_net jobs.
- `20260714195443` — security hardening: telegram_links INSERT/UPDATE policies + `is_anonymous` guard on all four; market_scan_snapshots SELECT locked to `authenticated`.

---

## 7. Market Data Layer

### 7.0 Who powers what (plain-English cheat sheet)

**READ THIS FIRST on every remix.** Three providers, each with a fixed job.
None of them are interchangeable — swapping the order breaks things.

**Yahoo Finance — KEYLESS, no secret required, must never be given a key.**

Yahoo is the "free deep history + indices" provider. It powers:

- **Historical Analog Scanner** — the entire daily OHLC history (up to
  ~25 years back), split+dividend adjusted. This is Yahoo's most
  important job in the app. Without it the analog scanner has nothing to
  match against. See `yahoo.server.ts` → `fetchYahooDaily` and
  `analog-search.server.ts` → `fetchLongHistory` (Yahoo primary,
  Stooq fallback).
- **Index live quotes** — `^NDX`, `^GSPC` (SPX), `^DJI`, `^IXIC`, `^VIX`.
  TwelveData's free tier does NOT serve these five index symbols, so
  Yahoo is the primary source. `NDX` also has a second keyless hard
  fallback through Nasdaq's official public index quote endpoint, so NDX
  must not blank if Yahoo returns 429. See `yahoo-quote.server.ts` and
  `nasdaq-index.server.ts`.
- **Fallback quotes for stock symbols** when TwelveData is rate-limited
  or missing a symbol. See `quote.functions.ts` — TwelveData primary,
  Yahoo fills the gaps.
- **Backup daily bars for the scan path** when TwelveData daily is
  exhausted (`market.server.ts` → Yahoo fallback branch).

Yahoo has NO API key and NO secret to set. Its "connection" is entirely
the 10,000-fingerprint identity rotation in
`src/lib/yahoo-identities.server.ts` (see §7.2). If NDX or the analog
scanner "isn't working," the cause is usually Yahoo returning HTTP 429
to Cloudflare Worker egress IPs — that is a rate-limit response, not a
wiring problem. There is nothing to plug in. **NDX is special:** it must
fall through to `nasdaq-index.server.ts` (Nasdaq official quote/history)
before the UI reports missing data.

**TwelveData — REQUIRES 5 keys (`TWELVEDATA_API_KEY` + `_2`..`_5`), lowercase.**

TwelveData is the "live market + intraday" provider. It powers:

- **Live quotes for all non-index stocks** during a scan
  (`quote.server.ts` → `fetchQuoteBatch`, pooled across 5 rotating
  keys via `twelvedata-keys.server.ts`).
- **Intraday 5-minute bars** used by the intraday analog projection
  and the "V-Bounce / Fast Crash" regime detector
  (`intraday-analog.server.ts`, `market.server.ts`).
- **Sector proxy quotes** for the scan universe.
- **Analog overflow** — an optional 2-key dedicated pool
  (`TWELVEDATA_ANALOG_API_KEY_1/_2`) can be added; if absent the analog
  scanner just uses the main pool.

TwelveData keys are **32-char lowercase hex** and case-sensitive on
their side. A key pasted as uppercase (`85BC82E6…`) will silently 401
with `apikey parameter is incorrect`, which cascades into "no data
anywhere" because Yahoo then absorbs 5× the load and 429s. Always
store lowercase.

**Finnhub — REQUIRES 1 key (`FINNHUB_API_KEY`), lowercase.**

Finnhub is the "last-resort fallback" provider. It powers:

- **Backup live quote** when both TwelveData and Yahoo fail for a symbol
  (`finnhub-quote.server.ts`).
- **Backup earnings-date lookup** when FMP is missing a symbol
  (`earnings.server.ts`).

Finnhub tokens are also lowercase and case-sensitive.

**One-line summary:** Yahoo = free history + indices (no key).
TwelveData = live quotes + intraday (5 lowercase keys).
Finnhub = fallback quote + fallback earnings (1 lowercase key).

### 7.1 Provider priority (execution order)

For daily/adjusted OHLC used by the Historical Analog Scanner:

1. Yahoo Finance (`yahoo.server.ts`) — `period1=0`, `period2=now`,
   `events=split|div`, `interval=1d`, adjusted for splits and
   dividends to match TwelveData's adjusted OHLC (critical for
   NVDA/TSLA/AAPL/GOOG/AMZN pre-split analog accuracy).
   **Never** use Yahoo's `range=max`; it silently truncates deep
   history (e.g. SMH to ~1yr).
2. Nasdaq official index history (`nasdaq-index.server.ts`) — NDX-only,
   keyless hard fallback when Yahoo 429s or returns no bars. This is the
   "NDX must never go blank" safety net.
3. Stooq (`stooq.server.ts`) — daily CSV fallback for symbols Stooq serves.
4. TwelveData analog pool (`twelvedata-analog-keys.server.ts` → 2 dedicated keys + main pool overflow, per-key 60-min exhaustion cache).

For live quotes & scan intraday:
- TwelveData main pool (up to 12 keys) via `twelvedata-keys.server.ts` for non-index symbols.
- Yahoo quote fallback for indices and any symbol TwelveData rejects.
- Nasdaq official quote fallback for `NDX` when Yahoo is throttled.
- Finnhub batch (`finnhub-quote.server.ts`) as final fallback when both TwelveData and Yahoo are exhausted.

### 7.2 Yahoo 10,000-identity rotation (`yahoo-identities.server.ts`)

The fingerprint pool is defined once in `src/lib/yahoo-identities.server.ts`
and imported by both `yahoo.server.ts` (deep-history / analog) and
`market.server.ts` (scan path) so the two Yahoo hot paths cannot drift.
It is fully enumerated (nested loop — no modulo aliasing) from
**2 hosts × 100 User-Agents × 50 Accept-Language values = 10,000 unique
fingerprints**. Round-robin `yahooRR` counter (per file) selects the next
identity per request; per-slot cooldown on 429/999. Yahoo only serves the
two `query{1,2}.finance.yahoo.com` chart hosts, so growth beyond 10,000
must come from adding UAs or langs to the shared module — never by
hand-editing the individual server files. HOST is the innermost loop so
adjacent attempts alternate between query1/query2; without that, the first
thousands of requests would all hit query1 and Yahoo 429s while query2 sits
idle.

### 7.3 TwelveData key rotation

`twelvedata-keys.server.ts` reads `TWELVEDATA_API_KEY` and `_2` through
`_12`, dedupes and trims, then rotates with a shared 60-min exhaustion
cache keyed on the failing key. `twelvedata-analog-keys.server.ts`
overlays the analog-dedicated pair on top of the main pool for
deep-history fetches.

### 7.4 Market snapshot pipeline

`market.functions.ts` exposes two `createServerFn` GET endpoints
(no auth, public data): `getMarketSnapshot`, `scanUniverse`. Both delegate
to `market.server.ts::computeSnapshot()` which:

1. Fetches daily bars (Yahoo primary, TwelveData fallback).
2. Fetches intraday (TwelveData → Yahoo → Finnhub).
3. Runs `rsiWilder`, `computeIntradayMetrics`, `classifyRegime`
   (six regimes: `NEUTRAL / BULL_QUIET / BULL_VOL / BEAR_QUIET /
   BEAR_VOL / CHOP`, see `REGIME_META`).
4. Scores dip with `scoreDip()`, returns status (`WATCH / PROBE /
   BUY_STARTER / BUY_LADDER`), scenario, adaptive ladder, risk level,
   analog snapshot, and factor breakdowns (`setupFactors`,
   `executionFactors`, `ladderFlags`).

Result shape is what `ai-agent.server.ts::run_market_scan` slices for
the AI tool response.

### 7.5 Earnings

`earnings.server.ts::fetchNextEarnings(symbol)` — FMP primary (uses
`FMP_API_KEY`), Finnhub fallback. Returns `{ nextDate, daysUntil }`.

---

## 8. Historical Analog Scanner

Five files:

- `analog-search.server.ts` (~1456 lines) — core engine.
  - `fetchLongHistory()` — deep-history fetch through the provider chain.
  - `computeAllFeatures()` — per-window feature vector (drawdown depth, RSI Wilder, volume z-score, price/MA ratios, ATR%, gap history, days-since-high).
  - `attachMarketContext()` — enriches each window with SPY / sector index features.
  - `buildBenchmarkIndex()`, `buildSectorIndex()` — corpus builders.
  - `classifyMarketPhase()` — 4-phase classifier (`BEAR / BEAR_TO_RECOVERY / RECOVERY / BULL`) w/ narrative.
  - `searchAnalogs()` — cosine + weighted-distance similarity, filters, returns `AnalogHit[]`.
  - `toSummary()` — trims to shipping-safe payload.
  - Exported types: `WindowFeatures`, `BottomType`, `MarketPhase`,
    `ForwardOutcome`, `AnalogHit`, `AnalogAggregate`,
    `HorizonExpectation`, `TraderAnswers`, `AnalogSearchResult`.
- `analog-search.functions.ts` — `findHistoricalAnalog` (GET server fn),
  plus `computeAnalogFor`/`evidenceFromResult` helpers reused by the AI
  agent tool.
- `analog-scenarios.ts` — scenario labels (e.g. "shallow buyable pullback",
  "capitulation") mapped from feature clusters.
- `analog-probabilities.ts` — forward-return probability distributions
  (percentiles over horizons: 5D, 20D, 60D).
- `analog-narrative.ts` — plain-English rendering used by
  `HistoricalAnalogPanel.tsx` and the AI copilot.

`intraday-analog.server.ts` + `intraday-analog.functions.ts` is a
separate pipeline for intraday analog projection surfaced through
`IntradayAnalogChart.tsx`.

Data-freshness guarantee: every analog request runs live; the scanner
never reuses a cached hit unless it is the current live scan. Yahoo/
TwelveData responses are per-call; the only cache is the
`market_scan_snapshots` row keyed by scan id.

---

## 9. Server Functions Inventory (`createServerFn`)

All `*.functions.ts` files. Auth column: `pub` = no middleware,
`auth` = `requireSupabaseAuth`.

| File | Function | Method | Auth | Notes |
|---|---|---|---|---|
| `market.functions.ts` | `getMarketSnapshot` | GET | pub | zod input, wraps `computeSnapshot`. |
| `market.functions.ts` | `scanUniverse` | GET | pub | Universe scan; feeds dashboard + AI. |
| `analog-search.functions.ts` | `findHistoricalAnalog` | GET | pub | Symbol + trader answers → AnalogSearchResult. |
| `intraday-analog.functions.ts` | `getIntradayAnalogProjection` | GET | pub | Intraday projection. |
| `quote.functions.ts` | `fetchQuotes` | GET | pub | Batch quotes. |
| `simulation.functions.ts` | `runSimulation` | POST | pub | Synthetic scenario runner. |
| `simulation.functions.ts` | `analyzeSimulationReport` | POST | pub | AI narrative over sim result. |
| `simulation.functions.ts` | `runHistoricalReplay` | POST | pub | Walk-forward replay. |
| `simulation.functions.ts` | `runSensitivity` | POST | pub | Parameter sweep. |
| `positions.functions.ts` | `listPositionsFn` | GET | auth | Reads user's `positions` rows. |
| `positions.functions.ts` | `upsertPositionFn` | POST | auth | Upsert on (user_id, symbol). |
| `positions.functions.ts` | `deletePositionFn` | POST | auth | Delete by symbol. |
| `positions.functions.ts` | `getSettingsFn` | GET | auth | Reads `position_settings`. |
| `positions.functions.ts` | `updateSettingsFn` | POST | auth | Upserts `position_settings`. |
| `telegram-link.functions.ts` | `mintTelegramLinkCode` | POST | auth | Inserts row in `telegram_link_codes`. |
| `telegram-link.functions.ts` | `getTelegramLink` | GET | auth | Returns current link. |
| `telegram-link.functions.ts` | `unlinkTelegram` | POST | auth | Deletes user's `telegram_links` row. |
| `telegram-alerts.functions.ts` | `sendTelegramAlert` | POST | auth | Sends a formatted alert via gateway. |
| `telegram-alerts.functions.ts` | `sendTelegramTest` | POST | auth | Sends a test message. |

Bearer attachment: `src/start.ts` registers `attachSupabaseAuth`
(`functionMiddleware`) globally, so every serverFn call from the browser
carries `Authorization: Bearer <access_token>`.

---

## 10. Server-Only Helpers (`*.server.ts`)

- `market.server.ts` (~1369 lines) — snapshot engine (see §7).
- `yahoo.server.ts` — Yahoo fetchers + 10,000-identity rotation (see §7.2).
- `stooq.server.ts` — Stooq CSV fallback.
- `twelvedata-keys.server.ts` — main TwelveData rotation (12 keys).
- `twelvedata-analog-keys.server.ts` — analog-dedicated rotation.
- `finnhub-quote.server.ts` — Finnhub batch quotes.
- `quote.server.ts` — generic quote fetcher (`fetchQuoteBatch`).
- `analog-search.server.ts`, `intraday-analog.server.ts` — analog engines (see §8).
- `earnings.server.ts` — FMP + Finnhub earnings.
- `ai-gateway.server.ts` — `createLovableAiGatewayProvider(LOVABLE_API_KEY)` returning an `@ai-sdk/openai-compatible` provider pointed at `ai.gateway.lovable.dev/v1`, with `X-Lovable-AIG-SDK: vercel-ai-sdk` header.
- `ai-agent.server.ts` — **`buildServerTools(userId, admin)`** and **`AGENT_SYSTEM`** prompt. Shared by `/api/chat` (web) and Telegram webhook. See §13.
- `scan-runner.server.ts` — cron body (`runScanTick`), market-hours gate, per-symbol threshold evaluation, Telegram send via connector gateway, `alert_deliveries` audit write with idempotency key `symbol:kind:target_bucket`.

---

## 11. Client-Safe Libraries (`src/lib/*` non-server)

- `app-bridge.ts` — legacy client-side AI tool wiring (kept for the in-page `AiBubble`); the authoritative tool set is now `ai-agent.server.ts`.
- `app-knowledge.ts` — searchable knowledge base of Laddrx feature descriptions used by the `get_app_knowledge` AI tool (`matchKnowledge`).
- `analog-narrative.ts`, `analog-probabilities.ts`, `analog-scenarios.ts` — pure functions consumed by both server and client.
- `brackets.ts` — bracket-exit math for `BracketExitDisplay.tsx`.
- `chat-storage.ts` — legacy localStorage chat store (still used by web bubble for guest chats before hydration).
- `csv-export.ts` — CSV export helper for `CsvExportButton.tsx`.
- `error-capture.ts`, `error-page.ts`, `lovable-error-reporting.ts` — error boundary support.
- `ladder-params.json` — tuned ladder parameters (rung count/spacing per scenario/regime).
- `positions.ts` — client-side positions logic (legacy shape) still used for offline / guest sessions.
- `positions-shared.ts` — shared types between client + server.
- `positions.functions.ts` — server-fn RPC (see §9).
- `proactive-alerts.ts` — client-side alert derivation (mirrors `scan-runner.server.ts` logic for immediate UI hints).
- `scan-augmentations.ts` — enrichment applied to raw snapshots before render.
- `simple-mode.tsx` — SimpleModeProvider (React context) driving the "Simple Mode" onboarding overlay (`SimpleModeIntro`, `SimpleInspector`, `SimpleExplain`).
- `simulation.ts` — sim engine used by `runSimulation`.
- `speed-mode.ts` — speed-mode toggle state.
- `telegram-prefs.ts` — client-side prefs UI helpers.
- `track-record.ts` — track-record aggregation for `TrackRecordPanel.tsx`.
- `wait-vs-buy.ts` — deterministic "wait vs buy now" recommendation.
- `utils.ts` — `cn()` and misc helpers.
- `validation/{config,metrics,scenarios,storage}.ts` — backing for `/simulation/validation`.

---

## 12. Component Inventory (`src/components/*`)

- `AiBubble.tsx` — floating AI copilot bubble (client-only via `ClientOnlyChrome`).
- `AnalogDisclaimer.tsx` — disclaimer strip under analog output.
- `BracketExitDisplay.tsx` — bracket/exit visualization for a filled ladder.
- `ClientOnlyChrome.tsx` — SSR guards for TopMenu/AiBubble/SimpleMode chrome.
- `CsvExportButton.tsx` — one-click CSV export.
- `HistoricalAnalogPanel.tsx` — main analog UI (drives `findHistoricalAnalog`).
- `IntradayAnalogChart.tsx` — intraday analog visual.
- `ManualFillDialog.tsx` — modal for manually logging rung fills.
- `PositionsPanel.tsx` — user's active ladders with avg cost + rung status.
- `SimpleExplain.tsx`, `SimpleInspector.tsx`, `SimpleModeIntro.tsx` — Simple-Mode onboarding UI.
- `SpeedModeToggle.tsx` — dashboard scan-cadence toggle.
- `TelegramAlertsPanel.tsx` — bot linking + alert preferences UI.
- `TopMenu.tsx` — top navigation, sign-in state, sign-out.
- `TrackRecordPanel.tsx` — historical track-record table.
- `ai-elements/*` — streamdown chat primitives (`code-block`, `conversation`, `message`, `prompt-input`, `shimmer`, `tool`).
- `sim/HistoricalReplayPanel.tsx`, `sim/SensitivityPanel.tsx` — /simulation panels.
- `ui/*` — full shadcn/ui component set (do not remove; used throughout).

---

## 13. AI Copilot

**Provider:** Lovable AI Gateway (`ai-gateway.server.ts`). Server-side
model: `google/gemini-2.5-flash`.

**System prompt (`AGENT_SYSTEM`)** lives in `ai-agent.server.ts`. It
enforces plain-English answers, never mentioning tool names, and
insisting on tool use for user-scoped data.

**Shared tool set (`buildServerTools(userId, admin)`)** — same tools
across `/api/chat` and the Telegram webhook:

1. `get_my_positions` — Supabase read of user's `positions`, computes avg cost + deployed capital per row.
2. `get_position` — one position by symbol.
3. `get_position_settings` — Auto-Fill Detection + Recovery Capture flags.
4. `get_notification_preferences` — email/phone/threshold prefs.
5. `list_recent_alerts` — last N `alert_deliveries` for user.
6. `get_live_quotes` — batch TwelveData quote via rotating key pool.
7. `run_market_scan` — full universe scan via `scanUniverse`.
8. `get_scanner_recommendations` — filtered scan (non-WATCH only).
9. `run_analog_search` — analog scanner for a symbol.
10. `list_saved_reports`, `get_saved_report` — `scan_reports` reads.
11. `get_earnings` — next earnings via FMP/Finnhub.
12. `simulate_ladder` — synthetic sim scenario runner.
13. `get_app_knowledge` — searches `app-knowledge.ts`.

Bearer token is required at the transport layer (via
`requireSupabaseAuth` on the wrapping serverFn / route middleware);
`userId` is passed into `buildServerTools`.

`app-bridge.ts` retains an older client-side tool surface used by the
in-page AI bubble for lightweight interactions; treat the server tools
as authoritative when the two diverge.

---

## 14. Telegram Integration

### 14.1 Linking flow (`telegram-link.functions.ts`)

1. Authenticated user clicks Link in `TelegramAlertsPanel.tsx` → `mintTelegramLinkCode` inserts `{code, user_id, expires_at}` into `telegram_link_codes`.
2. User sends `/start <code>` (or `/link <code>`) to the bot.
3. Webhook validates the code, deletes it, upserts `telegram_links (user_id, chat_id, telegram_username)`.
4. `/unlink` deletes the row.

### 14.2 Webhook (`src/routes/api/public/telegram/webhook.ts`)

- Path bypasses auth via `/api/public/`.
- Security: HTTP header `X-Telegram-Bot-Api-Secret-Token` must equal
  `deriveSecret(TELEGRAM_API_KEY)` = `sha256("telegram-webhook:" +
  TELEGRAM_API_KEY).digest('base64url')`. Compared with `timingSafeEqual`.
- Registered with Telegram via `setWebhook` through the connector gateway;
  same secret must be passed as `secret_token`.
- On text message: resolves `chat_id → user_id` via `telegram_links`, loads
  or creates a `chat_conversations` row (`source='telegram'`), appends the
  user message to `chat_messages`, calls `runTelegramAgent()` which
  streams Gemini 2.5 Flash with `buildServerTools`+`AGENT_SYSTEM`,
  appends the assistant reply to `chat_messages`, and replies via
  gateway `sendMessage`.
- Commands: `/start`, `/start <code>`, `/link <code>`, `/unlink`, `/help`.

### 14.3 Outbound alerts (`scan-runner.server.ts`)

- Runs from cron (see §6.4). Fetches latest scan, compares each symbol's
  live price to configured buy-zone entry.
- If distance ≤ `at_threshold_pct` → `at_buy_zone` alert.
  If distance ≤ `approach_threshold_pct` → `approaching_buy` alert
  (only if the corresponding toggle is on and quiet-hours not active).
- Idempotency: `alert_key = symbol:alert_kind:target_bucket`. UNIQUE per
  user prevents duplicate sends across ticks.
- Delivery: POST to
  `https://connector-gateway.lovable.dev/telegram/sendMessage` with
  headers `Authorization: Bearer $LOVABLE_API_KEY` and
  `X-Connection-Api-Key: $TELEGRAM_API_KEY`.
- Email/SMS status columns are placeholders — no email/SMS provider is
  currently wired in.

---

## 15. Authentication

`src/routes/auth.tsx` supports three flows:

1. **Email + password** — `supabase.auth.signInWithPassword` / `signUp`.
2. **Google OAuth** — `lovable.auth.signInWithOAuth("google", {
   redirect_uri: window.location.origin })`; the broker returns tokens,
   then wrapper calls `supabase.auth.setSession(result.tokens)`. Google
   provider must be enabled in Supabase Auth (call
   `supabase--configure_social_auth` if setting up fresh).
3. **Anonymous guest** — `supabase.auth.signInAnonymously()`. Anonymous
   sessions are locked out of `telegram_links` writes via
   `(auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE` in RLS.

Session lives in `localStorage` (browser client), so the `_authenticated`
layout MUST stay `ssr: false`. Bearer token attaches via
`attachSupabaseAuth` to every serverFn.

Sign-out hygiene (in `TopMenu.tsx`): cancel queries → clear cache →
`supabase.auth.signOut()` → `navigate({ to: "/auth", replace: true })`.

Root `onAuthStateChange` subscriber filters to
`SIGNED_IN|SIGNED_OUT|USER_UPDATED` only, invalidates router, and calls
`queryClient.invalidateQueries()` for non-signout events.

---

## 16. Simulation & Validation

- `/simulation` (`_authenticated/simulation.tsx`) — sandbox that runs the
  scanner over synthetic scenarios (see the `simulate_ladder` tool list
  for the 17 scenario keys) and historical replays. Backed by
  `simulation.functions.ts` + `simulation.ts` + `sim/*` components.
- `/simulation/validation`
  (`_authenticated/simulation.validation.tsx`) — aggregated validation
  metrics dashboard. Backing files in `src/lib/validation/`
  (`config.ts`, `metrics.ts`, `scenarios.ts`, `storage.ts`).

Reports can be persisted to `scan_reports` and later retrieved via the
`list_saved_reports` / `get_saved_report` AI tools.

---

## 17. Cron & Scan Loop

`runScanTick(opts)` in `scan-runner.server.ts`:

1. If not `opts.force`, skip when not `isUsMarketHours()` and not `isPreMarketWarmup()`.
2. Call `scanUniverse` internally.
3. Upsert result into `market_scan_snapshots` (id = current UTC minute bucket).
4. For each user with matching `notification_preferences`, evaluate approach + at-zone thresholds; skip duplicates via `alert_deliveries.alert_key` UNIQUE constraint; skip during quiet hours.
5. Send Telegram messages via connector gateway; write result rows.

Endpoint: `POST /api/public/hooks/scan-tick` — validates `apikey`
header against `SUPABASE_PUBLISHABLE_KEY`; returns JSON result.
`GET` returns `{ ok: true, hint: "POST with apikey header to run" }` and
has no side effects.

---

## 18. Build & Runtime

### 18.1 Vite

`vite.config.ts` wraps `@lovable.dev/vite-tanstack-config` and adds:

- A tiny plugin that strips `data-tsd-source` dev attrs from build output.
- Redirects the SSR entry to `src/server.ts`.

### 18.2 Cloudflare Workers surface (`src/server.ts`)

Custom `fetch` handler wrapping the Nitro/TanStack server entry. Detects
and rewrites h3-swallowed 500 bodies (`isH3SwallowedErrorBody`) into a
readable JSON error to keep client toasts meaningful.

### 18.3 Start config (`src/start.ts`)

```
createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}))
```

The `attachSupabaseAuth` middleware calls
`supabase.auth.getSession()` client-side and attaches
`Authorization: Bearer <token>` to every server function invocation.

### 18.4 TSGO / TypeScript

`tsconfig.json` — strict mode. `src/routeTree.gen.ts` is generated by the
TanStack Router Vite plugin; never edit by hand.

---

## 19. Security Posture

- All user-owned tables: RLS enabled + explicit SELECT/INSERT/UPDATE/DELETE policies keyed on `auth.uid()`.
- `telegram_links`: anonymous JWTs blocked on all four commands.
- `market_scan_snapshots`: `authenticated`-only SELECT (no `anon`).
- Service role key is server-only (`client.server.ts` lazy Proxy). Never imported at module scope in shared/client-reachable files.
- Telegram webhook secured by deterministic derived secret + `timingSafeEqual`.
- pg_cron endpoint secured by publishable-key `apikey` header check.
- Public `/api/public/*` routes must never return user PII beyond what the caller already proves (Telegram chat_id ↔ user_id mapping).
- Google OAuth `redirect_uri` MUST be a full same-origin public URL (currently `window.location.origin`) — do not point at protected routes.

Security memory is co-maintained via `update_memory` when findings are
ignored or resolved.

---

## 20. Known Gaps / Open Questions

Document these clearly so a rebuilder does not assume features exist:

1. **Email + SMS alerts:** `notification_preferences.email_enabled`, `phone_enabled` and `alert_deliveries.email_status`, `phone_status` are wired in schema but no email/SMS provider (SendGrid/Twilio/etc.) is currently integrated. Only Telegram delivery works.
2. **Web chat persistence:** `chat_conversations`/`chat_messages` are definitively used by Telegram (`source='telegram'`). Whether `/api/chat` also persists (`source='web'`) or still uses `chat-storage.ts` localStorage varies with the endpoint's current implementation; treat both as valid until reconciled.
3. **Guest positions:** anonymous users get ephemeral Supabase rows; `positions.ts` client shape still exists as a compat layer. Prefer Supabase for authenticated users.
4. **Baked publishable key in pg_cron migration:** migration `20260714190528` embeds the project's publishable key in SQL. That is fine because it is public, but if rotating, re-migrate.

---

## 21. Change Log (recent)

- **10,000-identity Yahoo rotation** — expanded from 170 (which effectively produced 50 unique tuples via modulo aliasing) to 10,000 fully enumerated fingerprints (2 hosts × 100 UAs × 50 langs), mirrored in `yahoo.server.ts` and `market.server.ts` via the shared `yahoo-identities.server.ts` module. HOST is the innermost loop so adjacent attempts alternate query1/query2.
- **Anonymous access hardening** — telegram_links gained INSERT/UPDATE policies with `is_anonymous` guard; market_scan_snapshots locked to authenticated SELECT (migration `20260714195443`).
- **Telegram bot + linking** — full webhook + agent parity with web chat via shared `ai-agent.server.ts`.
- **`_authenticated` layout with `ssr:false`** — required because Supabase session lives in localStorage.
- **Google OAuth via Lovable broker** — `@lovable.dev/cloud-auth-js` + `supabase.auth.setSession` (replaces earlier direct OAuth).

---

## 22. Rebuild Checklist

1. Create empty TanStack Start v1.168+ project from Lovable template `tanstack_start_ts_current`.
2. Install every dependency listed in `package.json` verbatim.
3. Recreate `src/routes/` tree per §4 with matching auth layout.
4. Recreate `src/integrations/supabase/*` (autogen shapes — regenerate via Lovable Cloud connect).
5. Add Lovable AI Gateway + Telegram connector; store `LOVABLE_API_KEY`, `TELEGRAM_API_KEY`.
6. Add TwelveData / Finnhub / FMP secrets per §5.
7. Run all migrations in `supabase/migrations/` in order.
8. Configure Google auth provider via `supabase--configure_social_auth`.
9. Register Telegram webhook using `sha256("telegram-webhook:"+TELEGRAM_API_KEY).digest('base64url')` as `secret_token`.
10. Verify: sign in with Google, run a scan, inspect analog, link Telegram, send a test alert, force a `scan-tick`, observe an `alert_deliveries` row.

If any of the above fails or diverges, re-read the relevant section
above and update this document before shipping.

---

## 23. Remix Portability — What DOES NOT Come With You

A remix clones the codebase (all files tracked in the project: source, migrations,
`REBUILD.md`, `.lovable/*`, `AGENTS.md`, docs). It does **not** clone anything that
lives outside the code tree. On a fresh remix the agent cannot see or
auto-reconstruct any of the items below — you have to redo them by hand.

### 23.1 Secrets (highest priority — nothing pulls data without these)

Runtime secrets are stored per-project in Lovable Cloud, not in the repo. The
remix starts with an **empty** secret store. Re-add every one:

- `TWELVEDATA_API_KEY` (primary quote / bars source)
- `TWELVEDATA_API_KEY_2` … `TWELVEDATA_API_KEY_5` (rotation pool — code also
  reads `_6`..`_12` if present, so add more later without code changes)
- `TWELVEDATA_ANALOG_API_KEY_1`, `TWELVEDATA_ANALOG_API_KEY_2` (optional
  dedicated pool for the Historical Analog Scanner; if absent, analog falls
  back to the main pool)
- `FINNHUB_API_KEY` (secondary quote fallback + fundamentals cache)
- `TELEGRAM_API_KEY` (bot token — required for `/api/public/telegram/webhook`
  and alert delivery)
- `LOVABLE_API_KEY` (auto-managed by Lovable AI Gateway on remix — do NOT set
  by hand; if missing, enable the AI Gateway connector)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL` — auto-populated when Lovable Cloud is enabled on the
  remix; do NOT set by hand.

Symptom of missing keys: quote endpoints return `{ error: "no_keys" }`, scans
return empty rows, `TelegramAlertsPanel` shows a "Bot not configured" banner.

### 23.2 Supabase / Lovable Cloud state

The **schema** (tables, RLS, functions, triggers) is in `supabase/migrations/`
and replays automatically. Everything else is per-project and does not:

- **Row data** — every table is empty on remix (`positions`, `chat_*`,
  `future_leaders_*`, `momentum_rockets_*`, `market_scan_snapshots`,
  `alert_deliveries`, `telegram_link_codes`, `telegram_links`, all `*_cache`
  tables, `analog_benchmarks`, `analog_validation_runs`, etc.). First scan
  runs cold — no cached bars, no rankings, no snapshots.
- **Auth users** — `auth.users` is empty. Every user re-signs in from scratch
  and gets a new UUID; positions/alerts under the old UUIDs are unreachable.
- **Google OAuth provider config** — the remix has no client ID/secret bound.
  Re-run `supabase--configure_social_auth` with a Google Cloud OAuth client
  whose redirect URI matches the remix's new Supabase project ref.
- **Storage buckets** — none used here, but if any are added later they don't
  transfer.
- **pg_cron / scheduled jobs / DB webhooks** — if you wire cron against
  `scan-tick` in the future, redo the schedule on the remix.
- **Supabase project ref, URL, publishable key, service-role key, DB URL** —
  all new on the remix. Any hard-coded reference to the old project ref is
  dead. Only read them via `process.env` / `import.meta.env.VITE_*`, never
  paste literal values.

### 23.3 Connectors and integrations

- **Lovable AI Gateway** — must be re-enabled on the remix so `LOVABLE_API_KEY`
  gets minted. Model access (`google/gemini-2.5-flash`, etc.) then works.
- **Telegram bot** — the bot token (`TELEGRAM_API_KEY`) is a secret (§23.1),
  but the **webhook registration** with Telegram's servers is tied to the
  old published URL. After the remix is published, re-register:
  `POST https://api.telegram.org/bot<TOKEN>/setWebhook` with the new
  `project--<new-id>.lovable.app/api/public/telegram/webhook` and the
  `secret_token = sha256("telegram-webhook:"+TELEGRAM_API_KEY).digest('base64url')`.
- **Any standard connector** (`standard_connectors--list_connections`) — the
  remix inherits none. Reconnect on the new project.

### 23.4 Deployment & URLs

- **Published URL** — the remix gets a new `project--<new-id>.lovable.app`
  host. External callers (Telegram webhook, cron, anything the user gave to
  a third party) must be updated to the new URL.
- **Custom domain** — does not transfer; re-attach in Publish settings.
- **Publish status** — the remix starts unpublished until you publish it.

### 23.5 Workspace-level state (shared, not per-project)

These live at the workspace, so they DO carry across if the remix stays in
the same workspace — but a remix into a different workspace loses them:

- Build secrets (Workspace Settings → Build Secrets) — e.g. private
  registry tokens for `.npmrc`. Not applicable to this project today.
- Folder membership, workspace members, roles.

### 23.6 Runtime / process state (never transfers, and doesn't need to)

- In-memory TwelveData key exhaustion map and Yahoo round-robin cursor —
  reset every cold start anyway.
- Vite dev-server logs, session replays, browser console history.

### 23.7 Post-remix bring-up checklist

Do these in order on a fresh remix before expecting live data:

1. Enable Lovable Cloud → confirm the four `SUPABASE_*` secrets appear.
2. Enable Lovable AI Gateway → confirm `LOVABLE_API_KEY` appears.
3. `set_secret` for all TwelveData keys + `FINNHUB_API_KEY` + `TELEGRAM_API_KEY`.
4. Confirm all migrations ran (§22 step 7).
5. `supabase--configure_social_auth` for Google, using a new OAuth client whose
   redirect URI targets the new Supabase project ref.
6. Publish the remix, grab the new `project--<id>.lovable.app` URL.
7. Re-register the Telegram webhook against the new URL with the new secret
   token.
8. Sign in with Google as a fresh user, run a scan, verify quotes populate,
   link Telegram, force a `scan-tick`, verify an `alert_deliveries` row.

If step 8 shows empty rows or "no_keys" errors, jump back to §23.1 — the
symptom is always a missing secret, never missing code.

---

## 24. Cron Job Setup (pg_cron)

The always-on scan loop and Future Leaders refresh run via Supabase `pg_cron` +
`pg_net`, calling this project's stable published URL. A remix does NOT bring
these jobs with it (see §23.5) — recreate them once per remix.

### 24.1 Prerequisites

- Project is **published** at least once (cron jobs hit the production
  deployment, not preview).
- `SUPABASE_PUBLISHABLE_KEY` is set in the runtime env (auto-injected on
  Lovable Cloud remixes).
- Both hook routes exist:
  - `src/routes/api/public/hooks/scan-tick.ts`
  - `src/routes/api/public/hooks/future-leaders-tick.ts`

Both handlers verify the `apikey` header equals `SUPABASE_PUBLISHABLE_KEY`.
`/api/public/*` bypasses edge auth, so this in-handler check is what keeps
them locked down.

### 24.2 One-shot SQL

Run this once per remix. Substitute:

- `<PROJECT_ID>` — the Lovable project UUID (in the project URL).
- `<ANON_KEY>` — the workspace publishable/anon key
  (`sb_publishable_...` in the app `.env` as `VITE_SUPABASE_PUBLISHABLE_KEY`).

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Safe re-run: drop existing jobs of the same names first.
DO $$ BEGIN PERFORM cron.unschedule('laddrx-scan-tick');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('laddrx-future-leaders-tick');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'laddrx-scan-tick',
  '* * * * *',                              -- every minute
  $$
  SELECT net.http_post(
    url:='https://project--<PROJECT_ID>.lovable.app/api/public/hooks/scan-tick',
    headers:='{"Content-Type":"application/json","apikey":"<ANON_KEY>"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'laddrx-future-leaders-tick',
  '*/15 * * * *',                           -- every 15 minutes
  $$
  SELECT net.http_post(
    url:='https://project--<PROJECT_ID>.lovable.app/api/public/hooks/future-leaders-tick',
    headers:='{"Content-Type":"application/json","apikey":"<ANON_KEY>"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);
```

### 24.3 Verify

```sql
-- Jobs are registered and active
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'laddrx-%';

-- Recent runs (should show 200 status once published)
SELECT jobid, start_time, end_time, status, return_message
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'laddrx-%')
ORDER BY start_time DESC
LIMIT 20;
```

### 24.4 Behavior notes

- `scan-tick` cheaply no-ops off US market hours (gate lives in
  `scan-runner.server.ts`), so 1-min cadence 24/7 is fine — no wasted API calls.
- `future-leaders-tick` resumes any in-progress snapshot before starting a new
  one; safe to run on cadence even mid-scan.
- Stable URL (`project--<id>.lovable.app`) is immune to project renames.

### 24.5 Teardown

```sql
SELECT cron.unschedule('laddrx-scan-tick');
SELECT cron.unschedule('laddrx-future-leaders-tick');
```

---

## 25. Systemic Market Risk Intelligence Engine (v1 + v2)

Added in the 2026-07 rebuild. This is an independent subsystem from the
Auto-Router — it analyzes macro/market health and detects historical analog
regimes. Nothing here depends on the ladder scanner.

### 25.1 Secrets required (NOT in remix)

- `FRED_API_KEY` — free key from https://fred.stlouisfed.org/docs/api/api_key.html.
  Used by `src/lib/market-data/fred-ingest.server.ts`. Without it, macro
  ingestion fails and v2 features degrade to price-only.
- `TELEGRAM_BOT_TOKEN`, `LOVABLE_API_KEY`, `TWELVEDATA_API_KEY*`, `FINNHUB_API_KEY`
  — already documented in §22; re-add after remix.

### 25.2 Database tables (all in migrations, but data must be reseeded)

Migrations in `supabase/migrations/`:
- `20260716233945_*` — `market_series`, `market_events`, `data_ingest_runs`
  (+ RLS, GRANTs, ~60 seeded historical events 1929–2024).
- `20260716234652_*` — `market_features`, `systemic_risk_v2_snapshots`,
  `systemic_risk_v2_backtests` (+ RLS, GRANTs).
- Pre-existing: `systemic_risk_snapshots`, `systemic_risk_backtest_runs` (v1).

**Seeded event catalog** in the events migration is idempotent (ON CONFLICT
DO NOTHING). It re-seeds automatically on remix.

**Time-series data does NOT survive remix.** After remix, run a full FRED
backfill (see §25.4) to repopulate `market_series` (~17 series × decades).

### 25.3 Code surface

- `src/lib/market-data/fred-series.ts` — client-safe list of 17 starter series.
- `src/lib/market-data/fred-ingest.{server,functions}.ts` — ingestion.
- `src/lib/market-data/features.server.ts` — 16 normalized features, 6 blocks.
- `src/lib/market-data/scoring.server.ts` — 6-model ensemble.
- `src/lib/market-data/engine-v2.functions.ts` — orchestration + caching.
- `src/lib/market-data/backtest.server.ts` — precision/recall/F1/lead-time.
- `src/lib/market-data/stats.ts` — z-score / percentile / cosine helpers.
- `src/lib/systemic-risk/{engine,features,data}.server.ts` + `crises.ts` — v1 engine (still live).
- `src/routes/_authenticated/systemic-risk.tsx` — v1 headline page.
- `src/routes/_authenticated/systemic-risk.v2.tsx` — v2 ensemble page.
- `src/routes/_authenticated/systemic-risk.events.tsx` — admin: event
  catalog + manual FRED backfill + ingest run log.
- `src/routes/_authenticated/systemic-risk.methodology.tsx` — docs page.
- `src/routes/_authenticated/systemic-risk.validation.tsx` — v2 backtest UI.
- `src/routes/api/public/hooks/ingest-fred.ts` — cron: daily FRED refresh.
- `src/routes/api/public/hooks/compute-risk.ts` — cron: nightly v2 recompute.
- `src/routes/api/public/hooks/systemic-risk-tick.ts` — cron: v1 refresh.

### 25.4 Post-remix initialization checklist

1. Add `FRED_API_KEY` secret.
2. Navigate to `/systemic-risk/events` → click **Full backfill** (ingests
   ~17 FRED series, several minutes; watch the ingest run log).
3. Navigate to `/systemic-risk/v2` → click **Recompute** to build the
   first v2 snapshot from newly ingested features.
4. Navigate to `/systemic-risk/validation` → click **Run backtest** to
   populate `systemic_risk_v2_backtests`.
5. (Optional) Schedule the three cron hooks in pg_cron using the same
   apikey pattern as §24 — endpoints:
   - `/api/public/hooks/ingest-fred` (daily ~22:00 UTC)
   - `/api/public/hooks/compute-risk` (daily ~22:30 UTC)
   - `/api/public/hooks/systemic-risk-tick` (daily ~22:35 UTC, v1 legacy)

### 25.5 What does NOT carry over in a remix

- Row data in every table (Supabase remix creates a fresh project).
  In particular: `market_series`, `market_features`,
  `systemic_risk_snapshots`, `systemic_risk_v2_snapshots`,
  `systemic_risk_v2_backtests`, `systemic_risk_backtest_runs`,
  `data_ingest_runs`, `positions`, `alert_history`,
  `telegram_configs`, `future_leaders_*`, `momentum_rockets_*`.
- All secrets (§25.1 and §22).
- pg_cron schedules (recreate per §24 + §25.4 step 5).
- Auth users. The `_authenticated` layout requires sign-in — create a
  fresh user via `/auth` after remix.

The `market_events` seed and every migration DO carry over — they live in
`supabase/migrations/` in the source tree.

