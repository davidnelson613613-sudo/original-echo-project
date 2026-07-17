import { useRouterState } from "@tanstack/react-router";
import { Loader2, Circle as CircleIcon, Mic, MicOff, MousePointerClick, Send, Sparkles, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useSimpleMode } from "@/lib/simple-mode";
import { cn } from "@/lib/utils";
import { getDeepContext, getSnapshot, listCapabilities } from "@/lib/app-bridge";

/**
 * SimpleInspector — universal, app-aware "Explain Anything" overlay.
 *
 * Two modes when Simple Mode is ON:
 *   • Tap    — tap a single element to explain it.
 *   • Circle — draw ANY freehand shape with your finger (or mouse) around
 *              something on the screen, exactly like Google's Circle to
 *              Search. We capture the polygon, find every meaningful
 *              element whose center falls inside the shape, and explain
 *              that group in context.
 *
 * Rich context is captured from each targeted element (visible text,
 * role, aria-label, associated headings, panel context, numeric siblings)
 * AND the live app snapshot (scanner rows, positions, settings) is sent
 * along, so the AI grounds its answer in real live data — the same
 * intelligence the AI Copilot bubble uses.
 */

const IGNORE_ATTR = "data-simple-inspector-ignore";
const SKIP_TAGS = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "SVG", "PATH"]);

type TargetInfo = {
  label: string;
  topic: string;
  context: string;
  selection?: Array<{ label: string; role?: string; text?: string }>;
};

type Pt = { x: number; y: number };

function textOf(el: Element | null, max = 220): string {
  if (!el) return "";
  const raw = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return raw.length > max ? raw.slice(0, max) + "…" : raw;
}

function ancestorContext(el: Element): { headings: string[]; panels: string[] } {
  const headings: string[] = [];
  const panels: string[] = [];
  let node: Element | null = el.parentElement;
  let hop = 0;
  while (node && hop < 8) {
    if (!SKIP_TAGS.has(node.tagName)) {
      const explain = node.getAttribute?.("data-explain");
      if (explain && !panels.includes(explain)) panels.push(explain);
      const sectionTitle = node.getAttribute?.("data-section-title");
      if (sectionTitle && !panels.includes(sectionTitle)) panels.push(sectionTitle);
      const heading = node.querySelector?.("h1,h2,h3,h4,[data-section-title]");
      if (heading && heading !== el) {
        const t = textOf(heading, 140);
        if (t && !headings.includes(t)) headings.push(t);
      }
    }
    node = node.parentElement;
    hop++;
  }
  return { headings: headings.slice(0, 5), panels: panels.slice(0, 5) };
}

