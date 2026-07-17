// Server-only automation runner. Executes a universe scan, persists a
// snapshot for the dashboard to read on next open, and — for every user with
// Telegram linked and notifications enabled — diffs the snapshot against
// their tracked positions and delivers proximity / at-zone alerts.
//
// Called by /api/public/hooks/scan-tick (pg_cron) and safe to invoke
// manually. All state lives in Supabase; no in-memory context.

import { scanUniverse, type ScanResult, type ScanRow } from "@/lib/market.functions";
import { broadcast, notifySystemEvent, sendRaw, escapeHtml, loadLinkedRecipients } from "@/lib/telegram-notify.server";

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

// US equity RTH: 9:30–16:00 ET, Mon–Fri. Holidays best-effort skipped by
// the scan returning empty rows; we still write the (empty) snapshot so the
// UI shows a fresh timestamp.
export function isUsMarketHours(now: Date = new Date()): boolean {
  // Convert to ET via Intl. Reliable across DST because it uses the tz db.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const wd = parts.weekday as string; // "Sat" "Sun" etc.
  if (wd === "Sat" || wd === "Sun") return false;
  const h = Number(parts.hour);
  const m = Number(parts.minute);
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

// Extended prep window (9:00 ET) so the first RTH tick has warm caches.
export function isPreMarketWarmup(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const wd = parts.weekday as string;
  if (wd === "Sat" || wd === "Sun") return false;
  const h = Number(parts.hour);
  const m = Number(parts.minute);
  const mins = h * 60 + m;
  return mins >= 9 * 60 && mins < 9 * 60 + 30;
}

function etSessionDate(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // YYYY-MM-DD
}

async function sendTelegram(chatId: number | string, text: string): Promise<boolean> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) return false;
  try {
    const res = await fetch(`${GATEWAY}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type UserAlertContext = {
  userId: string;
  chatId: number;
  approaching: boolean;
  atZone: boolean;
  approachPct: number;
  atPct: number;
  symbols: Set<string>; // positions user cares about
};

async function persistSnapshot(scan: ScanResult): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Single-row table keyed on id='latest'. Cast to any because the
  // generated Database types are re-emitted post-migration.
  await (supabaseAdmin as unknown as {
    from: (t: string) => {
      upsert: (v: Record<string, unknown>) => { throwOnError: () => Promise<unknown> };
    };
  })
    .from("market_scan_snapshots")
    .upsert({
      id: "latest",
      scanned_at: scan.scannedAt,
      rows_count: scan.rows.length,
      failed_count: scan.failed.length,
      spy_change_pct: scan.spyChangePct,
      warning: scan.warning ?? null,
      payload: scan as unknown as object,
    })
    .throwOnError();
}

// Shared telegram_config singleton controls category flags. Chat recipients
// come from public.telegram_chats (every active chat receives every alert).
// No per-user linking — the bot blasts every registered chat.
async function loadSharedConfig() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: cfg }, { data: chats }, { data: owner }] = await Promise.all([
    supabaseAdmin
      .from("telegram_config")
      .select("new_picks_enabled,price_level_enabled,digests_enabled,min_pick_score,digest_min_gap_minutes")
      .eq("id", 1)
      .maybeSingle(),
    supabaseAdmin.from("telegram_chats").select("chat_id").eq("is_active", true),
    supabaseAdmin.from("profiles").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  const chatIds = (chats ?? []).map((c) => Number(c.chat_id)).filter((n) => Number.isFinite(n));
  if (chatIds.length === 0) return null;
  const ownerUserId = (owner?.id as string | undefined) ?? "00000000-0000-0000-0000-000000000000";
  return {
    chatIds,
    chatId: chatIds[0], // legacy fallback for callers that expect a single id
    ownerUserId,
    newPicksEnabled: cfg?.new_picks_enabled ?? true,
    priceLevelEnabled: cfg?.price_level_enabled ?? true,
    digestsEnabled: cfg?.digests_enabled ?? false,
    minScore: Number(cfg?.min_pick_score ?? 60),
    digestGapMin: Number(cfg?.digest_min_gap_minutes ?? 15),
  };
}

async function broadcastAll(chatIds: number[], msg: string): Promise<number> {
  let sent = 0;
  for (const id of chatIds) if (await sendRaw(id, msg)) sent++;
  return sent;
}

async function loadAlertContexts(): Promise<UserAlertContext[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cfg = await loadSharedConfig();
  if (!cfg) return [];
  const { data: positions } = await supabaseAdmin.from("positions").select("symbol");
  const symbols = new Set<string>();
  for (const p of positions ?? []) symbols.add(p.symbol);
  if (symbols.size === 0) return [];
  return [{
    userId: cfg.ownerUserId,
    chatId: cfg.chatId,
    approaching: true,
    atZone: true,
    approachPct: 1.5,
    atPct: 0.4,
    symbols,
  }];
}

type PendingAlert = {
  userId: string;
  chatId: number;
  symbol: string;
  kind: "APPROACHING_BUY" | "AT_BUY_ZONE";
  alertKey: string;
  targetPrice: number;
  livePrice: number;
  distancePct: number;
  message: string;
};

function computePendingAlerts(
  ctx: UserAlertContext,
  rows: ScanRow[],
  sessionDate: string,
): PendingAlert[] {
  const alerts: PendingAlert[] = [];
  for (const r of rows) {
    if (!ctx.symbols.has(r.symbol)) continue;
    if (!r.adaptiveLadder || r.adaptiveLadder.length === 0) continue;
    if (r.regime === "NO_DIP") continue;
    if ((r.change1d ?? 0) >= 0) continue;
    const armed =
      r.status === "BUY_STARTER" || r.status === "BUY_LADDER" || r.status === "PROBE";
    if (!armed) continue;
    const price = r.price;
    if (!price || !isFinite(price)) continue;
    for (const rung of r.adaptiveLadder) {
      if (!rung.price || price < rung.price) continue;
      // Probe rungs sit at spot price ("now"/"assumed filled"), so their
      // distPct is always ~0. Skipping them here prevents false
      // "AT buy zone" alerts fired the moment a symbol enters PROBE status
      // without the price actually being at a discount to a real target.
      if (typeof rung.label === "string" && rung.label.startsWith("Probe")) continue;
      const distPct = ((price - rung.price) / rung.price) * 100;
      if (distPct > ctx.approachPct) continue;
      const bucket = distPct <= ctx.atPct ? "AT" : "NEAR";
      if (bucket === "AT" && !ctx.atZone) continue;
      if (bucket === "NEAR" && !ctx.approaching) continue;
      const kind = bucket === "AT" ? "AT_BUY_ZONE" : "APPROACHING_BUY";
      const alertKey = `${sessionDate}|${r.symbol}|${rung.price.toFixed(2)}|${bucket}`;
      const label = rung.label || `${rung.pct}%`;
      const msg =
        bucket === "AT"
          ? `🎯 <b>${r.symbol}</b> at buy zone ${label}\nTarget $${rung.price.toFixed(2)} — live $${price.toFixed(2)}${rung.reason ? `\n${rung.reason}` : ""}`
          : `👀 <b>${r.symbol}</b> approaching buy ${label}\nTarget $${rung.price.toFixed(2)} — live $${price.toFixed(2)} (${distPct.toFixed(2)}% away)${rung.reason ? `\n${rung.reason}` : ""}`;
      alerts.push({
        userId: ctx.userId,
        chatId: ctx.chatId,
        symbol: r.symbol,
        kind,
        alertKey,
        targetPrice: rung.price,
        livePrice: price,
        distancePct: distPct,
        message: msg,
      });
    }
  }
  return alerts;
}

async function deliverAlerts(pending: PendingAlert[]): Promise<{ sent: number; skipped: number }> {
  if (pending.length === 0) return { sent: 0, skipped: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cfg = await loadSharedConfig();
  const chatIds = cfg?.chatIds ?? [];
  let sent = 0;
  let skipped = 0;
  for (const a of pending) {
    const { error } = await supabaseAdmin.from("alert_deliveries").insert({
      user_id: a.userId,
      symbol: a.symbol,
      alert_key: a.alertKey,
      alert_kind: a.kind,
      target_price: a.targetPrice,
      live_price: a.livePrice,
      distance_pct: a.distancePct,
      message: a.message,
      email_status: "not_configured",
      phone_status: "not_configured",
    });
    if (error) { skipped++; continue; }
    const s = await broadcastAll(chatIds, a.message);
    if (s > 0) sent++;
    // sendTelegram retained for backwards compat / logs; unused path
    void sendTelegram;
  }
  return { sent, skipped };
}

// ─── New pick broadcasts ────────────────────────────────────────────────
// After each scan, send one Telegram message per newly-qualified dip
// candidate to every user with new_picks_enabled. Dedup per (symbol,
// sessionDate) via alert_deliveries so a symbol only alerts once/session.

type PickRow = {
  symbol: string;
  price: number;
  change1d: number | null;
  score: number;
  reasons?: string[];
  intraday?: { dropFromOpenPct?: number | null } | null;
  adaptiveLadder?: Array<{ price: number; label?: string }>;
};

function formatPickMessage(r: PickRow): string {
  const sym = escapeHtml(r.symbol);
  const chg = (r.change1d ?? 0).toFixed(2);
  const drop = r.intraday?.dropFromOpenPct;
  const reasons = (r.reasons ?? []).slice(0, 3).map(escapeHtml).join(" · ");
  const rung0 = r.adaptiveLadder?.[0];
  const rung1 = r.adaptiveLadder?.[1];
  const rungLast = r.adaptiveLadder?.[r.adaptiveLadder.length - 1];
  const levels =
    rung0
      ? `Entry $${rung0.price.toFixed(2)}${rung1 ? ` · Add $${rung1.price.toFixed(2)}` : ""}${rungLast && rungLast !== rung0 ? ` · Deep $${rungLast.price.toFixed(2)}` : ""}`
      : "";
  return (
    `🚀 <b>NEW DIP PICK · ${sym}</b>  $${r.price.toFixed(2)} (${chg}% day)\n` +
    `Score ${Math.round(r.score)}${drop != null ? ` · From open ${drop.toFixed(2)}%` : ""}\n` +
    (reasons ? `${reasons}\n` : "") +
    (levels ? `${levels}\n` : "") +
    `📊 https://www.tradingview.com/chart/?symbol=${sym}`
  );
}

