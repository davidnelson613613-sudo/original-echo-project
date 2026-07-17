import type { Bracket } from "@/lib/brackets";
import { Target, TrendingUp, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);

export function BracketExitDisplay({ bracket }: { bracket: Bracket }) {
  const isAnalog = bracket.source === "analog";
  const badge = isAnalog
    ? { icon: CheckCircle2, cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/5", label: `n=${bracket.sample} · ${bracket.confidence}%` }
    : { icon: AlertTriangle, cls: "text-amber-400 border-amber-500/40 bg-amber-500/5", label: "ATR fallback" };
  const BadgeIcon = badge.icon;
  return (
    <div className="mt-2 rounded-md border border-slate-800 bg-slate-950/40 p-1.5" title={bracket.note}>
      <div className={`mb-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${badge.cls}`}>
        <BadgeIcon className="h-2.5 w-2.5" />
        <span>{badge.label}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
      <div className="flex items-center gap-1 rounded bg-emerald-500/5 px-1.5 py-1 min-w-0">
        <Target className="h-3 w-3 shrink-0 text-emerald-400" />
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-emerald-500/80 leading-none">TP1</div>
          <div className="font-mono text-[10px] text-emerald-300 truncate">{fmt(bracket.tp1)}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 rounded bg-cyan-500/5 px-1.5 py-1 min-w-0">
        <TrendingUp className="h-3 w-3 shrink-0 text-cyan-400" />
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-cyan-500/80 leading-none">TP2</div>
          <div className="font-mono text-[10px] text-cyan-300 truncate">{fmt(bracket.tp2)}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 rounded bg-rose-500/5 px-1.5 py-1 min-w-0">
        <ShieldAlert className="h-3 w-3 shrink-0 text-rose-400" />
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-rose-500/80 leading-none">STOP</div>
          <div className="font-mono text-[10px] text-rose-300 truncate">{fmt(bracket.stop)}</div>
        </div>
      </div>
      </div>
    </div>
  );
}