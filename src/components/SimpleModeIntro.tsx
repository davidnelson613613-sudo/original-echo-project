import { useRouterState } from "@tanstack/react-router";
import { BookOpen, ChevronDown, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useSimpleMode } from "@/lib/simple-mode";
import { SimpleExplain } from "@/components/SimpleExplain";
import { cn } from "@/lib/utils";

type RouteBlurb = {
  match: (path: string) => boolean;
  title: string;
  body: string;
  bullets: string[];
  topic: string; // what to send to /api/explain for the "full walkthrough"
  quickTopics: { label: string; topic: string }[]; // one-tap explainers
};

const BLURBS: RouteBlurb[] = [
  {
    match: (p) => p === "/" || p === "",
    title: "You're on the Terminal",
    body: "This is your live market dashboard. The scanner watches a handful of major tech ETFs and tells you when a pullback is worth buying — and how to spread out your entries.",
    bullets: [
      "Green “BUY” tags mean the setup looks favorable right now.",
      "The ladder splits your capital into small tranches so you don't buy everything at one price.",
      "Every number has a plain-English hint underneath when Simple Mode is on.",
    ],
    topic:
      "The LADDRX Terminal home page: live scanner cards for NDX, QQQ, SMH, SOXX, SOXQ (SPY = context), regime badges (NO_DIP, FAKE_OUT, FAST_CRASH, SLOW_BLEED, V_BOUNCE_LIKELY, SUPPORT_TEST), signal status (WATCH, PROBE, BUY_STARTER, BUY_LADDER), adaptive buy-ladder rungs, positions panel, historical analog panel, and track record.",
    quickTopics: [
      { label: "What's a regime?", topic: "The 6 regimes the LADDRX scanner reports: NO_DIP, FAKE_OUT, FAST_CRASH, SLOW_BLEED, V_BOUNCE_LIKELY, SUPPORT_TEST." },
      { label: "How the ladder works", topic: "The adaptive buy-ladder: how rungs (% of capital, target price, reason) are calculated, and why splitting entries across tranches reduces bad-timing risk." },
      { label: "RSI, ATR, SMA, EMA", topic: "The four indicators shown on every ticker: RSI (momentum), ATR (typical daily swing), SMA20/50/200 (moving averages), EMA9 (fast trend). Explain each in plain English." },
      { label: "Auto-Fill vs Recovery", topic: "The difference between Auto-Fill Detection and Recovery Capture in the positions panel, and when a beginner should enable each." },
    ],
  },
  {
    match: (p) => p.startsWith("/ai"),
    title: "You're chatting with the AI Copilot",
    body: "Ask anything about what's on screen, what a signal means, or what to do next. The copilot reads the app data and answers in plain English without controlling the app.",
    bullets: [
      "Try: “What is this app telling me right now?”",
      "Try: “Explain the ladder for SMH in plain English.”",
      "Try: “Why is SOXX weaker than SMH?”",
    ],
    topic:
      "The LADDRX AI Copilot page: a full-screen conversational assistant with awareness of the live scanner, visible screen text, positions, settings, validation history, and track record. It answers from app data in plain English and does not control the app.",
    quickTopics: [
      { label: "What can it actually read?", topic: "The LADDRX AI Copilot can read the live scanner, saved scan snapshot, visible screen text, positions, settings, track record, validation history, and registered feature catalog, then answer in plain English without taking actions." },
      { label: "Which model to pick?", topic: "The chat-model picker in the Copilot header: what the difference is between Gemini Flash / Pro and GPT-5 tiers, and which a beginner should choose (speed vs quality tradeoff)." },
      { label: "How it sees my data", topic: "What data the Copilot has access to (live scanner snapshot, saved positions, local settings, track record and validation history from this browser only) and what it does NOT see." },
    ],
  },
  {
    match: (p) => p === "/simulation/validation",
    title: "You're in AI Validation & Optimization",
    body: "This is the quality-control lab for the scanner. It replays past markets under strict no-look-ahead rules, scores accuracy and calibration, and only promotes a new scanner config if it beats the current champion.",
    bullets: [
      "Nothing here touches live data or your saved settings.",
      "“Champion” = the config currently powering the live scanner. “Challenger” = a candidate being tested.",
      "A promotion only happens if the challenger passes the regression gate on every scenario.",
    ],
    topic:
      "The AI Validation & Optimization page inside the sandbox: runs multi-scenario historical replay of the pattern scanner, computes accuracy / calibration / stability metrics per scenario, generates challenger configs, and gates promotions with a regression check. Explain champion vs challenger, the metrics shown, promotion history, and why this exists.",
    quickTopics: [
      { label: "Champion vs Challenger", topic: "Champion vs Challenger in the LADDRX validation lab: what each is, how the challenger is generated, and what 'promoted' vs 'rejected' verdicts mean." },
      { label: "What's the regression gate?", topic: "The regression gate used before promoting a new scanner config: which per-scenario metrics must not degrade, and why the gate exists." },
      { label: "Accuracy vs Calibration", topic: "Accuracy vs Calibration in signal validation: what each measures, why a high-accuracy but poorly-calibrated model can still be dangerous, and how to read the charts on this page." },
    ],
  },
  {
    match: (p) => p.startsWith("/simulation"),
    title: "You're in the Simulation Sandbox",
    body: "A safe playground for replaying history and stress-testing the scanner. Nothing here touches your live data or settings.",
    bullets: [
      "Historical replay walks the scanner through past markets one day at a time.",
      "Sensitivity sweeps change one input at a time so you can see what actually moves the outcome.",
      "Perfect for building confidence before you trust a signal live.",
    ],
    topic:
      "The LADDRX Simulation & Testing Sandbox: an isolated environment for exercising the scanner against synthetic scenarios, historical replay, and sensitivity sweeps. Explain each panel, what the inputs control, what the outputs mean, and how a beginner should interpret the diagnostics.",
    quickTopics: [
      { label: "Historical replay", topic: "Historical Replay in the LADDRX sandbox: what it does, how walk-forward works, which symbols and scenarios it uses, and how to read the per-step results." },
      { label: "Sensitivity sweep", topic: "Sensitivity Panel in the sandbox: what a one-at-a-time parameter sweep is, what the outputs mean, and how a beginner should use it to build intuition." },
      { label: "Synthetic scenarios", topic: "Synthetic scenarios in the sandbox: how they're generated, why they exist alongside real historical data, and what a beginner learns from them." },
      { label: "How to read diagnostics", topic: "The Diagnostics block in the sandbox output: each field, what a healthy vs unhealthy value looks like, and what to do about it." },
    ],
  },
];

