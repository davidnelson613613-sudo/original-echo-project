import { useEffect, useMemo, useState } from "react";
import { History, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadLog, computeStats, clearLog, type SignalLog } from "@/lib/track-record";

const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

export function TrackRecordPanel({ refreshKey }: { refreshKey: unknown }) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState<SignalLog[]>([]);

  useEffect(() => {
    setLog(loadLog());
  }, [refreshKey, tick]);

  const stats = useMemo(() => computeStats(log), [log]);
  const total = stats.reduce((a, s) => a + s.total, 0);

  return (
    <section className="rounded-lg border border-cyan-500/20 bg-[#131a2b]/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-cyan-500/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-cyan-400" />
          <span className="text-[10px] uppercase tracking-[0.25em] text-cyan-300 font-mono font-bold">
            Track Record
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            ({total} signal{total === 1 ? "" : "s"} logged)
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        )}
      </button>
      {open && (
        <div className="border-t border-cyan-500/10 p-4 space-y-3">
          {total === 0 ? (
            <p className="text-xs text-slate-500 leading-relaxed">
              No signals logged yet. The app will save each non-flat regime call it makes; after 3–5
              trading days it retroactively scores what the price actually did.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-1 pr-2">Regime</th>
                      <th className="py-1 pr-2 text-right">N</th>
                      <th className="py-1 pr-2 text-right">3d hit</th>
                      <th className="py-1 pr-2 text-right">avg 3d</th>
                      <th className="py-1 pr-2 text-right">5d hit</th>
                      <th className="py-1 text-right">avg 5d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats
                      .slice()
                      .sort((a, b) => b.total - a.total)
                      .map((s) => (
                        <tr key={s.regime} className="border-b border-slate-900">
                          <td className="py-1 pr-2 text-slate-300 truncate max-w-[120px]">
                            {s.regimeLabel}
                          </td>
                          <td className="py-1 pr-2 text-right text-slate-400">{s.total}</td>
                          <td className="py-1 pr-2 text-right">
                            {s.scored3d ? (
                              <span className={s.hitRate3d >= 50 ? "text-emerald-400" : "text-rose-400"}>
                                {s.hitRate3d.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {s.scored3d ? (
                              <span className={s.avg3d >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                {pct(s.avg3d)}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {s.scored5d ? (
                              <span className={s.hitRate5d >= 50 ? "text-emerald-400" : "text-rose-400"}>
                                {s.hitRate5d.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="py-1 text-right">
                            {s.scored5d ? (
                              <span className={s.avg5d >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                {pct(s.avg5d)}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-slate-500 leading-snug">
                  Signals scored using post-scan prices. Hit-rate = % of signals that closed above
                  entry after the horizon. Green regimes ≥50% are worth trusting more.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    clearLog();
                    setTick((t) => t + 1);
                  }}
                  className="h-7 text-[10px] text-slate-500 hover:text-rose-400 hover:bg-rose-500/5"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}