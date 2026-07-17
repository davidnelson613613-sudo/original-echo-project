import { HelpCircle, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useSimpleMode } from "@/lib/simple-mode";
import { cn } from "@/lib/utils";

// Session-scoped cache so the same explanation isn't re-fetched on every hover.
const cache = new Map<string, string>();

type Depth = "brief" | "detailed";

type Props = {
  topic: string;
  context?: string;
  route?: string;
  label?: string;
  className?: string;
  /** Force the trigger visible even when Simple Mode is off (rare). */
  alwaysShow?: boolean;
  size?: "xs" | "sm";
  align?: "start" | "center" | "end";
};

/**
 * SimpleExplain — a small "Ask AI" trigger the user can drop next to any label,
 * number, chart, or control. When Simple Mode is on it renders a subtle "?"
 * button; clicking it streams a plain-English explanation from /api/explain.
 *
 * This is a pure guidance overlay — it never mutates any app state.
 */
export function SimpleExplain({
  topic,
  context,
  route,
  label,
  className,
  alwaysShow = false,
  size = "sm",
  align = "start",
}: Props) {
  const { simple } = useSimpleMode();
  const [open, setOpen] = useState(false);
  const [depth, setDepth] = useState<Depth>("brief");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cacheKey = `${topic}::${depth}::${route ?? ""}::${context ?? ""}`;

  const fetchExplain = useCallback(async () => {
    const cached = cache.get(cacheKey);
    if (cached) {
      setText(cached);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setErr(null);
    setText("");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, context, route, depth }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setText(acc);
      }
      cache.set(cacheKey, acc);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr((e as Error).message || "Failed to load explanation");
    } finally {
      setLoading(false);
    }
  }, [topic, context, route, depth, cacheKey]);

  useEffect(() => {
    if (open) void fetchExplain();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, depth]);

  if (!simple && !alwaysShow) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ? `Explain: ${label}` : "Ask AI to explain"}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 font-mono uppercase tracking-[0.18em] text-cyan-200 transition hover:border-cyan-300/60 hover:bg-cyan-400/20 hover:text-cyan-100",
            size === "xs" ? "text-[9px]" : "text-[10px]",
            className,
          )}
        >
          <HelpCircle className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} />
          <span className="hidden sm:inline">Explain</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[min(22rem,calc(100vw-2rem))] border-cyan-400/25 bg-slate-950/95 p-3 text-slate-100 shadow-[0_20px_60px_-20px_rgba(34,211,238,0.4)] backdrop-blur"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">
              Simple Mode · AI
            </span>
          </div>
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-[10px]">
            <button
              type="button"
              onClick={() => setDepth("brief")}
              className={cn(
                "px-1.5 py-0.5 font-mono uppercase tracking-wider transition",
                depth === "brief" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-400 hover:text-slate-200",
              )}
            >
              Brief
            </button>
            <button
              type="button"
              onClick={() => setDepth("detailed")}
              className={cn(
                "border-l border-slate-700 px-1.5 py-0.5 font-mono uppercase tracking-wider transition",
                depth === "detailed" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-400 hover:text-slate-200",
              )}
            >
              More
            </button>
          </div>
        </div>
        {label ? (
          <div className="mb-2 text-[11px] font-semibold text-slate-200">{label}</div>
        ) : null}
        {loading && !text ? (
          <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        ) : null}
        {err ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200">
            {err}
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 h-6 w-full text-[11px] text-red-100 hover:bg-red-500/20"
              onClick={() => void fetchExplain()}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {text ? (
          <div className="prose prose-invert prose-sm max-w-none text-[12.5px] leading-relaxed [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5 [&_strong]:text-cyan-100">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
