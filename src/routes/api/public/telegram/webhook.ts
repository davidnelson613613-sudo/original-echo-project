// Telegram webhook — zero-friction activation.
//
// Any chat that messages the bot is auto-added to `telegram_chats` and starts
// receiving alerts. No "connect", no account signup, no single-chat lock.
// The same user can add as many chats as they want (preview + published,
// phone + laptop) — every active chat receives the same broadcast.

import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function deriveSecret(apiKey: string): string {
  return createHash("sha256").update(`telegram-webhook:${apiKey}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const l = Buffer.from(a);
  const r = Buffer.from(b);
  return l.length === r.length && timingSafeEqual(l, r);
}

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

async function tg(method: string, body: Record<string, unknown>) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY!;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY!;
  const res = await fetch(`${GATEWAY}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`tg ${method} ${res.status}: ${await res.text()}`);
}

/** Add or re-activate this chat as an alert recipient. Idempotent. */
async function registerChat(
  admin: SupabaseClient<Database>,
  chatId: number,
  label: string | null,
): Promise<{ isNew: boolean }> {
  const existing = await admin
    .from("telegram_chats")
    .select("chat_id,is_active")
    .eq("chat_id", chatId)
    .maybeSingle();
  await admin
    .from("telegram_chats")
    .upsert(
      { chat_id: chatId, is_active: true, label, updated_at: new Date().toISOString() },
      { onConflict: "chat_id" },
    );
  return { isNew: !existing.data };
}

async function firstProfileId(admin: SupabaseClient<Database>): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function ensureTelegramConversation(
  admin: SupabaseClient<Database>,
  userId: string,
  chatId: number,
): Promise<string> {
  const title = `Telegram · chat ${chatId}`;
  const existing = await admin
    .from("chat_conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "telegram")
    .eq("title", title)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id;
  const inserted = await admin
    .from("chat_conversations")
    .insert({ user_id: userId, source: "telegram", title })
    .select("id")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data.id;
}

function extractText(content: unknown): string | null {
  if (!content) return null;
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    const c = content as { text?: string; parts?: Array<{ type: string; text?: string }> };
    if (typeof c.text === "string") return c.text;
    if (Array.isArray(c.parts))
      return c.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
  }
  return null;
}

async function runTelegramAgent(chatId: number, userText: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return "AI is not configured on the server.";
  const [{ supabaseAdmin }, { createLovableAiGatewayProvider }, agentMod, aiMod] =
    await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/ai-gateway.server"),
      import("@/lib/ai-agent.server"),
      import("ai"),
    ]);
  const { buildServerTools, buildMarketTools, AGENT_SYSTEM } = agentMod;
  const { generateText, stepCountIs } = aiMod;
  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-3-flash-preview");

  const ownerId = await firstProfileId(supabaseAdmin);
  // Market/scanner/analog/quote/knowledge tools are always available — they don't
  // need a signed-in user and are essential to prevent price/scanner fabrication.
  // User-scoped tools (positions, prefs, alerts) are added only when we have an
  // owner id — otherwise the agent MUST refuse "my positions" questions instead
  // of inventing holdings.
  const tools = ownerId ? buildServerTools(ownerId, supabaseAdmin) : buildMarketTools();
  const ownerNote = ownerId
    ? ""
    : "\n\nNO signed-in user is bound to this Telegram chat. You do NOT have access to any user's positions, alerts, or settings. If asked about 'my positions' or similar, say so plainly instead of inventing anything.";

  let priorMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  let convUuid: string | null = null;
  if (ownerId) {
    convUuid = await ensureTelegramConversation(supabaseAdmin, ownerId, chatId);
    const { data: history } = await supabaseAdmin
      .from("chat_messages")
      .select("role,content,created_at")
      .eq("conversation_id", convUuid)
      .order("created_at", { ascending: false })
      .limit(20);
    priorMessages = (history ?? [])
      .reverse()
      .map((h) => ({
        role: h.role as "user" | "assistant" | "system",
        content: typeof h.content === "string" ? h.content : extractText(h.content) ?? "",
      }))
      .filter((m) => m.content);
  }

  const started = Date.now();
  try {
    const result = await generateText({
      model,
      system:
        AGENT_SYSTEM +
        ownerNote +
        "\n\nYou are replying via Telegram — keep answers short and phone-friendly. Always cite the freshness timestamp (e.g. 'quote 10:37 ET' or 'scanned 09:45 ET') next to any live number.",
      messages: [...priorMessages, { role: "user" as const, content: userText }],
      tools,
      stopWhen: stepCountIs(50),
    });
    const reply = result.text?.trim() || "(no reply)";
    console.log(
      "[telegram-agent]",
      JSON.stringify({
        at: new Date().toISOString(),
        chatId,
        ownerBound: !!ownerId,
        latencyMs: Date.now() - started,
        steps: result.steps?.length ?? 0,
        toolCalls: result.steps?.flatMap((s) => s.toolCalls?.map((tc) => tc.toolName) ?? []) ?? [],
        replyChars: reply.length,
      }),
    );
    if (ownerId && convUuid) {
      await supabaseAdmin.from("chat_messages").insert([
        { conversation_id: convUuid, user_id: ownerId, role: "user", content: { type: "text", text: userText } as never },
        { conversation_id: convUuid, user_id: ownerId, role: "assistant", content: { type: "text", text: reply } as never },
      ]);
    }
    return reply;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[telegram-agent] error", { chatId, error: msg });
    return `I hit an error reaching the data pipeline (${msg.slice(0, 200)}). I won't guess an answer — please try again in a moment.`;
  }
}


