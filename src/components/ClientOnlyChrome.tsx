import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { useSimpleMode } from "@/lib/simple-mode";
import { useRouterState } from "@tanstack/react-router";

// ── Lazy modules ────────────────────────────────────────────────────────
// These are only imported the first time their component is actually
// rendered. That keeps `ai`, `@ai-sdk/react`, `streamdown`, `shiki`,
// `mermaid`, `react-markdown`, and the SimpleInspector's ~900 lines out
// of the initial bundle for users who never open them.

const LazyAiBubble = lazy(() =>
  import("@/components/AiBubble").then((module) => ({ default: module.AiBubble })),
);

const LazyTopMenu = lazy(() =>
  import("@/components/TopMenu").then((module) => ({ default: module.TopMenu })),
);

const LazyToaster = lazy(() =>
  import("@/components/ui/sonner").then((module) => ({ default: module.Toaster })),
);

const LazySimpleModeIntro = lazy(() =>
  import("@/components/SimpleModeIntro").then((module) => ({ default: module.SimpleModeIntro })),
);

const LazySimpleInspector = lazy(() =>
  import("@/components/SimpleInspector").then((module) => ({ default: module.SimpleInspector })),
);

function useMounted() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}

// Warm a lazy chunk when the browser is idle so the first user click still
// feels instant, without blocking initial paint.
function useIdlePreload(load: () => Promise<unknown>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const kick = () => {
      if (cancelled) return;
      void load().catch(() => {});
    };
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(kick, { timeout: 4000 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(kick, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, load]);
}

class ClientChromeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Client-only chrome failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

// ── AI bubble: tiny trigger, real module loaded on demand ───────────────
export function ClientOnlyAiBubble({ variant }: { variant?: "bubble" | "page" }) {
  const mounted = useMounted();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [activated, setActivated] = useState(variant === "page");

  // On the dedicated /ai page we obviously need the module immediately;
  // elsewhere we warm it in the background so the first click is instant.
  useIdlePreload(
    () => import("@/components/AiBubble"),
    mounted && variant !== "page" && pathname !== "/ai",
  );

  if (!mounted) return null;
  // The bubble hides itself on /ai; skip the stub too to avoid a flicker.
  if (variant !== "page" && pathname === "/ai") return null;

  if (!activated) {
    return (
      <button
        type="button"
        aria-label="Open AI Copilot"
        onClick={() => setActivated(true)}
        onMouseEnter={() => void import("@/components/AiBubble").catch(() => {})}
        onTouchStart={() => void import("@/components/AiBubble").catch(() => {})}
        className="fixed bottom-4 right-4 z-50 grid h-12 w-12 place-items-center rounded-full border border-cyan-400/50 bg-slate-950/90 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.35)] backdrop-blur transition hover:scale-105 hover:bg-slate-900 active:scale-95"
      >
        <MessageCircle className="h-5 w-5" />
      </button>
    );
  }

  return (
    <ClientChromeBoundary>
      <Suspense fallback={null}>
        <LazyAiBubble variant={variant} />
      </Suspense>
    </ClientChromeBoundary>
  );
}

export function ClientOnlyTopMenu() {
  const mounted = useMounted();
  if (!mounted) return null;

  return (
    <ClientChromeBoundary>
      <Suspense fallback={null}>
        <LazyTopMenu />
      </Suspense>
    </ClientChromeBoundary>
  );
}

export function ClientOnlyToaster() {
  const mounted = useMounted();
  if (!mounted) return null;

  return (
    <ClientChromeBoundary>
      <Suspense fallback={null}>
        <LazyToaster theme="dark" richColors position="top-right" />
      </Suspense>
    </ClientChromeBoundary>
  );
}

// ── SimpleModeIntro / SimpleInspector: only mount when Simple Mode is on ──
// Both are inert for users who never enable Simple Mode. Deferring their
// mount avoids pulling `react-markdown` and their 300–900-line bodies into
// the initial bundle.

export function ClientOnlySimpleModeIntro() {
  const mounted = useMounted();
  const { simple } = useSimpleMode();
  if (!mounted || !simple) return null;

  return (
    <ClientChromeBoundary>
      <Suspense fallback={null}>
        <LazySimpleModeIntro />
      </Suspense>
    </ClientChromeBoundary>
  );
}

export function ClientOnlySimpleInspector() {
  const mounted = useMounted();
  const { simple } = useSimpleMode();
  if (!mounted || !simple) return null;

  return (
    <ClientChromeBoundary>
      <Suspense fallback={null}>
        <LazySimpleInspector />
      </Suspense>
    </ClientChromeBoundary>
  );
}
