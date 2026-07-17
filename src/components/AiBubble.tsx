import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BrainCircuit,
  ChevronLeft,
  Check,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  Ghost,
  History,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Radio,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useRouterState } from "@tanstack/react-router";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { getDeepContext, getSnapshot, listCapabilities, readSavedScanSnapshot, subscribe, type AppSnapshot } from "@/lib/app-bridge";
import {
  loadThreads,
  newThread,
  saveThreads,
  titleFrom,
  type ChatThread,
} from "@/lib/chat-storage";
import {
  AI_MODELS,
  DEFAULT_MODEL,
  loadModel,
  saveModel,
  getModelById,
  type AiModelId,
} from "@/lib/ai-models";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

function useAppSnapshot(): AppSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function buildContext(s: AppSnapshot) {
  const savedScan = s.scan?.rows?.length ? null : readSavedScanSnapshot();
  const activeScan = s.scan?.rows?.length ? s.scan : savedScan?.scan ?? s.scan;
  const rows = (activeScan?.rows ?? []).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    price: r.price,
    change1d: r.change1d,
    changePct1d: r.price > 0 && r.change1d != null ? (r.change1d / (r.price - r.change1d)) * 100 : null,
    intraday: r.intraday,
    regime: r.regime,
    regimeLabel: r.regimeLabel,
    regimeExplanation: r.regimeExplanation,
    regimeReasons: r.regimeReasons,
    regimeConfidence: r.confidence,
    secondaryRegime: r.secondaryRegime,
    secondaryRegimeLabel: r.secondaryRegimeLabel,
    scenarioKey: r.scenarioKey,
    scenarioTitle: r.scenarioTitle,
    scenarioWhy: r.scenarioWhy,
    status: r.status,
    statusReason: r.statusReason,
    watchingFor: r.watchingFor,
    score: r.score,
    setupQuality: r.setupQuality,
    executionConfidence: r.executionConfidence,
    setupFactors: r.setupFactors,
    executionFactors: r.executionFactors,
    reasons: r.reasons,
    decisionPath: r.decisionPath,
    distSma50Pct: r.distSma50Pct,
    distSma200Pct: r.distSma200Pct,
    rsiDaily: r.rsiDaily,
    atr14Pct: r.price > 0 ? (r.atr14 / r.price) * 100 : null,
    drawdown20Pct: r.drawdown20Pct,
    drawdown60Pct: r.drawdown60Pct,
    ladder: (r.adaptiveLadder ?? []).map((l) => ({
      pct: l.pct,
      price: l.price,
      label: l.label,
      reason: l.reason,
    })),
    ladderFlags: r.ladderFlags,
    isQualifiedDip: r.isQualifiedDip,
    riskLevel: r.riskLevel,
    riskReasons: r.riskReasons,
    marketContext: r.marketContext,
    marketContextNote: r.marketContextNote,
    analog: r.analog
      ? {
          bestSymbol: r.analog.bestSymbol,
          bestDate: r.analog.bestDate,
          isSameSymbol: r.analog.isSameSymbol,
          similarity: r.analog.similarity,
          confidence: r.analog.confidence,
          agreement: r.analog.agreement,
          sampleSize: r.analog.sampleSize,
          favorability: r.analog.favorability,
          probReversal: r.analog.probReversal,
          probBottomIn: r.analog.probBottomIn,
          probContinuedDecline: r.analog.probContinuedDecline,
          failureRate: r.analog.failureRate,
          recoveryRate: r.analog.recoveryRate,
          expectedRemainingDownsidePct: r.analog.expectedRemainingDownsidePct,
          meanFwd90: r.analog.meanFwd90,
        }
      : null,
    analogStatus: r.analogStatus,
  }));
  const positions = Object.entries(s.positions).map(([sym, p]) => {
    const filledPct = p.entries.reduce((a, e) => a + e.pct, 0);
    const capDeployed = p.entries.reduce((a, e) => a + e.shares * e.price, 0);
    const shares = p.entries.reduce((a, e) => a + e.shares, 0);
    return {
      symbol: sym,
      totalCapital: p.totalCapital,
      scenario: p.scenario,
      filledPct,
      capDeployed,
      shares,
      avgCost: shares > 0 ? capDeployed / shares : 0,
      entries: p.entries,
    };
  });
  return {
    now: new Date().toISOString(),
    marketOpen: s.marketOpen,
    capital: s.capital,
    fractional: s.fractional,
    settings: s.posSettings,
    speedMode: s.speedMode,
    spyChangePct: activeScan?.spyChangePct ?? null,
    scannedAt: activeScan?.scannedAt ?? null,
    browserSavedScanAt: savedScan?.savedAt ?? null,
    scanWarning: activeScan?.warning ?? null,
    scanError: s.scanError,
    scanLoading: s.scanLoading,
    rows,
    positions,
  };
}

