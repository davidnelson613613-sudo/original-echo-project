import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageSquare, Send, Sparkles, X, RotateCcw, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { ScanRow } from "@/lib/market.functions";

function readVisibleScreen() {
  if (typeof document === "undefined") return undefined;
  const main = document.querySelector("main") ?? document.body;
  const text = (main.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 16_000);
  return {
    route: window.location.pathname,
    title: document.title,
    text,
  };
}

function buildStockContext(row: ScanRow) {
  return {
    symbol: row.symbol,
    name: row.name,
    price: row.price,
    change1d: row.change1d,
    changePct1d:
      row.price > 0 && row.change1d != null
        ? (row.change1d / (row.price - row.change1d)) * 100
        : null,
    intraday: row.intraday,
    regime: row.regime,
    regimeLabel: row.regimeLabel,
    regimeExplanation: row.regimeExplanation,
    regimeReasons: row.regimeReasons,
    regimeConfidence: row.confidence,
    secondaryRegime: row.secondaryRegime,
    secondaryRegimeLabel: row.secondaryRegimeLabel,
    scenarioKey: row.scenarioKey,
    scenarioTitle: row.scenarioTitle,
    scenarioWhy: row.scenarioWhy,
    status: row.status,
    statusReason: row.statusReason,
    watchingFor: row.watchingFor,
    score: row.score,
    setupQuality: row.setupQuality,
    executionConfidence: row.executionConfidence,
    setupFactors: row.setupFactors,
    executionFactors: row.executionFactors,
    reasons: row.reasons,
    decisionPath: row.decisionPath,
    distSma50Pct: row.distSma50Pct,
    distSma200Pct: row.distSma200Pct,
    rsiDaily: row.rsiDaily,
    atr14Pct: row.price > 0 ? (row.atr14 / row.price) * 100 : null,
    drawdown20Pct: row.drawdown20Pct,
    drawdown60Pct: row.drawdown60Pct,
    adaptiveLadder: row.adaptiveLadder,
    ladderFlags: row.ladderFlags,
    isQualifiedDip: row.isQualifiedDip,
    riskLevel: row.riskLevel,
    riskReasons: row.riskReasons,
    marketContext: row.marketContext,
    marketContextNote: row.marketContextNote,
    analog: row.analog,
    analogStatus: row.analogStatus,
  };
}

function storageKey(symbol: string) {
  return `ask_stock_thread_${symbol.toUpperCase()}`;
}

function loadThread(symbol: string): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(symbol));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

function saveThread(symbol: string, messages: UIMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(symbol), JSON.stringify(messages));
  } catch {
    /* ignore quota */
  }
}