async function broadcastNewPicks(
  rows: ScanRow[],
  sessionDate: string,
): Promise<{ sent: number; deduped: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cfg = await loadSharedConfig();
  if (!cfg || !cfg.newPicksEnabled) return { sent: 0, deduped: 0 };

  const picks: PickRow[] = rows
    .filter((r) => r.score >= 1 && r.adaptiveLadder && r.adaptiveLadder.length > 0)
    .map((r) => ({
      symbol: r.symbol,
      price: r.price,
      change1d: r.change1d,
      score: r.score,
      reasons: r.reasons,
      intraday: r.intraday,
      adaptiveLadder: r.adaptiveLadder,
    }));
  if (picks.length === 0) return { sent: 0, deduped: 0 };

  let sent = 0;
  let deduped = 0;
  for (const pick of picks) {
    if (pick.score < cfg.minScore) continue;
    const alertKey = `NEW_PICK|${sessionDate}|${pick.symbol}`;
    const { error } = await supabaseAdmin.from("alert_deliveries").insert({
      user_id: cfg.ownerUserId,
      symbol: pick.symbol,
      alert_key: alertKey,
      alert_kind: "NEW_PICK",
      target_price: pick.adaptiveLadder?.[0]?.price ?? pick.price,
      live_price: pick.price,
      distance_pct: 0,
      message: `NEW_PICK ${pick.symbol}`,
      email_status: "not_configured",
      phone_status: "not_configured",
    });
    if (error) { deduped++; continue; }
    if ((await broadcastAll(cfg.chatIds, formatPickMessage(pick))) > 0) sent++;
  }
  return { sent, deduped };
}

