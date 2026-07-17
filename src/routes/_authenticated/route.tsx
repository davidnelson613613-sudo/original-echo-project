import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { TerminalSkeleton } from "@/components/TerminalSkeleton";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Use getSession() (synchronous localStorage read) instead of getUser()
  // (network round-trip). This removes the pre-paint network wait on cold
  // load — the skeleton (and then the app) renders immediately when the
  // user already has a session. Token refresh happens in the background
  // via supabase-js's built-in auto-refresh + onAuthStateChange in __root.
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth" });
    }
    // Fire-and-forget: kick off the primary scan fetch the instant we know
    // the user is signed in. This runs in parallel with the terminal
    // component's chunk download, so by the time React renders the query
    // is usually already resolved in the cache. Never awaited — a slow
    // scan must not delay first paint.
    void (async () => {
      try {
        const { scanUniverse } = await import("@/lib/market.functions");
        await context.queryClient.prefetchQuery({
          queryKey: ["scan"],
          queryFn: () => scanUniverse(),
          staleTime: 30_000,
        });
      } catch {
        /* ignore — the component's own useQuery will retry */
      }
    })();
    return { user: data.session.user };
  },
  pendingComponent: TerminalSkeleton,
  component: () => <Outlet />,
});
