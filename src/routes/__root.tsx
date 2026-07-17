import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import {
  ClientOnlyAiBubble,
  ClientOnlyToaster,
  ClientOnlyTopMenu,
  ClientOnlySimpleModeIntro,
  ClientOnlySimpleInspector,
} from "@/components/ClientOnlyChrome";
import { SimpleModeProvider } from "@/lib/simple-mode";
import { LiquidGlassProvider, useLiquidGlass } from "@/lib/liquid-glass";
import { CrystalNav } from "@/crystal/CrystalNav";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Laddrx · AI-Powered Ladder Scanner" },
      { name: "description", content: "Remix of LADDRX is a financial data application that displays stock market information." },
      { name: "author", content: "Laddrx" },
      { property: "og:title", content: "Laddrx · AI-Powered Ladder Scanner" },
      { property: "og:description", content: "Remix of LADDRX is a financial data application that displays stock market information." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Laddrx · AI-Powered Ladder Scanner" },
      { name: "twitter:description", content: "Remix of LADDRX is a financial data application that displays stock market information." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d941ba7a-a0d4-4c22-9e5b-321cfd20fb9f/id-preview-789656ad--cc454651-9d9f-4969-a3f4-6d684a586be1.lovable.app-1783906850571.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d941ba7a-a0d4-4c22-9e5b-321cfd20fb9f/id-preview-789656ad--cc454651-9d9f-4969-a3f4-6d684a586be1.lovable.app-1783906850571.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      // Warm DNS + TLS for the hosts the app hits first on cold load.
      // Uses the real Supabase URL from env (previous hardcoded host was
      // a stale project and burned a TCP handshake on every visit).
      { rel: "preconnect", href: import.meta.env.VITE_SUPABASE_URL as string, crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://query1.finance.yahoo.com", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://query2.finance.yahoo.com", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "https://stooq.com" },
      { rel: "dns-prefetch", href: "https://api.twelvedata.com" },
      { rel: "dns-prefetch", href: "https://finnhub.io" },
    ],

  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Chromium speculation rules: prerender in-app links on hover/tap so
  // the next click paints instantly. Scoped to internal /_authenticated
  // pages so we never prerender external destinations.
  const speculationRules = JSON.stringify({
    prerender: [
      {
        where: {
          and: [
            { href_matches: "/*" },
            { not: { href_matches: "/auth*" } },
            { not: { selector_matches: "[data-no-prerender]" } },
          ],
        },
        eagerness: "moderate",
      },
    ],
  });
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <HeadContent />
        <script
          type="speculationrules"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: speculationRules }}
        />
      </head>
      <body className="bg-slate-950 text-slate-100 antialiased" suppressHydrationWarning>
        {children}
        <ClientOnlyToaster />
        <Scripts />
      </body>
    </html>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onAuthPage = pathname === "/auth";

  useEffect(() => {
    let cancelled = false;
    import("@/lib/app-bridge").then(({ registerNavigator }) => {
      if (cancelled) return;
      registerNavigator((path: string) => {
        router.navigate({ to: path });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Keep the router's auth-context (and any cached protected queries) fresh
  // when the user signs in, signs out, or their user record updates.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  // ── Idle preload ────────────────────────────────────────────────────
  // Once the current route has painted, warm the other authenticated
  // route chunks + the heavy terminal panels during browser idle time.
  // First navigation / first panel-scroll becomes a cache hit instead
  // of a network round-trip.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      const jobs: Array<() => Promise<unknown>> = [
        () => import("@/components/lazy-panels").then((m) => m.preloadTerminalPanels()),
        () => import("@/routes/_authenticated/future-leaders"),
        () => import("@/routes/_authenticated/momentum-rockets"),
        () => import("@/routes/_authenticated/simulation"),
        () => import("@/routes/_authenticated/analog-validation"),
        () => import("@/routes/_authenticated/ai"),
        () => import("@/components/IntradayAnalogChart"),
      ];
      for (const job of jobs) void job().catch(() => {});
    };
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(warm, { timeout: 4000 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(warm, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LiquidGlassProvider>
        <SimpleModeProvider>
          {onAuthPage ? null : <ClientOnlySimpleModeIntro />}
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <div key={pathname} className="route-fade-in">
            <Outlet />
          </div>
          {onAuthPage ? null : <ChromeSwitcher />}
        </SimpleModeProvider>
      </LiquidGlassProvider>
    </QueryClientProvider>
  );
}

function ChromeSwitcher() {
  const { enabled } = useLiquidGlass();
  if (enabled) {
    return (
      <>
        <CrystalNav />
        <ClientOnlyAiBubble />
      </>
    );
  }
  return (
    <>
      <ClientOnlyTopMenu />
      <ClientOnlyAiBubble />
      <ClientOnlySimpleInspector />
    </>
  );
}