function describe(el: Element): TargetInfo {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role") ?? "";
  const aria = el.getAttribute("aria-label") ?? "";
  const title = el.getAttribute("title") ?? "";
  const explain = el.getAttribute("data-explain") ?? "";
  const placeholder = (el as HTMLInputElement).placeholder ?? "";
  const name = (el as HTMLInputElement).name ?? "";
  const type = (el as HTMLInputElement).type ?? "";
  const value = (el as HTMLInputElement).value ?? "";
  const own = textOf(el, 260);

  const { headings, panels } = ancestorContext(el);

  const label =
    aria || title || own.slice(0, 80) || placeholder || name || `${tag}${type ? ` (${type})` : ""}`;

  const topic = [
    `Element: <${tag}${role ? ` role="${role}"` : ""}${type ? ` type="${type}"` : ""}>`,
    explain ? `data-explain: "${explain}"` : "",
    aria ? `aria-label: "${aria}"` : "",
    title ? `title: "${title}"` : "",
    placeholder ? `placeholder: "${placeholder}"` : "",
    name ? `name: "${name}"` : "",
    value ? `current value: "${value}"` : "",
    own ? `visible text: "${own}"` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const context = [
    panels.length ? `Panel / feature markers: ${panels.join(" > ")}` : "",
    headings.length ? `Nearby headings (nearest first):\n- ${headings.join("\n- ")}` : "",
    `The user pointed at this exact element inside the LADDRX terminal. Explain what THIS specific piece is INSIDE LADDRX (regime badge, ladder rung, Setup Quality score, Speed Mode toggle, Historical Pattern Recognition analog, bracket, positions row, simulation control, etc.) — never in generic terms.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { label, topic: topic || label, context };
}

function pickTarget(x: number, y: number): Element | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  let node: Element | null = el;
  while (node) {
    if ((node as HTMLElement).closest?.(`[${IGNORE_ATTR}]`)) return null;
    if (!SKIP_TAGS.has(node.tagName)) return node;
    node = node.parentElement;
  }
  return null;
}

/** Ray-casting point-in-polygon. Polygon assumed closed implicitly. */
function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Bounding box of the freehand polygon. */
function polyBBox(poly: Pt[]): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of poly) {
    if (p.x < left) left = p.x;
    if (p.x > right) right = p.x;
    if (p.y < top) top = p.y;
    if (p.y > bottom) bottom = p.y;
  }
  return { left, top, right, bottom };
}

/** Shoelace formula — used to reject accidental scribbles. */
function polyArea(poly: Pt[]): number {
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(s) / 2;
}

/** Collect meaningful elements whose center falls inside the freehand polygon. */
function elementsInPolygon(poly: Pt[]): Element[] {
  const bbox = polyBBox(poly);
  const out: Element[] = [];
  const seen = new Set<Element>();
  const candidates = document.querySelectorAll<HTMLElement>(
    "[data-explain],[data-section-title],button,a,[role='button'],[role='switch'],[role='tab'],input,select,textarea,label,h1,h2,h3,h4,td,th,li,dt,dd,[aria-label]",
  );
  candidates.forEach((el) => {
    if (el.closest(`[${IGNORE_ATTR}]`)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // Quick reject by bounding box.
    if (r.right < bbox.left || r.left > bbox.right || r.bottom < bbox.top || r.top > bbox.bottom)
      return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // Element center inside the drawn shape, or any of 4 corners as fallback
    // for small elements that clip past their center.
    const inside =
      pointInPolygon({ x: cx, y: cy }, poly) ||
      pointInPolygon({ x: r.left + 2, y: r.top + 2 }, poly) ||
      pointInPolygon({ x: r.right - 2, y: r.top + 2 }, poly) ||
      pointInPolygon({ x: r.left + 2, y: r.bottom - 2 }, poly) ||
      pointInPolygon({ x: r.right - 2, y: r.bottom - 2 }, poly);
    if (!inside) return;
    // De-dupe: skip ancestors of already-picked descendants and vice versa.
    for (const other of seen) {
      if (el.contains(other) || other.contains(el)) return;
    }
    seen.add(el);
    out.push(el);
  });
  return out.slice(0, 24);
}

function describeCircledRegion(poly: Pt[]): TargetInfo {
  const els = elementsInPolygon(poly);
  const bbox = polyBBox(poly);
  const cx = (bbox.left + bbox.right) / 2;
  const cy = (bbox.top + bbox.bottom) / 2;
  // Use the largest picked element (or the centroid target) as the anchor.
  const anchor =
    els.slice().sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0] ??
    document.elementFromPoint(cx, cy) ??
    document.body;
  const { headings, panels } = ancestorContext(anchor);
  const selection = els.map((el) => {
    const aria = el.getAttribute("aria-label") ?? "";
    const explain = el.getAttribute("data-explain") ?? "";
    const own = textOf(el, 160);
    return {
      label: explain || aria || own.slice(0, 60) || el.tagName.toLowerCase(),
      role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
      text: own,
    };
  });
  const label =
    panels[0] ||
    headings[0] ||
    (els.length
      ? `Circled region · ${els.length} element${els.length === 1 ? "" : "s"}`
      : "Circled region");
  const topic = els.length
    ? `The user drew a freehand circle around a region of the LADDRX screen containing ${els.length} labeled element${els.length === 1 ? "" : "s"}. Explain what this GROUP represents inside LADDRX, how the parts work together, and — if the region maps to specific tickers / rungs / positions in APP STATE — cite the live numbers.`
    : `The user drew a freehand circle around an area of the LADDRX screen, but no labeled elements were captured. Describe what visually sits at roughly (${Math.round(cx)}, ${Math.round(cy)}) inside the current view and what it likely refers to in LADDRX.`;
  const context = [
    panels.length ? `Panel / feature markers: ${panels.join(" > ")}` : "",
    headings.length ? `Nearby headings (nearest first):\n- ${headings.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { label, topic, context, selection };
}

/** Compact live-app snapshot the Explainer sends to /api/explain. Mirrors
 *  the shape the AI Copilot uses so the two share intelligence. */
function buildAppState() {
  const s = getSnapshot();
  const rows = (s.scan?.rows ?? []).slice(0, 12).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    price: r.price,
    change1d: r.change1d,
    regime: r.regime,
    regimeLabel: r.regimeLabel,
    scenarioKey: r.scenarioKey,
    status: r.status,
    score: r.score,
    rsiDaily: r.rsiDaily,
    drawdown20Pct: r.drawdown20Pct,
    drawdown60Pct: r.drawdown60Pct,
    ladder: (r.adaptiveLadder ?? []).slice(0, 5).map((l) => ({
      pct: l.pct,
      price: l.price,
      label: l.label,
      reason: l.reason,
    })),
    riskLevel: r.riskLevel,
  }));
  const positions = Object.entries(s.positions)
    .slice(0, 12)
    .map(([sym, p]) => {
      const shares = p.entries.reduce((a, e) => a + e.shares, 0);
      const capDeployed = p.entries.reduce((a, e) => a + e.shares * e.price, 0);
      return {
        symbol: sym,
        totalCapital: p.totalCapital,
        scenario: p.scenario,
        filledPct: p.entries.reduce((a, e) => a + e.pct, 0),
        capDeployed,
        shares,
        avgCost: shares > 0 ? capDeployed / shares : 0,
      };
    });
  return {
    marketOpen: s.marketOpen,
    capital: s.capital,
    fractional: s.fractional,
    settings: s.posSettings,
    speedMode: s.speedMode,
    scannedAt: s.scan?.scannedAt ?? null,
    spyChangePct: s.scan?.spyChangePct ?? null,
    scanWarning: s.scan?.warning ?? null,
    scanLoading: s.scanLoading,
    scanError: s.scanError,
    rows,
    positions,
  };
}

