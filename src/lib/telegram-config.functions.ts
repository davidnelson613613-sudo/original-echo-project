// Auth'd server fns for the Telegram Alerts panel.
//
// Chats are auto-registered when they message the bot (webhook), so this
// module never manages a "chat_id" — it just exposes the shared category /
// quiet-hours settings and reports how many active chats will receive
// broadcasts.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const TELEGRAM_BOT_USERNAME = "LOVBBBEBOT";
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=laddrx`;

export type TelegramConfig = {
  active_chat_count: number;
  new_picks_enabled: boolean;
  future_leaders_enabled: boolean;
  price_level_enabled: boolean;
  digests_enabled: boolean;
  system_alerts_enabled: boolean;
  min_pick_score: number;
  digest_min_gap_minutes: number;
  quiet_hours_enabled: boolean;
  quiet_hours_start_min: number;
  quiet_hours_end_min: number;
};

const COLS =
  "new_picks_enabled,future_leaders_enabled,price_level_enabled,digests_enabled,system_alerts_enabled,min_pick_score,digest_min_gap_minutes,quiet_hours_enabled,quiet_hours_start_min,quiet_hours_end_min";

export const getTelegramConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TelegramConfig> => {
    const [cfgRes, chatsRes] = await Promise.all([
      context.supabase.from("telegram_config").select(COLS).eq("id", 1).maybeSingle(),
      context.supabase.from("telegram_chats").select("chat_id", { count: "exact", head: true }).eq("is_active", true),
    ]);
    const row = (cfgRes.data ?? {}) as Partial<TelegramConfig>;
    return {
      active_chat_count: chatsRes.count ?? 0,
      new_picks_enabled: row.new_picks_enabled ?? true,
      future_leaders_enabled: row.future_leaders_enabled ?? true,
      price_level_enabled: row.price_level_enabled ?? true,
      digests_enabled: row.digests_enabled ?? false,
      system_alerts_enabled: row.system_alerts_enabled ?? true,
      min_pick_score: Number(row.min_pick_score ?? 60),
      digest_min_gap_minutes: Number(row.digest_min_gap_minutes ?? 15),
      quiet_hours_enabled: row.quiet_hours_enabled ?? false,
      quiet_hours_start_min: Number(row.quiet_hours_start_min ?? 1320),
      quiet_hours_end_min: Number(row.quiet_hours_end_min ?? 780),
    };
  });

export const saveTelegramConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Partial<TelegramConfig>) => data)
  .handler(async ({ data, context }) => {
    // active_chat_count is derived, never written back.
    const { active_chat_count: _ignored, ...writable } = data;
    void _ignored;
    // Check current owner via admin (bypasses RLS) so a non-owner gets a clean
    // error instead of a policy violation. First writer becomes the owner.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("telegram_config")
      .select("owner_user_id")
      .eq("id", 1)
      .maybeSingle();
    if (existing?.owner_user_id && existing.owner_user_id !== context.userId) {
      throw new Error(
        "Telegram settings are locked to the workspace owner and cannot be edited by other accounts.",
      );
    }
    const { error } = await context.supabase
      .from("telegram_config")
      .upsert(
        {
          id: 1,
          owner_user_id: context.userId,
          ...writable,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendTelegramTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const [{ sendRaw }, { supabaseAdmin }] = await Promise.all([
      import("./telegram-notify.server"),
      import("@/integrations/supabase/client.server"),
    ]);
    const { data } = await supabaseAdmin
      .from("telegram_chats")
      .select("chat_id")
      .eq("is_active", true);
    const chats = (data ?? []).map((r) => Number(r.chat_id));
    if (chats.length === 0) {
      throw new Error(`Open @${TELEGRAM_BOT_USERNAME} on Telegram and press Start first`);
    }
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    let sent = 0;
    for (const chatId of chats) {
      const ok = await sendRaw(
        chatId,
        `🧪 <b>Test notification</b>\nDelivering to ${chats.length} chat${chats.length === 1 ? "" : "s"}.\n<i>${stamp} UTC</i>`,
      );
      if (ok) sent++;
    }
    if (sent === 0) throw new Error("Gateway rejected the message");
    return { ok: true, sent, total: chats.length };
  });
