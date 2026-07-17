// LocalStorage-backed multi-thread chat store for the AI bubble.
import type { UIMessage } from "ai";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type ChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  messages: UIMessage[];
};

const KEY = "qs_ai_bubble_threads_v1";

function isBrowser() {
  return typeof window !== "undefined";
}

export function loadThreads(): ChatThread[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return normalizeThreads(parsed);
  } catch {
    return [];
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function textPart(text: string) {
  return { type: "text" as const, text };
}

function normalizeMessage(raw: unknown, index: number): UIMessage | null {
  if (!isRecord(raw)) return null;
  const role = raw.role === "user" || raw.role === "assistant" || raw.role === "system" ? raw.role : "assistant";
  const id = typeof raw.id === "string" && raw.id ? raw.id : `msg-${Date.now()}-${index}`;
  const parts = Array.isArray(raw.parts)
    ? raw.parts
    : typeof raw.content === "string"
      ? [textPart(raw.content)]
      : [];
  if (parts.length === 0) return null;
  return { ...raw, id, role, parts } as UIMessage;
}

function normalizeThreads(raw: unknown): ChatThread[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, threadIndex) => {
      if (!isRecord(item)) return null;
      const messages = Array.isArray(item.messages)
        ? item.messages.map(normalizeMessage).filter((m): m is UIMessage => m !== null)
        : [];
      return {
        id: typeof item.id === "string" && item.id ? item.id : `thread-${Date.now()}-${threadIndex}`,
        title: typeof item.title === "string" && item.title ? item.title : "New chat",
        updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : new Date().toISOString(),
        messages,
      } satisfies ChatThread;
    })
    .filter((t): t is ChatThread => t !== null);
}

export function saveThreads(threads: ChatThread[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(threads));
  } catch {
    /* quota */
  }
}

export function newThread(): ChatThread {
  return {
    id:
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    title: "New chat",
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

export function titleFrom(text: string): string {
  const s = text.trim().replace(/\s+/g, " ");
  return s.length > 40 ? s.slice(0, 40) + "…" : s || "New chat";
}