type Mode = "tap" | "circle";

export function SimpleInspector() {
  const { simple } = useSimpleMode();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [mode, setMode] = useState<Mode>("tap");
  const [active, setActive] = useState(false);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [strokePoints, setStrokePoints] = useState<Pt[]>([]);
  const strokeRef = useRef<Pt[]>([]);
  const drawingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [selection, setSelection] = useState<TargetInfo | null>(null);
  const [text, setText] = useState(""); // streaming answer for the current turn
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Follow-up chat state (voice + text). Reset when the user picks a new element.
  type Turn = { role: "user" | "assistant"; content: string };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [sttBusy, setSttBusy] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!simple) {
      setActive(false);
      setSelection(null);
      setHoverRect(null);
      setStrokePoints([]);
      strokeRef.current = [];
      drawingRef.current = false;
    }
  }, [simple]);

  // Hover ring for Tap mode.
  useEffect(() => {
    if (!active || mode !== "tap") {
      setHoverRect(null);
      return;
    }
    const move = (e: PointerEvent) => {
      const el = pickTarget(e.clientX, e.clientY);
      if (!el) return setHoverRect(null);
      setHoverRect(el.getBoundingClientRect());
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActive(false);
        setSelection(null);
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, mode]);

  // Click to pick (Tap mode).
  useEffect(() => {
    if (!active || mode !== "tap") return;
    const onClick = (e: MouseEvent) => {
      const target = pickTarget(e.clientX, e.clientY);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const info = describe(target);
      setSelection(info);
      setHoverRect(target.getBoundingClientRect());
      setActive(false);
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("auxclick", onClick, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("auxclick", onClick, true);
    };
  }, [active, mode]);

  // Circle mode: capture a freehand stroke on a full-screen overlay.
  const flushStroke = useCallback(() => {
    rafRef.current = null;
    setStrokePoints(strokeRef.current.slice());
  }, []);

  const onOverlayPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
      drawingRef.current = true;
      strokeRef.current = [{ x: e.clientX, y: e.clientY }];
      setStrokePoints(strokeRef.current.slice());
    },
    [],
  );

  const onOverlayPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const last = strokeRef.current[strokeRef.current.length - 1];
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      // Skip tiny sub-pixel jitter for performance & cleaner strokes.
      if (dx * dx + dy * dy < 9) return;
      strokeRef.current.push({ x: e.clientX, y: e.clientY });
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushStroke);
      }
    },
    [flushStroke],
  );

  const finishStroke = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
      e.preventDefault();
      const poly = strokeRef.current.slice();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setStrokePoints([]);
      strokeRef.current = [];

      // Tiny scribble → treat as tap at the release point.
      if (poly.length < 6 || polyArea(poly) < 900) {
        const overlay = e.currentTarget as HTMLDivElement;
        const prev = overlay.style.pointerEvents;
        overlay.style.pointerEvents = "none";
        const target = pickTarget(e.clientX, e.clientY);
        overlay.style.pointerEvents = prev;
        if (target) setSelection(describe(target));
        setActive(false);
        return;
      }

      setSelection(describeCircledRegion(poly));
      setActive(false);
    },
    [],
  );

  useEffect(() => {
    if (!active || mode !== "circle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        drawingRef.current = false;
        strokeRef.current = [];
        setStrokePoints([]);
        setActive(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, mode]);

  const fetchExplain = useCallback(
    async (info: TargetInfo, opts?: { question?: string; history?: Turn[] }) => {
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
          body: JSON.stringify({
            topic: info.topic,
            context: info.context,
            route: pathname,
            depth: "detailed",
            selection: info.selection,
            question: opts?.question,
            history: opts?.history,
            appState: buildAppState(),
            deepState: getDeepContext(),
            capabilities: listCapabilities(),
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body)
          throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setText(acc);
        }
        if (acc.trim()) {
          setTurns((prev) => [...prev, { role: "assistant", content: acc }]);
          setText("");
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setErr((e as Error).message || "Failed to load explanation");
      } finally {
        setLoading(false);
      }
    },
    [pathname],
  );

  // First-run explanation when the user picks a new element.
  useEffect(() => {
    if (!selection) return;
    setTurns([]);
    setDraft("");
    void fetchExplain(selection);
    return () => abortRef.current?.abort();
  }, [selection, fetchExplain]);

  const askFollowUp = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || !selection || loading) return;
      const nextTurns: Turn[] = [...turns, { role: "user", content: question }];
      setTurns(nextTurns);
      setDraft("");
      await fetchExplain(selection, { question, history: nextTurns.slice(0, -1) });
    },
    [selection, turns, loading, fetchExplain],
  );

  // Voice capture: single MediaRecorder segment → upload → transcribe → fill draft.
  const startRecording = useCallback(async () => {
    if (recording || sttBusy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const tracks = streamRef.current?.getTracks() ?? [];
        tracks.forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size < 2048) {
          setErr("That recording was too short — try again.");
          return;
        }
        setSttBusy(true);
        try {
          const fd = new FormData();
          fd.append("file", blob, `voice.${(rec.mimeType || "").includes("mp4") ? "mp4" : "webm"}`);
          const res = await fetch("/api/explain-stt", { method: "POST", body: fd });
          if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
          const { text: transcript } = (await res.json()) as { text?: string };
          const t = (transcript ?? "").trim();
          if (!t) {
            setErr("Didn't catch that — please try again.");
            return;
          }
          void askFollowUp(t);
        } catch (e) {
          setErr((e as Error).message || "Voice transcription failed");
        } finally {
          setSttBusy(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setErr("Microphone access was blocked.");
    }
  }, [recording, sttBusy, askFollowUp]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!selection || !simple) {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setRecording(false);
    }
  }, [selection, simple]);

  if (!simple) return null;

  // Build the SVG path string once per render — used both while drawing
  // (open polyline) and immediately after (auto-closed polygon).
  const pathD =
    strokePoints.length > 1
      ? "M " + strokePoints.map((p) => `${p.x} ${p.y}`).join(" L ")
      : "";

  return (
    <>
      {/* Hover ring (Tap mode) */}
      {hoverRect ? (
        <div
          {...{ [IGNORE_ATTR]: "" }}
          className="pointer-events-none fixed z-[9998] rounded-md border-2 border-cyan-300/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)] transition-[all] duration-75"
          style={{
            top: hoverRect.top - 4,
            left: hoverRect.left - 4,
            width: hoverRect.width + 8,
            height: hoverRect.height + 8,
          }}
        />
      ) : null}

      {/* Full-screen capture overlay while in Circle mode. Sits above the
          app so drag events on any surface (scroll containers, buttons,
          canvases) reliably reach us. touch-action:none stops the mobile
          browser from turning the drag into a scroll. */}
      {active && mode === "circle" ? (
        <div
          {...{ [IGNORE_ATTR]: "" }}
          onPointerDown={onOverlayPointerDown}
          onPointerMove={onOverlayPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="fixed inset-0 z-[9998] cursor-crosshair bg-slate-950/25"
          style={{ touchAction: "none" }}
        >
          {/* Freehand ink trail rendered in SVG. */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            width="100%"
            height="100%"
          >
            <defs>
              <linearGradient id="lx-ink" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#67e8f9" />
                <stop offset="100%" stopColor="#f0abfc" />
              </linearGradient>
            </defs>
            {pathD ? (
              <>
                {/* Filled polygon (soft) while drawing to give the "circle to search" glow. */}
                <path
                  d={`${pathD} Z`}
                  fill="rgba(103,232,249,0.10)"
                  stroke="none"
                />
                <path
                  d={pathD}
                  fill="none"
                  stroke="url(#lx-ink)"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    filter: "drop-shadow(0 0 6px rgba(103,232,249,0.55))",
                  }}
                />
              </>
            ) : null}
          </svg>
        </div>
      ) : null}

      {/* Toolbar pill (bottom-left) */}
      <div
        {...{ [IGNORE_ATTR]: "" }}
        className="fixed bottom-4 left-4 z-[9997] flex items-center gap-1 rounded-full border border-cyan-400/40 bg-slate-950/85 p-1 shadow-lg backdrop-blur"
      >
        <button
          type="button"
          onClick={() => {
            setMode("tap");
            setActive((a) => (mode === "tap" ? !a : true));
            setSelection(null);
          }}
          aria-label="Tap to explain"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] transition",
            active && mode === "tap"
              ? "bg-cyan-500/25 text-cyan-100"
              : "text-cyan-200/80 hover:bg-cyan-500/10",
          )}
        >
          <MousePointerClick className="h-3.5 w-3.5" />
          <span>Tap</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("circle");
            setActive((a) => (mode === "circle" ? !a : true));
            setSelection(null);
          }}
          aria-label="Draw a circle to explain"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] transition",
            active && mode === "circle"
              ? "bg-fuchsia-500/25 text-fuchsia-100"
              : "text-fuchsia-200/80 hover:bg-fuchsia-500/10",
          )}
        >
          <CircleIcon className="h-3.5 w-3.5" />
          <span>Circle</span>
        </button>
        {active ? (
          <button
            type="button"
            onClick={() => {
              setActive(false);
              setStrokePoints([]);
              strokeRef.current = [];
            }}
            aria-label="Cancel"
            className="ml-1 inline-flex items-center rounded-full p-1.5 text-slate-300 hover:bg-slate-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {active ? (
        <div
          {...{ [IGNORE_ATTR]: "" }}
          className="fixed bottom-16 left-4 z-[9997] rounded-md border border-cyan-400/30 bg-slate-950/90 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-100 shadow"
        >
          {mode === "tap"
            ? "Tap anything on screen · Esc to cancel"
            : "Draw a circle around anything · Esc to cancel"}
        </div>
      ) : null}

      {/* Streaming explanation panel */}
      {selection ? (
        <div
          {...{ [IGNORE_ATTR]: "" }}
          className="fixed bottom-20 left-4 z-[9999] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-cyan-400/30 bg-slate-950/95 p-3 text-slate-100 shadow-[0_20px_60px_-20px_rgba(34,211,238,0.5)] backdrop-blur"
        >
          <div className="mb-2 flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">
                Simple Mode · Explaining
              </div>
              <div className="truncate text-[12px] font-semibold text-slate-100">
                {selection.label}
              </div>
              {selection.selection && selection.selection.length > 1 ? (
                <div className="mt-0.5 text-[10px] text-slate-400">
                  {selection.selection.length} elements in the circled area
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setSelection(null);
                setText("");
                setErr(null);
                abortRef.current?.abort();
              }}
              aria-label="Close explanation"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {loading && !text ? (
            <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking about this LADDRX feature…
            </div>
          ) : null}
          {err ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200">
              {err}
              <button
                type="button"
                onClick={() => selection && void fetchExplain(selection)}
                className="mt-1 block w-full rounded border border-red-400/30 px-2 py-1 text-[11px] text-red-100 hover:bg-red-500/20"
              >
                Retry
              </button>
            </div>
          ) : null}
          {turns.length || text ? (
            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {turns.map((t, i) =>
                t.role === "user" ? (
                  <div
                    key={i}
                    className="ml-6 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[12px] text-cyan-50"
                  >
                    {t.content}
                  </div>
                ) : (
                  <div
                    key={i}
                    className="prose prose-invert prose-sm max-w-none text-[12.5px] leading-relaxed [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:mt-2.5 [&_h3]:text-[13px] [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5 [&_strong]:text-cyan-100"
                  >
                    <ReactMarkdown>{t.content}</ReactMarkdown>
                  </div>
                ),
              )}
              {text ? (
                <div className="prose prose-invert prose-sm max-w-none text-[12.5px] leading-relaxed [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:mt-2.5 [&_h3]:text-[13px] [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5 [&_strong]:text-cyan-100">
                  <ReactMarkdown>{text}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Follow-up composer: type or hold-to-talk. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void askFollowUp(draft);
            }}
            className="mt-2 flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-slate-900/80 px-1.5 py-1"
          >
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={sttBusy || loading}
              aria-label={recording ? "Stop recording" : "Ask by voice"}
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition",
                recording
                  ? "bg-red-500/25 text-red-100 ring-2 ring-red-400/60 animate-pulse"
                  : "bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40",
              )}
            >
              {sttBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : recording ? (
                <MicOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={loading || sttBusy || recording}
              placeholder={
                recording
                  ? "Listening…"
                  : sttBusy
                    ? "Transcribing…"
                    : "Ask a follow-up about this…"
              }
              className="min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || sttBusy || recording || !draft.trim()}
              aria-label="Send question"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/25 text-cyan-100 hover:bg-cyan-500/40 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>

          <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500">
            <span>AI · live app context · voice</span>
            <button
              type="button"
              onClick={() => {
                setSelection(null);
                setText("");
                setTurns([]);
                setDraft("");
                setErr(null);
                setActive(true);
              }}
              className="rounded border border-cyan-400/30 px-1.5 py-0.5 text-cyan-200 hover:bg-cyan-500/10"
            >
              Pick another
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