function textOf(m: UIMessage): string {
  return (m.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

const SUGGESTIONS = [
  "What does this data say about the setup right now?",
  "Explain the historical analog match in plain English.",
  "What's the strongest bullish evidence? Bearish evidence?",
  "How was the bottom-in probability calculated?",
  "Walk me through the adaptive ladder rungs.",
];

export function AskTheStock({ row }: { row: ScanRow }) {
  const symbol = row.symbol.toUpperCase();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rowRef = useRef(row);
  useEffect(() => {
    rowRef.current = row;
  }, [row]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ask-stock",
        prepareSendMessagesRequest: async ({ messages }) => {
          const { data } = await supabase.auth.getSession();
          const headers = data.session?.access_token
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : undefined;
          return {
            headers,
            body: {
              symbol,
              messages,
              stockContext: buildStockContext(rowRef.current),
              visibleScreen: readVisibleScreen(),
            },
          };
        },
      }),
    [symbol],
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    id: `ask-${symbol}`,
    transport,
    onError: (err) => toast.error(err.message || "Ask the Stock failed"),
  });

  // Load persisted thread once per symbol.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === symbol) return;
    loadedFor.current = symbol;
    setMessages(loadThread(symbol));
  }, [symbol, setMessages]);

  // Persist thread on change.
  useEffect(() => {
    if (loadedFor.current !== symbol) return;
    saveThread(symbol, messages);
  }, [messages, symbol]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open, symbol]);

  const busy = status === "submitted" || status === "streaming";

  const submit = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      setInput("");
      sendMessage({ text: t });
    },
    [busy, sendMessage],
  );

  const clearThread = () => {
    setMessages([]);
    saveThread(symbol, []);
    toast.message(`Cleared Ask ${symbol}`);
  };

  return (
    <Card className="relative overflow-hidden border-cyan-400/30 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
      <div className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-12 h-40 w-40 rounded-full bg-fuchsia-500/10 blur-3xl" />
      <CardContent className="relative p-4">
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            className="group flex w-full items-center justify-between gap-3 rounded-xl border border-cyan-400/30 bg-slate-950/60 p-3 text-left transition hover:border-cyan-300/60 hover:bg-slate-900/60"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-cyan-400/40 to-fuchsia-500/40 blur-md" />
                <div className="relative grid h-10 w-10 place-items-center rounded-lg border border-cyan-300/40 bg-slate-950 text-cyan-200">
                  <Sparkles className="h-5 w-5" />
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-300/70">
                    Ask the Stock
                  </span>
                  {messages.length > 0 && (
                    <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-px text-[9px] font-mono text-cyan-200">
                      {messages.filter((m) => m.role === "user").length} Q
                    </span>
                  )}
                </div>
                <div className="truncate text-lg font-black text-slate-100">
                  Ask <span className="text-cyan-300">{symbol}</span>
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  Your dedicated {symbol} analyst — every metric, chart & probability on this page.
                </div>
              </div>
            </div>
            <div className="shrink-0 rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-mono text-cyan-200 group-hover:bg-cyan-400/20">
              Open chat
            </div>
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-300/40 bg-slate-950 text-cyan-200">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-cyan-300/70">
                    Ask the Stock
                  </div>
                  <div className="text-sm font-black text-slate-100">
                    Ask <span className="text-cyan-300">{symbol}</span>
                    <span className="ml-2 text-[10px] font-mono font-normal text-slate-400">
                      ${row.price.toFixed(2)}
                      {row.change1d != null && (
                        <span
                          className={
                            row.change1d >= 0 ? "ml-1 text-emerald-400" : "ml-1 text-rose-400"
                          }
                        >
                          {row.change1d >= 0 ? "+" : ""}
                          {((row.change1d / (row.price - row.change1d)) * 100).toFixed(2)}%
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearThread}
                    className="h-7 px-2 text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    <RotateCcw className="mr-1 h-3 w-3" /> New
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="max-h-[420px] min-h-[180px] overflow-y-auto rounded-lg border border-slate-800/80 bg-slate-950/70 p-3">
              {messages.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Ask anything about {symbol} — every score, chart, probability, and paragraph on
                    this page.
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => submit(s)}
                        className="rounded-full border border-cyan-400/25 bg-cyan-400/5 px-2.5 py-1 text-[11px] text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/15"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {messages.map((m) => {
                    const text = textOf(m);
                    if (!text) return null;
                    const isUser = m.role === "user";
                    return (
                      <div
                        key={m.id}
                        className={
                          isUser
                            ? "ml-auto max-w-[85%] rounded-xl rounded-tr-sm border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-50"
                            : "mr-auto max-w-[92%] rounded-xl rounded-tl-sm border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                        }
                      >
                        {isUser ? (
                          <div className="whitespace-pre-wrap leading-relaxed">{text}</div>
                        ) : (
                          <div className="prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-li:my-0.5">
                            <Streamdown>{text}</Streamdown>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {busy && (
                    <div className="mr-auto flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Ask {symbol} is thinking…
                    </div>
                  )}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
              className="flex items-end gap-2"
            >
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(input);
                  }
                }}
                rows={2}
                placeholder={`Ask ${symbol} anything — "explain the 87% bottom-in probability", "what's the strongest bearish evidence?"…`}
                className="min-h-[52px] flex-1 resize-none border-slate-700 bg-slate-950/70 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-400/40"
              />
              <Button
                type="submit"
                disabled={busy || !input.trim()}
                className="h-[52px] bg-gradient-to-br from-cyan-500 to-fuchsia-500 px-4 text-slate-950 hover:from-cyan-400 hover:to-fuchsia-400"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
