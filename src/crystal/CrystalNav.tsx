// Crystal — floating bottom-center navigation dock.
//
// Six route orbs plus a "more" orb. Hover reveals a floating micro-label
// above the orb as a small crystal pill. Drawer opens for account +
// theme actions. Replaces GlassNav entirely; no visual DNA reused.

import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Home,
  Sparkles,
  Rocket,
  Beaker,
  ShieldCheck,
  MessageCircle,
  MoreHorizontal,
  LogOut,
  RefreshCw,
  X,
  Droplet,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { CrystalSlab, CrystalOrb, CrystalPill, MicroLabel } from "./primitives";
import { useLiquidGlass } from "@/lib/liquid-glass";
import { getActions } from "@/lib/app-bridge";
import { supabase } from "@/integrations/supabase/client";

type Item = { to: string; label: string; icon: React.ReactNode };

const ITEMS: Item[] = [
  { to: "/", label: "Terminal", icon: <Home className="h-4 w-4" /> },
  { to: "/future-leaders", label: "Future Leaders", icon: <Sparkles className="h-4 w-4" /> },
  { to: "/momentum-rockets", label: "Momentum", icon: <Rocket className="h-4 w-4" /> },
  { to: "/ai", label: "Copilot", icon: <MessageCircle className="h-4 w-4" /> },
  { to: "/simulation", label: "Simulation", icon: <Beaker className="h-4 w-4" /> },
  { to: "/analog-validation", label: "Validation", icon: <ShieldCheck className="h-4 w-4" /> },
];

export function CrystalNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setEnabled } = useLiquidGlass();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const rescan = async () => {
    const actions = getActions();
    if (!actions) return toast.error("App not ready");
    const r = await actions.rescan();
    if (r.ok) toast.success("Rescan complete");
    else toast.error(r.message ?? "Rescan failed");
  };

  const signOut = async () => {
    setDrawerOpen(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <>
      <nav
        aria-label="Crystal navigation"
        className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3 sm:bottom-6"
      >
        <div
          className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/12 px-2 py-2 sm:gap-2 sm:px-3 cr-rise"
          style={{
            background: "rgba(232,246,255,0.09)",
            backdropFilter: "blur(24px) saturate(160%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.28), 0 20px 60px -20px rgba(3,22,40,0.7)",
          }}
        >
          {ITEMS.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <NavOrb key={item.to} item={item} active={active} />
            );
          })}
          <span className="mx-1 hidden h-6 w-px bg-white/12 sm:block" />
          <CrystalOrb
            label="More"
            size={40}
            onClick={() => setDrawerOpen(true)}
          >
            <MoreHorizontal className="h-4 w-4" />
          </CrystalOrb>
        </div>
      </nav>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-md p-3 sm:items-center"
          onClick={() => setDrawerOpen(false)}
        >
          <CrystalSlab
            rise
            className="w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <MicroLabel>Crystal · Account</MicroLabel>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full border border-white/12 text-white/60 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <div className="cr-num text-sm font-semibold text-white">
                {email ?? "Signed out"}
              </div>
              <MicroLabel>{email ? "Signed in" : "Not signed in"}</MicroLabel>
            </div>

            <div className="grid gap-2">
              <CrystalPill
                className="justify-start w-full"
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={() => { setDrawerOpen(false); void rescan(); }}
              >
                Rescan market
              </CrystalPill>
              <CrystalPill
                className="justify-start w-full"
                icon={<Droplet className="h-4 w-4" />}
                onClick={() => {
                  setEnabled(false);
                  setDrawerOpen(false);
                  toast.success("Classic UI restored");
                }}
              >
                Exit Crystal Mode
              </CrystalPill>
              {email && (
                <CrystalPill
                  className="justify-start w-full"
                  icon={<LogOut className="h-4 w-4" />}
                  onClick={signOut}
                >
                  Sign out
                </CrystalPill>
              )}
            </div>
          </CrystalSlab>
        </div>
      )}
    </>
  );
}

function NavOrb({ item, active }: { item: Item; active: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && (
        <span
          className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/12 bg-white/[0.09] px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-white/85"
          style={{ backdropFilter: "blur(12px)" }}
        >
          {item.label}
        </span>
      )}
      <Link
        to={item.to}
        aria-label={item.label}
        title={item.label}
        className="cr-orb"
        style={{ ["--sz" as unknown as string]: "40px" }}
        data-active={active ? "true" : "false"}
      >
        {item.icon}
      </Link>
    </div>
  );
}