// ─── Server-side price/level alerts ─────────────────────────────────────
// Cross-day thresholds for tracked/positioned symbols. Fires once per
// (user, symbol, threshold, sessionDate) via alert_deliveries dedup.
const LEVEL_THRESHOLDS = [-2, -3, -5] as const;

async function broadcastPriceLevels(
  rows: ScanRow[],
  sessionDate: string,
): Promise<{ sent: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cfg = await loadSharedConfig();
  if (!cfg || !cfg.priceLevelEnabled) return { sent: 0 };
  const { data: positions } = await supabaseAdmin.from("positions").select("symbol");
  const symbols = new Set<string>();
  for (const p of positions ?? []) symbols.add(p.symbol);
  if (symbols.size === 0) return { sent: 0 };

  const rowBySym = new Map<string, ScanRow>();
  for (const r of rows) rowBySym.set(r.symbol, r);

  let sent = 0;
  for (const sym of symbols) {
    const r = rowBySym.get(sym);
    if (!r) continue;
    const daily = r.change1d ?? 0;
    if (daily >= -0.05) continue;
    const intra = r.intraday?.dropFromOpenPct ?? 0;
    const worst = Math.min(daily, intra);
    for (const t of LEVEL_THRESHOLDS) {
      if (worst > t) continue;
      const alertKey = `LEVEL|${sessionDate}|${sym}|${t}`;
      const { error } = await supabaseAdmin.from("alert_deliveries").insert({
        user_id: cfg.ownerUserId,
        symbol: sym,
        alert_key: alertKey,
        alert_kind: "PRICE_LEVEL",
        target_price: r.price,
        live_price: r.price,
        distance_pct: worst,
        message: `LEVEL ${sym} ${t}%`,
        email_status: "not_configured",
        phone_status: "not_configured",
      });
      if (error) continue;
      const source = daily <= intra ? "on the day" : "from open";
      const value = daily <= intra ? daily : intra;
      const emoji = Math.abs(t) >= 5 ? "🚨" : Math.abs(t) >= 3 ? "⚠️" : "📉";
      const msg =
        `${emoji} <b>${escapeHtml(sym)}</b> crossed ${t}% ${source}\n` +
        `Live $${r.price.toFixed(2)} · Day ${daily.toFixed(2)}% · From open ${intra.toFixed(2)}%\n` +
        `Move: ${value.toFixed(2)}%\n` +
        `📊 https://www.tradingview.com/chart/?symbol=${escapeHtml(sym)}`;
      if ((await broadcastAll(cfg.chatIds, msg)) > 0) sent++;
      break;
    }
  }
  return { sent };
}