export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
        if (!TELEGRAM_API_KEY) return new Response("Telegram not configured", { status: 500 });

        const expected = deriveSecret(TELEGRAM_API_KEY);
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, expected)) return new Response("Unauthorized", { status: 401 });

        const update = (await request.json()) as {
          message?: {
            chat?: { id?: number; type?: string; title?: string };
            text?: string;
            from?: { first_name?: string; username?: string };
          };
          edited_message?: { chat?: { id?: number }; text?: string };
        };
        const msg = update.message ?? update.edited_message;
        const chatId = msg?.chat?.id;
        const text = (msg?.text ?? "").trim();
        if (!chatId) return Response.json({ ok: true });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const from = (update.message?.from ?? {}) as { first_name?: string; username?: string };
        const label = from.username
          ? `@${from.username}`
          : from.first_name ?? update.message?.chat?.title ?? null;

        // ── /stop → mute this chat ──
        if (text === "/stop" || text === "/reset") {
          await supabaseAdmin
            .from("telegram_chats")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("chat_id", chatId);
          await tg("sendMessage", {
            chat_id: chatId,
            text: "🔇 This chat is muted. Send /start to receive alerts again.",
          });
          return Response.json({ ok: true });
        }

        // Every other message auto-registers / re-activates.
        const { isNew } = await registerChat(supabaseAdmin, chatId, label);

        if (isNew || text === "/start" || text === "/help") {
          await tg("sendMessage", {
            chat_id: chatId,
            text:
              "👋 <b>You're in.</b>\n\nThis chat is now receiving Laddrx alerts (buy zones, new picks, future leaders, digests, system health).\n\nAdd me to as many chats as you want — every one gets the same alerts.\n\nCommands:\n<code>/stop</code> mute this chat\n<code>/start</code> unmute\n\nJust message me normally to chat with the AI.",
            parse_mode: "HTML",
          });
          if (text === "/start" || text === "/help") return Response.json({ ok: true });
        }

        if (!text) return Response.json({ ok: true });

        await tg("sendChatAction", { chat_id: chatId, action: "typing" });
        const reply = await runTelegramAgent(chatId, text);
        const chunks = reply.match(/[\s\S]{1,4000}/g) ?? [reply];
        for (const c of chunks) {
          await tg("sendMessage", { chat_id: chatId, text: c, disable_web_page_preview: true });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
