// Central server-side Telegram sender. Broadcasts to every active chat in
// public.telegram_chats. Category flags + quiet hours live in the singleton
// public.telegram_config (id=1). No per-user linking, no chat lock.

import { recordProvider } from "@/lib/provider-stats.server";

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

export type NotifyKind =
  | "new_picks"
  | "future_leaders"
  | "price_level"
  | "digests"
  | "system_alerts";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function chunk(text: string, size = 4000): string[] {
  return text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [text];
}

export async function sendRaw(chatId: number | string, text: string): Promise<boolean> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) return false;
  const started = Date.now();
  const parts = chunk(text);
  try {
    for (const part of parts) {
      let ok = false;
      let lastErr = "";
      for (let attempt = 0; attempt < 2; attempt++) {
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
              text: part,
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }),
          });
          if (res.ok) { ok = true; break; }
          lastErr = `${res.status} ${await res.text().catch(() => "")}`;
          if (res.status < 500) break;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!ok) {
        recordProvider("telegram", false, Date.now() - started, lastErr.slice(0, 200));
        return false;
      }
    }
    recordProvider("telegram", true, Date.now() - started);
    return true;
  } catch (e) {
    recordProvider("telegram", false, Date.now() - started, e instanceof Error ? e.message : String(e));
    return false;
  }
}

type ConfigRow = {
  new_picks_enabled: boolean;
  future_leaders_enabled: boolean;
  price_level_enabled: boolean;
  digests_enabled: boolean;
  system_alerts_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start_min: number;
  quiet_hours_end_min: number;
};

function flag(cfg: ConfigRow, kind: NotifyKind): boolean {
  switch (kind) {
    case "new_picks": return cfg.new_picks_enabled;
    case "future_leaders": return cfg.future_leaders_enabled;
    case "price_level": return cfg.price_level_enabled;
    case "digests": return cfg.digests_enabled;
    case "system_alerts": return cfg.system_alerts_enabled;
  }
}

export function isInQuietHours(cfg: ConfigRow, kind: NotifyKind, now = new Date()): boolean {
  if (kind === "system_alerts") return false;
  if (!cfg.quiet_hours_enabled) return false;
  const start = cfg.quiet_hours_start_min;
  const end = cfg.quiet_hours_end_min;
  if (start === end) return false;
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  return start < end ? (m >= start && m < end) : (m >= start || m < end);
}

const DEFAULT_CFG: ConfigRow = {
  new_picks_enabled: true,
  future_leaders_enabled: true,
  price_level_enabled: true,
  digests_enabled: false,
  system_alerts_enabled: true,
  quiet_hours_enabled: false,
  quiet_hours_start_min: 1320,
  quiet_hours_end_min: 780,
};

async function loadConfig(): Promise<ConfigRow> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("telegram_config")
    .select("new_picks_enabled,future_leaders_enabled,price_level_enabled,digests_enabled,system_alerts_enabled,quiet_hours_enabled,quiet_hours_start_min,quiet_hours_end_min")
    .eq("id", 1)
    .maybeSingle();
  return { ...DEFAULT_CFG, ...(data as Partial<ConfigRow> | null ?? {}) };
}

async function loadActiveChatIds(): Promise<number[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("telegram_chats")
    .select("chat_id")
    .eq("is_active", true);
  return (data ?? []).map((r) => Number(r.chat_id));
}

/**
 * Kept for backwards compatibility with existing callers. Returns every active
 * chat as recipients (or empty when kind is disabled / inside quiet hours).
 */
export async function loadLinkedRecipients(kind: NotifyKind): Promise<
  Array<{ userId: string; chatId: number }>
> {
  const cfg = await loadConfig();
  if (!flag(cfg, kind)) return [];
  if (isInQuietHours(cfg, kind)) return [];
  const chatIds = await loadActiveChatIds();
  return chatIds.map((chatId) => ({ userId: "shared", chatId }));
}

export async function notifyUser(_userId: string, kind: NotifyKind, text: string): Promise<boolean> {
  const rs = await loadLinkedRecipients(kind);
  if (!rs.length) return false;
  let anyOk = false;
  for (const r of rs) if (await sendRaw(r.chatId, text)) anyOk = true;
  return anyOk;
}

export async function broadcast(kind: NotifyKind, text: string): Promise<{ sent: number; total: number }> {
  const rs = await loadLinkedRecipients(kind);
  let sent = 0;
  for (const r of rs) if (await sendRaw(r.chatId, text)) sent++;
  return { sent, total: rs.length };
}

// ── System event broadcasting (dedup per event_key per hour) ────────────

export type SystemLevel = "info" | "warn" | "critical";
const LEVEL_EMOJI: Record<SystemLevel, string> = { info: "ℹ️", warn: "⚠️", critical: "🚨" };
const currentHourKey = (now = new Date()) => now.toISOString().slice(0, 13);

export async function notifySystemEvent(
  level: SystemLevel,
  event: string,
  details: string,
): Promise<{ sent: number; deduped: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const eventKey = `${event}|${currentHourKey()}`;
  const { error } = await supabaseAdmin
    .from("system_alert_deliveries")
    .insert({ event_key: eventKey, level, event, details });
  if (error) return { sent: 0, deduped: true };
  const msg =
    `${LEVEL_EMOJI[level]} <b>SYSTEM · ${escapeHtml(event)}</b>\n` +
    `${escapeHtml(details)}\n` +
    `<i>${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</i>`;
  const res = await broadcast("system_alerts", msg);
  return { sent: res.sent, deduped: false };
}
