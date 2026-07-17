import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Menu,
  Sparkles,
  Home,
  RefreshCw,
  Wallet,
  Info,
  X,
  ChevronRight,
  Beaker,
  BookOpen,
  LogOut,
  Radio,
  Rocket,
  User as UserIcon,
  ShieldCheck,
  Droplets,
  ShieldAlert,
} from "lucide-react";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { getActions } from "@/lib/app-bridge";
import { useSimpleMode } from "@/lib/simple-mode";
import { useLiquidGlass } from "@/lib/liquid-glass";
import { supabase } from "@/integrations/supabase/client";

export function TopMenu() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onAiPage = pathname === "/ai";
  const [open, setOpen] = useState(false);
  const { simple, setSimple } = useSimpleMode();
  const { enabled: glass, setEnabled: setGlass } = useLiquidGlass();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState<string | null>(null);

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
    if (!actions) return toast.error("App not ready yet");
    setOpen(false);
    const r = await actions.rescan();
    if (r.ok) toast.success("Rescan complete");
    else toast.error(r.message ?? "Rescan failed");
  };

  const signOut = async () => {
    setOpen(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const NavRow = ({
    to,
    icon,
    label,
    badge,
    highlight,
  }: {
    to: string;
    icon: React.ReactNode;
    label: string;
    badge?: { text: string; tone: "emerald" | "amber" };
    highlight?: boolean;
  }) => (
    <SheetClose asChild>
      <Link
        to={to}
        className={`group flex items-center gap-3 rounded-xl border px-3 py-3 transition ${
          highlight
            ? "border-cyan-400/25 bg-gradient-to-r from-cyan-400/10 via-slate-900/40 to-fuchsia-500/10 hover:border-cyan-400/50"
            : "border-slate-800/70 bg-slate-900/40 hover:border-cyan-400/40 hover:bg-slate-900/70"
        }`}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-950 text-slate-300 group-hover:text-cyan-200">
          {icon}
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-100">{label}</span>
        {badge ? (
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
              badge.tone === "emerald"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-amber-400/30 bg-amber-400/10 text-amber-300"
            }`}
          >
            {badge.text}
          </span>
        ) : null}
        <ChevronRight className="h-4 w-4 text-slate-600 transition group-hover:text-cyan-300" />
      </Link>
    </SheetClose>
  );

  const ActionRow = ({
    onClick,
    icon,
    label,
    desc,
  }: {
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    desc?: string;
  }) => (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-slate-800/70 bg-slate-900/40 px-3 py-3 text-left transition hover:border-cyan-400/40 hover:bg-slate-900/70"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-950 text-slate-300 group-hover:text-cyan-200">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-100">{label}</span>
        {desc ? <span className="mt-0.5 block truncate text-[11px] text-slate-500">{desc}</span> : null}
      </span>
    </button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="fixed left-3 top-3 z-40 sm:left-4 sm:top-4">
        <SheetTrigger asChild>
          <button
            aria-label="Open menu"
            className="group grid h-11 w-11 place-items-center rounded-xl border border-slate-800/80 bg-slate-950/85 text-slate-200 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur transition hover:border-cyan-400/40 hover:text-cyan-100"
          >
            <Menu className="h-5 w-5" />
          </button>
        </SheetTrigger>
      </div>

      <SheetContent
        side="left"
        className="w-[86vw] max-w-[340px] border-r border-slate-800 bg-slate-950/95 p-0 text-slate-100 backdrop-blur-xl [&>button]:hidden"
      >
        <div className="relative flex h-full flex-col overflow-hidden">
          <div className="pointer-events-none absolute -left-24 -top-24 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 top-40 h-56 w-56 rounded-full bg-fuchsia-500/10 blur-3xl" />

          <SheetHeader className="relative flex-row items-center justify-between gap-2 border-b border-slate-800/70 px-4 py-4">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <span className="absolute inset-0 rounded-lg bg-gradient-to-br from-cyan-400/50 to-fuchsia-500/40 blur-md" />
                <span className="relative grid h-9 w-9 place-items-center rounded-lg border border-cyan-300/30 bg-slate-950">
                  <Sparkles className="h-4 w-4 text-cyan-200" />
                </span>
              </div>
              <div>
                <SheetTitle className="text-left text-sm font-black tracking-tight text-slate-50">
                  Laddrx
                </SheetTitle>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
                  Menu · Settings
                </div>
              </div>
            </div>
            <SheetClose asChild>
              <button
                aria-label="Close menu"
                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:border-cyan-400/40 hover:text-cyan-100"
              >
                <X className="h-4 w-4" />
              </button>
            </SheetClose>
          </SheetHeader>

          <div className="relative flex-1 overflow-y-auto px-3 py-4">
            <div className="px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              Navigate
            </div>
            <div className="flex flex-col gap-2">
              <NavRow
                to="/"
                icon={<Home className="h-4 w-4" />}
                label="Terminal"
                badge={!onAiPage ? { text: "Active", tone: "emerald" } : undefined}
              />
              <NavRow
                to="/future-leaders"
                highlight
                icon={<Sparkles className="h-4 w-4 text-fuchsia-300" />}
                label="Future Leaders Scanner"
                badge={{ text: "New", tone: "emerald" }}
              />
              <NavRow
                to="/momentum-rockets"
                icon={<Rocket className="h-4 w-4 text-amber-300" />}
                label="Momentum Rockets"
                badge={{ text: "New", tone: "emerald" }}
              />
              <NavRow
                to="/ai"
                icon={<Sparkles className="h-4 w-4 text-cyan-200" />}
                label="AI Copilot"
                badge={onAiPage ? { text: "Active", tone: "emerald" } : { text: "Pro", tone: "amber" }}
              />
              <NavRow
                to="/simulation"
                icon={<Beaker className="h-4 w-4 text-amber-300" />}
                label="Simulation & Testing"
                badge={{ text: "Sandbox", tone: "amber" }}
              />
              <NavRow
                to="/systemic-risk"
                icon={<ShieldAlert className="h-4 w-4 text-rose-300" />}
                label="Systemic Risk Engine"
                badge={{ text: "New", tone: "emerald" }}
              />
              <NavRow
                to="/analog-validation"
                icon={<ShieldCheck className="h-4 w-4 text-violet-300" />}
                label="Analog Validation"
                badge={{ text: "Accuracy", tone: "amber" }}
              />




            </div>

            <div className="mt-6 px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              Experience
            </div>
            <div className="flex flex-col gap-2">
              <div
                className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition ${
                  simple
                    ? "border-cyan-400/40 bg-gradient-to-r from-cyan-400/10 via-slate-900/40 to-fuchsia-500/10"
                    : "border-slate-800/70 bg-slate-900/40"
                }`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-950 text-cyan-200">
                  <BookOpen className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-100">Simple Mode</span>
                    <Switch checked={simple} onCheckedChange={setSimple} />
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">
                    Plain-English explanations, guided tips, and less jargon on every screen.
                    Nothing about the scanner, AI, or math changes — just the way it's shown.
                  </p>
                </div>
              </div>

              <div
                className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition ${
                  glass
                    ? "border-cyan-300/50 bg-gradient-to-r from-cyan-300/15 via-sky-500/10 to-teal-400/15"
                    : "border-slate-800/70 bg-slate-900/40"
                }`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-950 text-cyan-200">
                  <Droplets className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-100">
                      Liquid Retina Glass
                    </span>
                    <Switch checked={glass} onCheckedChange={setGlass} />
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">
                    Translucent ocean-glass appearance across the whole app. Nothing about the
                    data, scanner, or workflows changes — only how it looks.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              Quick Actions
            </div>
            <div className="flex flex-col gap-2">
              <ActionRow
                onClick={() => {
                  const a = getActions();
                  if (!a?.openLiveRegime) return toast.error("Not available on this page");
                  setOpen(false);
                  a.openLiveRegime();
                }}
                icon={<Radio className="h-4 w-4 text-cyan-300" />}
                label="Live Regime · Intraday"
                desc="Per-ETF regime, setup, execution, ladder"
              />
              <ActionRow
                onClick={rescan}
                icon={<RefreshCw className="h-4 w-4" />}
                label="Rescan market"
                desc="Refresh live regime & scenarios"
              />

              <ActionRow
                onClick={() => {
                  setOpen(false);
                  toast.info("Adjust capital & fractional sizing from the terminal header.");
                }}
                icon={<Wallet className="h-4 w-4" />}
                label="Capital & sizing"
                desc="Set capital, fractional shares"
              />
              <ActionRow
                onClick={() => {
                  setOpen(false);
                  toast.info("Laddrx Auto-Router — outputs are a framework, not financial advice.");
                }}
                icon={<Info className="h-4 w-4" />}
                label="About Laddrx"
                desc="Framework · not financial advice"
              />
            </div>

            <div className="mt-6 px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              Account
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-3 rounded-xl border border-slate-800/70 bg-slate-900/40 px-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-950 text-cyan-200">
                  <UserIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-100">
                    {email ?? "Signed out"}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">
                    {email ? "Signed in" : "Not signed in"}
                  </div>
                </div>
              </div>
              {email ? (
                <ActionRow
                  onClick={signOut}
                  icon={<LogOut className="h-4 w-4" />}
                  label="Sign out"
                  desc="End this session"
                />
              ) : (
                <ActionRow
                  onClick={() => {
                    setOpen(false);
                    navigate({ to: "/auth" });
                  }}
                  icon={<UserIcon className="h-4 w-4" />}
                  label="Sign in"
                  desc="Access positions, AI, and Telegram"
                />
              )}
            </div>
          </div>

          <div className="relative border-t border-slate-800/70 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.22em] text-slate-600">
            v1 · Auto-Router
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
