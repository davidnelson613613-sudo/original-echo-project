import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyAlertHistory, type AlertHistoryRow } from "@/lib/alert-history.functions";

const KIND_EMOJI: Record<string, string> = {
  NEW_PICK: "🚀",
  FUTURE_LEADER: "🏆",
  PRICE_LEVEL: "📉",
  APPROACHING: "🎯",
  AT_ZONE: "🎯",
};

export function AlertHistoryPanel() {
  const fn = useServerFn(getMyAlertHistory);
  const [rows, setRows] = useState<AlertHistoryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fn().then(setRows).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [fn]);

  return (
    <div className="rounded-lg border border-sky-500/20 bg-[#131a2b] px-4 py-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-sky-300 font-mono font-bold">
        Alert history · last 50
      </div>
      {err && <div className="text-[11px] text-rose-300">{err}</div>}
      {!rows && !err && <div className="text-[11px] text-slate-500">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="text-[11px] text-slate-500">No alerts yet.</div>
      )}
      {rows && rows.length > 0 && (
        <div className="max-h-72 overflow-y-auto text-[11px] font-mono divide-y divide-slate-800">
          {rows.map((r) => (
            <div key={r.id} className="py-1.5 flex items-start gap-2">
              <span className="w-4 shrink-0">{KIND_EMOJI[r.alert_kind] ?? "🔔"}</span>
              <span className="w-16 shrink-0 text-cyan-300">{r.symbol}</span>
              <span className="w-24 shrink-0 text-slate-400 uppercase text-[10px]">{r.alert_kind}</span>
              <span className="flex-1 text-slate-300 truncate">{r.message ?? r.alert_key}</span>
              <span className="text-slate-500 text-[10px] shrink-0">
                {new Date(r.created_at).toISOString().slice(5, 16).replace("T", " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