// ─── Scan digest ────────────────────────────────────────────────────────
// Digest gap enforced via alert_deliveries with an hour-bucketed key.
async function broadcastDigest(
  scan: ScanResult,
  now: Date,
  alertsSent: number,
): Promise<{ sent: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cfg = await loadSharedConfig();
  if (!cfg || !cfg.digestsEnabled) return { sent: 0 };

  const gapBucket = Math.floor(now.getTime() / (cfg.digestGapMin * 60_000));
  const alertKey = `DIGEST|${gapBucket}`;
  const { error: dupErr } = await supabaseAdmin.from("alert_deliveries").insert({
    user_id: cfg.ownerUserId,
    symbol: "SCAN",
    alert_key: alertKey,
    alert_kind: "DIGEST",
    target_price: 0,
    live_price: 0,
    distance_pct: 0,
    message: "digest",
    email_status: "not_configured",
    phone_status: "not_configured",
  });
  if (dupErr) return { sent: 0 };

  const topMovers = [...scan.rows]
    .filter((r) => (r.change1d ?? 0) < 0)
    .sort((a, b) => (a.change1d ?? 0) - (b.change1d ?? 0))
    .slice(0, 5)
    .map((r) => `${escapeHtml(r.symbol)} ${(r.change1d ?? 0).toFixed(2)}%`)
    .join(", ");
  const timeEt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const spy = scan.spyChangePct != null ? `${scan.spyChangePct.toFixed(2)}%` : "n/a";
  const msg =
    `📊 <b>Scan @ ${timeEt} ET</b> · SPY ${spy}\n` +
    `${scan.rows.length} rows · ${scan.failed.length} failed\n` +
    (topMovers ? `Top movers: ${topMovers}\n` : "") +
    `Alerts fired this tick: ${alertsSent}`;
  return { sent: (await broadcastAll(cfg.chatIds, msg)) };
}