function readVisibleScreen() {
  if (typeof document === "undefined") return undefined;
  const main = document.querySelector("main") ?? document.body;
  const text = (main.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18_000);
  return {
    route: window.location.pathname,
    title: document.title,
    capturedAt: new Date().toISOString(),
    text,
  };
}

function isTextPart(part: UIMessage["parts"][number]): part is { type: "text"; text: string } {
  return part.type === "text";
}

function shortTime(iso?: string | null) {
  if (!iso) return "No scan yet";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function AiBubble({ variant = "bubble" }: { variant?: "bubble" | "page" } = {}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPage = variant === "page";
  const [open, setOpen] = useState(isPage);
  const [ghost, setGhost] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showThreads, setShowThreads] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [modelId, setModelId] = useState<AiModelId>(DEFAULT_MODEL);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const snapshot = useAppSnapshot();

  useEffect(() => {
    setModelId(loadModel());
    if (typeof window !== "undefined") {
      setGhost(window.localStorage.getItem("qs_ai_bubble_ghost") === "1");
      setHidden(window.localStorage.getItem("qs_ai_bubble_hidden") === "1");
    }
  }, []);

  const toggleGhost = useCallback(() => {
    setGhost((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("qs_ai_bubble_ghost", next ? "1" : "0");
      }
      if (next) toast.message("AI bubble ghosted — clicks pass through it");
      else toast.message("AI bubble is interactive again");
      return next;
    });
  }, []);
  const hideBubble = useCallback(() => {
    setHidden(true);
    setOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("qs_ai_bubble_hidden", "1");
    }
    toast.message("AI bubble hidden — tap the small dot to bring it back");
  }, []);
  const showBubble = useCallback(() => {
    setHidden(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("qs_ai_bubble_hidden", "0");
    }
  }, []);
  const selectedModel = getModelById(modelId);
  const chooseModel = (id: AiModelId) => {
    setModelId(id);
    saveModel(id);
  };

  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const loaded = loadThreads();
    if (loaded.length === 0) {
      const t = newThread();
      setThreads([t]);
      setActiveId(t.id);
      saveThreads([t]);
    } else {
      setThreads(loaded);
      setActiveId(loaded[0].id);
    }
  }, []);

  const active = useMemo(() => threads.find((t) => t.id === activeId) ?? null, [threads, activeId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: async ({ messages }) => {
          const { data } = await supabase.auth.getSession();
          const headers = data.session?.access_token
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : undefined;
          return {
            headers,
            body: {
            messages,
            context: buildContext(getSnapshot()),
            deepContext: getDeepContext(),
            capabilities: listCapabilities(),
            currentRoute: typeof window !== "undefined" ? window.location.pathname : undefined,
            visibleScreen: readVisibleScreen(),
            model: loadModel(),
            conversationId: activeId,
            },
          };
        },
      }),
    [activeId],
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    id: activeId ?? "unmounted",
    transport,
    onError: (err) => {
      toast.error(err.message || "AI request failed");
    },
  });

  const loadedForThread = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId || !active) return;
    if (loadedForThread.current === activeId) return;
    loadedForThread.current = activeId;
    setMessages((active.messages as unknown as UIMessage[]) ?? []);
  }, [activeId, active, setMessages]);

  useEffect(() => {
    if (!activeId || loadedForThread.current !== activeId) return;
    setThreads((prev) => {
      const next = prev.map((t) => {
        if (t.id !== activeId) return t;
        const firstUser = messages.find((m) => m.role === "user");
        const firstText = firstUser?.parts?.find(isTextPart)?.text ?? "";
        return {
          ...t,
          title: firstText ? titleFrom(firstText) : t.title,
          updatedAt: new Date().toISOString(),
          messages: messages as unknown as ChatThread["messages"],
        };
      });
      saveThreads(next);
      return next;
    });
  }, [messages, activeId]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open, activeId, status]);

  const busy = status === "submitted" || status === "streaming";

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text || busy || !activeId) return;
      sendMessage({ text });
    },
    [busy, activeId, sendMessage],
  );

  const startNewThread = () => {
    const t = newThread();
    setThreads((prev) => {
      const next = [t, ...prev];
      saveThreads(next);
      return next;
    });
    loadedForThread.current = null;
    setActiveId(t.id);
    setShowThreads(false);
  };

  const selectThread = (id: string) => {
    loadedForThread.current = null;
    setActiveId(id);
    setShowThreads(false);
  };

  const deleteThread = (id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = newThread();
        saveThreads([fresh]);
        loadedForThread.current = null;
        setActiveId(fresh.id);
        return [fresh];
      }
      saveThreads(next);
      if (id === activeId) {
        loadedForThread.current = null;
        setActiveId(next[0].id);
      }
      return next;
    });
  };

  const liveRows = snapshot.scan?.rows ?? [];
  const topRow = liveRows[0];
  const dataStatus = snapshot.scanLoading
    ? "Reading"
    : liveRows.length > 0
      ? `${liveRows.length} rows`
      : "Waiting";

  // Hide the floating bubble when the full AI page is active.
  if (variant === "bubble" && pathname === "/ai") return null;

  return (
    <>
      {!isPage && hidden && (
        <button
          onClick={showBubble}
          aria-label="Show AI assistant"
          title="Show AI assistant"
          className="fixed bottom-3 right-3 z-50 grid h-6 w-6 place-items-center rounded-full border border-cyan-400/50 bg-slate-950/80 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.4)] backdrop-blur hover:bg-slate-900"
        >
          <Eye className="h-3 w-3" />
        </button>
      )}

      {!isPage && !hidden && (
      <div
        className={`fixed bottom-4 right-4 z-50 flex flex-col items-end gap-1.5 transition-opacity ${
          ghost && !open ? "opacity-20" : "opacity-100"
        }`}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={toggleGhost}
            aria-label={ghost ? "Make AI bubble solid" : "Make AI bubble see-through"}
            title={ghost ? "Make solid" : "See-through (clicks pass through)"}
            className="grid h-6 w-6 place-items-center rounded-full border border-slate-700 bg-slate-950/85 text-slate-300 shadow backdrop-blur hover:border-cyan-400/50 hover:text-cyan-200"
          >
            <Ghost className="h-3 w-3" />
          </button>
          <button
            onClick={hideBubble}
            aria-label="Hide AI bubble"
            title="Hide AI bubble"
            className="grid h-6 w-6 place-items-center rounded-full border border-slate-700 bg-slate-950/85 text-slate-300 shadow backdrop-blur hover:border-rose-400/50 hover:text-rose-300"
          >
            <EyeOff className="h-3 w-3" />
          </button>
        </div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        className={`group relative flex h-[68px] w-[68px] items-center justify-center rounded-2xl transition hover:-translate-y-0.5 ${
          ghost && !open ? "pointer-events-none" : ""
        }`}
      >
        <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-400/70 via-sky-500/60 to-fuchsia-500/60 opacity-90 blur-[10px] transition group-hover:opacity-100" />
        <span className="absolute inset-[2px] rounded-[15px] bg-gradient-to-br from-cyan-400 via-sky-500 to-fuchsia-500" />
        <span className="absolute inset-[3px] rounded-[14px] bg-slate-950" />
        {open ? (
          <X className="relative h-5 w-5 text-slate-100" />
        ) : (
          <div className="relative grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-cyan-400/15 to-fuchsia-500/10 text-cyan-100">
            <BrainCircuit className="h-6 w-6" />
            <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
            </span>
          </div>
        )}
      </button>
      </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Laddrx AI assistant"
          className={
            isPage
              ? "relative mx-auto flex h-[calc(100dvh-56px)] w-full max-w-6xl flex-col overflow-hidden"
              : "fixed bottom-24 right-3 z-50 flex h-[min(84vh,720px)] w-[min(calc(100vw-24px),460px)] flex-col overflow-hidden rounded-[22px] p-[1px] shadow-[0_30px_110px_rgba(0,0,0,0.65),0_0_60px_rgba(34,211,238,0.14)] sm:right-4"
          }
          style={
            isPage
              ? undefined
              : {
                  backgroundImage:
                    "linear-gradient(140deg, rgba(34,211,238,0.55), rgba(139,92,246,0.35) 45%, rgba(15,23,42,0.4) 75%)",
                }
          }
        >
          <div
            className={
              isPage
                ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950"
                : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[21px] bg-slate-950/98 backdrop-blur-xl"
            }
          >
          <div className="relative overflow-hidden border-b border-cyan-300/15 bg-gradient-to-b from-slate-900/95 to-slate-950/95 px-4 pb-3 pt-3.5">
            <div className="pointer-events-none absolute -top-16 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="pointer-events-none absolute -top-10 right-0 h-24 w-40 rounded-full bg-fuchsia-500/10 blur-3xl" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative shrink-0">
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-400/40 to-fuchsia-500/40 blur-md" />
                  <div className="relative grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/35 bg-slate-950 text-cyan-200 shadow-[inset_0_0_20px_rgba(34,211,238,0.15)]">
                    <BrainCircuit className="h-5 w-5" />
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate bg-gradient-to-r from-slate-50 via-cyan-100 to-slate-50 bg-clip-text text-[15px] font-black tracking-tight text-transparent">
                      Laddrx AI
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-gradient-to-r from-amber-400/15 to-yellow-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.15)]">
                      <Star className="h-2.5 w-2.5 fill-amber-300" /> Pro
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
                    <Radio className="h-2.5 w-2.5 text-emerald-300" />
                    <span className="text-emerald-300/90">Online</span>
                    <span className="text-slate-700">·</span>
                    <span className="truncate">{selectedModel?.label ?? "AI"} · chat + app data</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-900/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300 backdrop-blur transition hover:border-cyan-400/50 hover:text-cyan-100"
                      title="Change AI model"
                    >
                      <Cpu className="h-3 w-3 text-cyan-300" />
                      <span className="truncate max-w-[70px] sm:max-w-[100px] normal-case tracking-normal">{selectedModel?.label ?? "Model"}</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72 border-slate-800 bg-slate-950 text-slate-200">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-500">Choose model</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-slate-800" />
                    {AI_MODELS.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => chooseModel(m.id)}
                        className="flex items-start gap-2 py-2 focus:bg-cyan-400/10 focus:text-cyan-100"
                      >
                        <div className="mt-0.5 grid h-4 w-4 place-items-center">
                          {m.id === modelId ? (
                            <Check className="h-3.5 w-3.5 text-cyan-300" />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            {m.label}
                            <span className="rounded border border-slate-700 bg-slate-900 px-1 py-0 text-[9px] font-mono text-slate-500">{m.vendor}</span>
                            <span className="rounded border border-cyan-400/25 bg-cyan-400/5 px-1 py-0 text-[9px] font-mono text-cyan-300">{m.tier}</span>
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">{m.blurb}</div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={() => setShowThreads((v) => !v)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700/70 bg-slate-900/70 text-slate-400 backdrop-blur transition hover:border-cyan-400/50 hover:bg-slate-900 hover:text-cyan-200"
                  aria-label="Toggle chat history"
                  title="Chat history"
                >
                  {showThreads ? (
                    <ChevronLeft className="h-4 w-4" />
                  ) : (
                    <PanelLeft className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={startNewThread}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-400/30 bg-gradient-to-br from-cyan-400/15 to-fuchsia-500/10 text-cyan-100 transition hover:from-cyan-400/25 hover:to-fuchsia-500/20"
                  aria-label="New chat"
                  title="New chat"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="relative mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 px-2 py-1.5 shadow-inner shadow-black/40">
                <div className="flex items-center gap-1 text-slate-500"><RefreshCw className="h-2.5 w-2.5" /> Scan</div>
                <div className="truncate text-slate-200">{shortTime(snapshot.scan?.scannedAt)}</div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 px-2 py-1.5 shadow-inner shadow-black/40">
                <div className="flex items-center gap-1 text-slate-500"><TrendingUp className="h-2.5 w-2.5" /> Top</div>
                <div className="truncate text-cyan-200">{topRow?.symbol ?? "Waiting"}</div>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 px-2 py-1.5 shadow-inner shadow-black/40">
                <div className="flex items-center gap-1 text-slate-500"><Zap className="h-2.5 w-2.5" /> Data</div>
                <div className="truncate text-slate-200">{dataStatus}</div>
              </div>
            </div>
          </div>

          {showThreads ? (
            <div className="flex min-h-0 flex-1 flex-col bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <History className="h-4 w-4 text-cyan-300" /> Conversations
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                    {threads.length}
                  </span>
                </div>
                <button
                  onClick={startNewThread}
                  className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 bg-gradient-to-br from-cyan-400/15 to-fuchsia-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-100 hover:from-cyan-400/25"
                >
                  <MessageSquarePlus className="h-3 w-3" /> New
                </button>
              </div>
              <div className="border-b border-slate-800/60 px-3 py-2">
                <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-2 py-1.5 focus-within:border-cyan-400/40">
                  <Search className="h-3.5 w-3.5 text-slate-500" />
                  <input
                    value={threadQuery}
                    onChange={(e) => setThreadQuery(e.target.value)}
                    placeholder="Search conversations"
                    className="w-full bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {threads
                  .filter((t) => t.title.toLowerCase().includes(threadQuery.toLowerCase()))
                  .map((t) => (
                  <div
                    key={t.id}
                    className={`group relative mb-1 flex items-center gap-2 rounded-xl border px-2.5 py-2 transition ${
                      t.id === activeId
                        ? "border-cyan-400/40 bg-gradient-to-r from-cyan-400/10 to-fuchsia-500/5 shadow-[inset_0_0_18px_rgba(34,211,238,0.08)]"
                        : "border-transparent hover:border-slate-800 hover:bg-slate-900/70"
                    }`}
                  >
                    {t.id === activeId && (
                      <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-gradient-to-b from-cyan-300 to-fuchsia-400" />
                    )}
                    <button onClick={() => selectThread(t.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-xs font-semibold text-slate-200">{t.title}</div>
                      <div className="mt-0.5 font-mono text-[9px] text-slate-600">
                        {new Date(t.updatedAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    </button>
                    <button
                      onClick={() => deleteThread(t.id)}
                      className="grid h-7 w-7 place-items-center rounded-md text-slate-600 opacity-100 transition hover:bg-rose-500/10 hover:text-rose-300 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label={`Delete ${t.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <Conversation className="min-h-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900/60">
                <ConversationContent className="gap-4 px-4 py-4">
                  {messages.length === 0 ? (
                    <ConversationEmptyState className="min-h-[340px] justify-center p-3">
                      <div className="relative mx-auto">
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-400/40 to-fuchsia-500/30 blur-xl" />
                        <div className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-cyan-300/30 bg-slate-950 text-cyan-200 shadow-[0_0_32px_rgba(34,211,238,0.2)]">
                          <BrainCircuit className="h-8 w-8" />
                        </div>
                      </div>
                      <div className="mt-4 text-center">
                        <h3 className="bg-gradient-to-r from-slate-50 via-cyan-100 to-slate-50 bg-clip-text text-[17px] font-black tracking-tight text-transparent">
                          Laddrx AI chat
                        </h3>
                        <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-slate-400">
                          Ask normal questions, or ask about the scan, visible screen, positions, risk, ladders, and market data.
                        </p>
                      </div>
                      <div className="mt-5 w-full space-y-2">
                        {[
                          { icon: TrendingUp, label: "Compare symbols", prompt: "Why is SOXX more down than SMH right now?", tint: "from-cyan-400/15 to-sky-500/5", ring: "border-cyan-400/25", ic: "text-cyan-300" },
                          { icon: BrainCircuit, label: "Read the scan", prompt: "Read all the current scan data and tell me what matters most.", tint: "from-emerald-400/15 to-teal-500/5", ring: "border-emerald-400/25", ic: "text-emerald-300" },
                          { icon: RefreshCw, label: "Recovery risk", prompt: "Is SMH likely to keep recovering or roll over again based on the app data?", tint: "from-fuchsia-400/15 to-violet-500/5", ring: "border-fuchsia-400/25", ic: "text-fuchsia-300" },
                        ].map((s) => (
                          <button
                            key={s.prompt}
                            onClick={() => sendMessage({ text: s.prompt })}
                            disabled={busy || !activeId}
                            className={`group flex w-full items-center gap-3 rounded-xl border ${s.ring} bg-gradient-to-r ${s.tint} px-3 py-2.5 text-left transition hover:brightness-125 disabled:opacity-50`}
                          >
                            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${s.ring} bg-slate-950/70 ${s.ic}`}>
                              <s.icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                {s.label}
                              </span>
                              <span className="block truncate text-[13px] font-medium text-slate-100">
                                {s.prompt}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </ConversationEmptyState>
                  ) : (
                    messages.map((m) => <AssistantMessage key={m.id} message={m} />)
                  )}

                  {busy && (
                    <div className="flex items-center gap-2.5 rounded-2xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/5 via-slate-900/60 to-fuchsia-500/5 px-3.5 py-2.5 text-xs text-slate-300 shadow-[0_0_20px_rgba(34,211,238,0.08)]">
                      <span className="relative flex h-6 w-6 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/25" />
                        <BrainCircuit className="relative h-3.5 w-3.5 text-cyan-300" />
                      </span>
                      <Shimmer className="font-medium" duration={1.6}>
                        Thinking…
                      </Shimmer>
                    </div>
                  )}

                  {snapshot.scanLoading && (
                    <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 font-mono text-[10px] text-slate-500">
                      <RefreshCw className="h-3 w-3 animate-spin text-cyan-400" />
                      Scan running — fresh market data is loading.
                    </div>
                  )}
                </ConversationContent>
                <ConversationScrollButton className="border-cyan-400/30 bg-slate-900 text-cyan-200 hover:bg-slate-800" />
              </Conversation>

              <div className="border-t border-cyan-300/15 bg-gradient-to-b from-slate-900/90 to-slate-950/95 p-3">
                {messages.length > 0 && (
                  <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {["Explain top pick", "Compare SMH vs SOXX", "What changed in the data?"].map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage({ text: q })}
                        disabled={busy || !activeId}
                        className="shrink-0 rounded-full border border-slate-700/70 bg-slate-900/70 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100 disabled:opacity-40"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
                <div className="rounded-2xl bg-gradient-to-br from-cyan-400/30 via-slate-800/40 to-fuchsia-500/25 p-[1px] shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                  <PromptInput onSubmit={handleSubmit} className="rounded-[15px] border-0 bg-slate-950">
                    <PromptInputTextarea
                      ref={textareaRef}
                      placeholder="Ask anything…"
                      disabled={busy || !activeId}
                      className="min-h-20 bg-transparent px-3 py-3 text-sm text-slate-100 placeholder:text-slate-600"
                    />
                    <PromptInputFooter className="border-t border-slate-800/70 px-2 pb-2 pt-2">
                      <div className="flex min-w-0 items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-slate-600">
                        <Sparkles className="h-3 w-3 text-cyan-400" />
                        <span className="truncate">Chat-ready · app-aware when needed</span>
                        <span className="hidden text-slate-700 sm:inline">·</span>
                        <kbd className="hidden rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[9px] normal-case text-slate-400 sm:inline">↵</kbd>
                      </div>
                      <PromptInputSubmit
                        status={status}
                        disabled={busy || !activeId}
                        className="border-0 bg-gradient-to-br from-cyan-400 to-fuchsia-500 text-slate-950 shadow-[0_4px_14px_rgba(34,211,238,0.35)] hover:brightness-110 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none"
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </PromptInputSubmit>
                    </PromptInputFooter>
                  </PromptInput>
                </div>
              </div>
            </>
          )}
          </div>
        </div>
      )}
    </>
  );
}

function AssistantMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter(isTextPart)
    .map((p) => p.text)
    .join("");
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }, [text]);

  return (
    <Message from={message.role} className={isUser ? "max-w-[88%]" : "group max-w-full"}>
      <MessageContent
        className={
          isUser
            ? "rounded-2xl rounded-tr-md bg-gradient-to-br from-cyan-300 to-cyan-400 px-3.5 py-2.5 text-sm font-medium text-slate-950 shadow-[0_6px_20px_rgba(34,211,238,0.25)]"
            : "w-full gap-3 bg-transparent px-0 py-0 text-sm text-slate-200"
        }
      >
        {!isUser && (
          <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-gradient-to-br from-cyan-400/40 to-fuchsia-500/30">
                <BrainCircuit className="h-2.5 w-2.5 text-cyan-100" />
              </span>
              <span className="text-slate-400">Laddrx AI</span>
            </div>
            {text && (
              <button
                onClick={onCopy}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-500 opacity-0 transition hover:bg-slate-800 hover:text-cyan-200 group-hover:opacity-100"
                aria-label="Copy message"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        )}

        {text && (
          <MessageResponse
            className={
              isUser
                ? "prose-p:my-0 text-slate-950"
                : "prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-strong:text-cyan-200 prose-code:text-cyan-300"
            }
          >
            {text}
          </MessageResponse>
        )}

      </MessageContent>
    </Message>
  );
}