export function SimpleModeIntro() {
  const { simple } = useSimpleMode();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [walkOpen, setWalkOpen] = useState(false);
  const [walkText, setWalkText] = useState("");
  const [walkLoading, setWalkLoading] = useState(false);
  const [walkErr, setWalkErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const blurb = BLURBS.find((b) => b.match(pathname)) ?? BLURBS[0];

  const fetchWalkthrough = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setWalkLoading(true);
    setWalkErr(null);
    setWalkText("");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: blurb.topic,
          route: pathname,
          depth: "detailed",
          context:
            "Write a beginner walkthrough of this page. Cover: (1) what the page is for, (2) each major section and what it shows, (3) how to read the key numbers, (4) common controls / buttons and what they do, (5) recommended first steps for a brand new user. Use short markdown sections with bold headers.",
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setWalkText(acc);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setWalkErr((e as Error).message || "Failed to load walkthrough");
    } finally {
      setWalkLoading(false);
    }
  }, [blurb.topic, pathname]);

  // Reset the walkthrough when the route changes.
  useEffect(() => {
    setWalkOpen(false);
    setWalkText("");
    setWalkErr(null);
    abortRef.current?.abort();
  }, [pathname]);

  if (!simple) return null;

  return (
    <div className="mx-3 mt-3 rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/10 via-slate-950/60 to-fuchsia-500/10 p-4 shadow-[0_10px_40px_-15px_rgba(34,211,238,0.35)] sm:mx-4 sm:mt-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-300/30 bg-slate-950 text-cyan-200">
          <BookOpen className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-200">
              <Sparkles className="h-3 w-3" /> Simple Mode
            </span>
            <h2 className="text-sm font-semibold text-slate-50">{blurb.title}</h2>
            <SimpleExplain
              topic={blurb.topic}
              route={pathname}
              label={blurb.title}
              className="ml-auto"
            />
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">{blurb.body}</p>
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-slate-400">
            {blurb.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-300/70" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {/* Quick-explain chips — one-tap AI answers for common questions on this page. */}
          {blurb.quickTopics.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {blurb.quickTopics.map((q) => (
                <SimpleExplainChip key={q.label} label={q.label} topic={q.topic} route={pathname} />
              ))}
            </div>
          ) : null}

          {/* Full AI walkthrough — expandable, streamed on demand. */}
          <div className="mt-3 rounded-xl border border-cyan-400/20 bg-slate-950/50">
            <button
              type="button"
              onClick={() => {
                const next = !walkOpen;
                setWalkOpen(next);
                if (next && !walkText && !walkLoading) void fetchWalkthrough();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold text-cyan-100 transition hover:bg-cyan-400/5"
            >
              <Wand2 className="h-3.5 w-3.5 text-cyan-300" />
              <span>Give me the full walkthrough of this page</span>
              <ChevronDown
                className={cn(
                  "ml-auto h-3.5 w-3.5 text-cyan-300 transition",
                  walkOpen ? "rotate-180" : "",
                )}
              />
            </button>
            {walkOpen ? (
              <div className="border-t border-cyan-400/15 px-3 py-2.5">
                {walkLoading && !walkText ? (
                  <div className="flex items-center gap-2 py-2 text-[12px] text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating walkthrough…
                  </div>
                ) : null}
                {walkErr ? (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200">
                    {walkErr}
                    <button
                      type="button"
                      onClick={() => void fetchWalkthrough()}
                      className="mt-1 block w-full rounded border border-red-400/30 px-2 py-1 text-[11px] text-red-100 hover:bg-red-500/20"
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                {walkText ? (
                  <div className="prose prose-invert prose-sm max-w-none text-[12.5px] leading-relaxed [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:mt-2.5 [&_h3]:text-[13px] [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5 [&_strong]:text-cyan-100">
                    <ReactMarkdown>{walkText}</ReactMarkdown>
                  </div>
                ) : null}
                <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Tip: tap the “Explain anything” pill in the bottom-left corner, then tap any
                  button, number, chart, or icon on the screen — the AI will break it down in
                  plain English.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleExplainChip({
  label,
  topic,
  route,
}: {
  label: string;
  topic: string;
  route: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchIt = useCallback(async () => {
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
        body: JSON.stringify({ topic, route, depth: "brief" }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setText(acc);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr((e as Error).message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [topic, route]);

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !text && !loading) void fetchIt();
        }}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-100",
          open ? "border-cyan-400/40 text-cyan-100" : "",
        )}
      >
        <Sparkles className="h-2.5 w-2.5" />
        {label}
      </button>
      {open ? (
        <div className="mt-1.5 rounded-lg border border-cyan-400/15 bg-slate-950/70 p-2.5 text-[12px] leading-relaxed text-slate-200">
          {loading && !text ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
            </div>
          ) : null}
          {err ? <div className="text-red-300">{err}</div> : null}
          {text ? (
            <div className="prose prose-invert prose-sm max-w-none text-[12px] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_strong]:text-cyan-100">
              <ReactMarkdown>{text}</ReactMarkdown>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