export type ScanTickResult = {
  ranAt: string;
  scannedAt: string | null;
  marketOpen: boolean;
  warmup: boolean;
  rows: number;
  failed: number;
  alertsSent: number;
  alertsSkipped: number;
  contexts: number;
  warning?: string;
  skipReason?: string;
};

export async function runScanTick(opts: { force?: boolean } = {}): Promise<ScanTickResult> {
  const now = new Date();
  const marketOpen = isUsMarketHours(now);
  const warmup = isPreMarketWarmup(now);
  const shouldRun = opts.force || marketOpen || warmup;
  if (!shouldRun) {
    return {
      ranAt: now.toISOString(),
      scannedAt: null,
      marketOpen: false,
      warmup: false,
      rows: 0,
      failed: 0,
      alertsSent: 0,
      alertsSkipped: 0,
      contexts: 0,
      skipReason: "market_closed",
    };
  }

  // Execute the same scan the dashboard uses.
  const scan = await scanUniverse({ data: { force: !!opts.force } });

  await persistSnapshot(scan).catch((e) => {
    console.error("[scan-tick] persistSnapshot failed:", e);
  });

  let alertsSent = 0;
  let alertsSkipped = 0;
  let contexts = 0;
  let newPicksSent = 0;
  let priceLevelSent = 0;
  let digestSent = 0;
  if (marketOpen && scan.rows.length > 0) {
    const sessionDate = etSessionDate(now);
    try {
      const ctxs = await loadAlertContexts();
      contexts = ctxs.length;
      const allPending: PendingAlert[] = [];
      for (const ctx of ctxs) {
        allPending.push(...computePendingAlerts(ctx, scan.rows, sessionDate));
      }
      const res = await deliverAlerts(allPending);
      alertsSent = res.sent;
      alertsSkipped = res.skipped;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[scan-tick] alert pipeline failed:", msg);
      notifySystemEvent("critical", "scan_tick_alert_failure", `Alert pipeline threw: ${msg}`).catch(() => {});
    }
    try {
      const r = await broadcastNewPicks(scan.rows, sessionDate);
      newPicksSent = r.sent;
    } catch (e) {
      console.error("[scan-tick] new-picks broadcast failed:", e);
    }
    try {
      const r = await broadcastPriceLevels(scan.rows, sessionDate);
      priceLevelSent = r.sent;
    } catch (e) {
      console.error("[scan-tick] price-level broadcast failed:", e);
    }
    try {
      const r = await broadcastDigest(scan, now, alertsSent + newPicksSent + priceLevelSent);
      digestSent = r.sent;
    } catch (e) {
      console.error("[scan-tick] digest broadcast failed:", e);
    }
  }
  if (scan.warning) {
    notifySystemEvent("warn", "scan_warning", scan.warning).catch(() => {});
  }
  if (scan.failed.length > 0 && scan.rows.length === 0) {
    notifySystemEvent(
      "critical",
      "scan_all_symbols_failed",
      `All ${scan.failed.length} symbols failed to fetch this tick.`,
    ).catch(() => {});
  }

  return {
    ranAt: now.toISOString(),
    scannedAt: scan.scannedAt,
    marketOpen,
    warmup,
    rows: scan.rows.length,
    failed: scan.failed.length,
    alertsSent,
    alertsSkipped,
    contexts,
    warning: scan.warning,
  };
}
