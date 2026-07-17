import { createFileRoute } from "@tanstack/react-router";
import { buildAppFacts } from "@/lib/app-knowledge";

type Turn = { role: "user" | "assistant"; content: string };
type Capability = {
  id: string;
  name: string;
  description: string;
  routes?: string[];
  tags?: string[];
};
type Body = {
  topic?: string;
  context?: string;
  route?: string;
  depth?: "brief" | "detailed";
  /** Optional multi-element context when the user drag-selects or circles a region. */
  selection?: Array<{ label: string; role?: string; text?: string }>;
  /** Follow-up question from the user (voice-transcribed or typed). */
  question?: string;
  /** Prior turns in this explanation thread (oldest first). */
  history?: Turn[];
  /** Live app snapshot — same shape the AI Copilot sends. */
  appState?: unknown;
  /** Deep local state (track record, validation history, champion, thread count). */
  deepState?: unknown;
  /** Registered capability catalog. */
  capabilities?: Capability[];
};

const SYSTEM = `You are the LADDRX Guide — the same intelligence that powers the AI Copilot bubble, running in Explain-a-Thing mode.

Your job: explain a SPECIFIC part of THIS app — not finance in general, not what a "bar chart" or "button" is in the abstract. You explain what THAT number, THAT badge, THAT rung, THAT toggle does INSIDE LADDRX and why it exists here.

You are given, in this order:
1. APP FACTS — authoritative descriptions of the LADDRX features most likely relevant. TREAT THESE AS GROUND TRUTH. Reuse their wording and semantics.
2. APP STATE — the live scanner snapshot, the user's positions, and settings AS THEY ARE RIGHT NOW. If the target the user pointed at maps to a specific ticker / row / rung / position visible in APP STATE, cite the real numbers ("SMH is currently in SUPPORT_TEST with Setup Quality 71"). Never invent numbers not present here.
3. DEEP STATE — recent track-record outcomes, validation champion, thread count. Use when the user asks how signals have played out.
4. CAPABILITIES — the current catalog of app features. Use to explain what a feature does or where to find it.
5. TARGET — what the user pointed at (element type, visible text, aria-label, nearby headings) and, when they circled a region, the list of elements in that region.

Voice & style — talk like ChatGPT would to a smart friend who's new to the app:
- Warm, natural, conversational English. Complete sentences. Answer first, structure after.
- A curious beginner should understand every word. Explain jargon inline when you can't avoid it.
- No emojis. No "as an AI". Never mention prompts, tools, models, APIs, JSON, or internal state block names.
- Never give financial advice; frame everything educationally ("in LADDRX this means…", "a beginner might…").
- If the target is ambiguous, say what you think it is and why, then explain that.

Response format — short natural markdown, in this order (skip a section only if it truly doesn't apply):
- **What this is** — one sentence naming the specific LADDRX feature.
- **What it does in LADDRX** — its real job in this app, grounded in APP FACTS.
- **What the number / label means** — explain the value the user is looking at, using the LIVE number from APP STATE when the target maps to one.
- **What happens if you tap or change it** — the actual in-app outcome.
- **What a beginner should do** — one clear, practical suggestion.
- **How it connects** — one sentence tying it to the rest of LADDRX (scanner → ladder → bracket → positions, etc.).

Length: brief = under 130 words. Detailed = up to 320 words. Never longer.
Follow-up questions: stay on the same target. If the follow-up drifts, answer it briefly and gently steer back.`;

function trimContext(v: unknown, maxChars = 8000): string {
  if (v === undefined || v === null) return "";
  try {
    const s = JSON.stringify(v, null, 2);
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + "\n… (truncated for prompt size)";
  } catch {
    return String(v).slice(0, maxChars);
  }
}

export const Route = createFileRoute("/api/explain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as Body;
        const topic = (body.topic ?? "").trim();
        if (!topic) return new Response("topic required", { status: 400 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("LOVABLE_API_KEY missing", { status: 500 });

        try {
          const [{ streamText }, { createLovableAiGatewayProvider }] = await Promise.all([
            import("ai"),
            import("@/lib/ai-gateway.server"),
          ]);
          const gateway = createLovableAiGatewayProvider(key);
          const model = gateway("google/gemini-3-flash-preview");

          const depth =
            body.depth === "detailed"
              ? "detailed (up to 320 words, all sections)"
              : "brief (under 130 words, keep only the most useful sections)";

          const selectionBlock =
            body.selection && body.selection.length > 0
              ? `\n\nSELECTION (user circled or drag-selected these elements, explain them as a group and how they relate):\n${body.selection
                  .slice(0, 16)
                  .map(
                    (s, i) =>
                      `${i + 1}. ${s.label}${s.role ? ` [${s.role}]` : ""}${
                        s.text ? ` — "${s.text.slice(0, 140)}"` : ""
                      }`,
                  )
                  .join("\n")}`
              : "";

          const matchText = [
            topic,
            body.context ?? "",
            (body.selection ?? []).map((s) => `${s.label} ${s.text ?? ""}`).join(" "),
          ].join(" ");
          const appFacts = buildAppFacts(matchText, body.route, 6);

          const ctx = body.context ? `\n\nTARGET CONTEXT:\n${body.context}` : "";
          const route = body.route ? `\n\nCURRENT ROUTE: ${body.route}` : "";
          const facts = appFacts
            ? `\n\nAPP FACTS (authoritative — ground your answer here):\n${appFacts}`
            : "";

          const appStateBlock = body.appState
            ? `\n\nAPP STATE (live, right now):\n${trimContext(body.appState, 6000)}`
            : "";
          const deepStateBlock = body.deepState
            ? `\n\nDEEP STATE (local history):\n${trimContext(body.deepState, 2000)}`
            : "";
          const capBlock =
            body.capabilities && body.capabilities.length
              ? `\n\nCAPABILITIES (registered features):\n${trimContext(body.capabilities, 3000)}`
              : "";

          const question = (body.question ?? "").trim();
          const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
          const historyBlock = history.length
            ? `\n\nPRIOR CONVERSATION (oldest first):\n${history
                .map((t) => `${t.role === "user" ? "USER" : "GUIDE"}: ${t.content.slice(0, 800)}`)
                .join("\n")}`
            : "";

          const promptBody = question
            ? `The user is asking a FOLLOW-UP question about the same LADDRX element. Stay grounded in APP FACTS and cite live numbers from APP STATE when they apply. If the question is off-topic, answer briefly and steer back. Answer in ${depth}, plain English.\n\nTARGET:\n"${topic}"${selectionBlock}${route}${ctx}${facts}${capBlock}${appStateBlock}${deepStateBlock}${historyBlock}\n\nUSER FOLLOW-UP: ${question}`
            : `Explain to a curious beginner in ${depth}, grounded in APP FACTS and specific to LADDRX (never generic). Cite live numbers from APP STATE when the target maps to a real row / rung / position visible there.\n\nTARGET:\n"${topic}"${selectionBlock}${route}${ctx}${facts}${capBlock}${appStateBlock}${deepStateBlock}`;

          const result = streamText({
            model,
            system: SYSTEM,
            prompt: promptBody,
          });
          return result.toTextStreamResponse();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(`AI error: ${msg}`, { status: 500 });
        }
      },
    },
  },
});
