import { Gauge } from "lucide-react";
import type { SpeedMode } from "@/lib/speed-mode";
import { SPEED_MODE_META } from "@/lib/speed-mode";

export function SpeedModeToggle({
  value,
  onChange,
}: {
  value: SpeedMode;
  onChange: (m: SpeedMode) => void;
}) {
  const modes: SpeedMode[] = ["conservative", "balanced", "aggressive"];
  return (
    <div className="rounded-lg border border-cyan-500/20 bg-[#131a2b] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-[10px] uppercase tracking-[0.25em] text-cyan-300 font-mono font-bold">
            Speed Mode
          </span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">{SPEED_MODE_META[value].short}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {modes.map((m) => {
          const meta = SPEED_MODE_META[m];
          const active = m === value;
          return (
            <button
              key={m}
              onClick={() => onChange(m)}
              className={`rounded-md border px-2 py-1.5 text-[10px] font-mono font-bold tracking-wider transition-all ${
                active ? meta.activeCls : meta.cls
              }`}
            >
              {meta.short}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-slate-400 leading-snug">{SPEED_MODE_META[value].desc}</p>
    </div>
  );
}