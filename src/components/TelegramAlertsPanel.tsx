import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getTelegramConfig,
  saveTelegramConfig,
  sendTelegramTest,
  TELEGRAM_BOT_URL,
  TELEGRAM_BOT_USERNAME,
  type TelegramConfig,
} from "@/lib/telegram-config.functions";

export function TelegramAlertsPanel() {
  const loadFn = useServerFn(getTelegramConfig);
  const saveFn = useServerFn(saveTelegramConfig);
  const testFn = useServerFn(sendTelegramTest);
  const [cfg, setCfg] = useState<TelegramConfig | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { loadFn().then(setCfg).catch(() => {}); }, [loadFn]);
  // Poll every 5s so the chat count updates right after the user opens the bot
  // in another tab and presses Start.
  useEffect(() => {
    const t = setInterval(() => { loadFn().then(setCfg).catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [loadFn]);

  const update = (patch: Partial<TelegramConfig>) => {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    saveFn({ data: patch }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed to save"));
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const r = (await testFn()) as { sent?: number; total?: number };
      toast.success(`Test sent to ${r?.sent ?? 0}/${r?.total ?? 0} chat${(r?.total ?? 0) === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  if (!cfg) {
    return (
      <div className="rounded-lg border border-sky-500/20 bg-[#131a2b] px-4 py-3 text-[11px] text-slate-400">
        Loading Telegram settings…
      </div>
    );
  }

  const chatCount = cfg.active_chat_count ?? 0;
  const hasChats = chatCount > 0;

  return (
    <div className="rounded-lg border border-sky-500/20 bg-[#131a2b] px-4 py-3 space-y-3">
      <div className="rounded border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-mono font-bold">
            Telegram Bot
          </div>
          <span
            className={
              hasChats
                ? "text-[10px] font-mono text-emerald-300 bg-emerald-500/10 rounded px-1.5 py-0.5"
                : "text-[10px] font-mono text-amber-300 bg-amber-500/10 rounded px-1.5 py-0.5"
            }
          >
            {hasChats ? `● ${chatCount} chat${chatCount === 1 ? "" : "s"} active` : "○ No chats yet"}
          </span>
        </div>
        <a
          href={TELEGRAM_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 px-3 transition"
        >
          💬 Open @{TELEGRAM_BOT_USERNAME} on Telegram
        </a>
        <div className="text-[11px] text-slate-400 text-center">
          Tap the button, press <b>Start</b>. That chat is instantly added to alerts — no signup, no linking.
          {hasChats ? " Add as many chats as you like." : ""}
        </div>
        <Button size="sm" variant="secondary" onClick={runTest} disabled={testing || !hasChats} className="w-full">
          {testing ? "Sending…" : `🧪 Send test to ${hasChats ? `${chatCount} chat${chatCount === 1 ? "" : "s"}` : "Telegram"}`}
        </Button>
      </div>


      <div className="rounded border border-slate-700/60 bg-slate-900/40 px-3 py-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-sky-300 font-mono font-bold">
          Alert categories
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {([
            ["new_picks_enabled", "New dip picks"],
            ["future_leaders_enabled", "Future leaders"],
            ["price_level_enabled", "Price drops (-2/-3/-5%)"],
            ["digests_enabled", "Scan digests"],
            ["system_alerts_enabled", "System health"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-2 rounded border border-slate-700/60 px-2 py-1.5">
              <span className="text-slate-300">{label}</span>
              <Switch
                checked={cfg[key]}
                onCheckedChange={(v) => update({ [key]: v } as Partial<TelegramConfig>)}
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
          <span>Min pick score</span>
          <Input
            type="number" min={0} max={100}
            value={cfg.min_pick_score}
            onChange={(e) => update({ min_pick_score: Number(e.target.value) })}
            className="h-7 w-20 text-xs bg-slate-950 border-slate-700"
          />
          <span className="ml-2">Digest gap (min)</span>
          <Input
            type="number" min={1} max={240}
            value={cfg.digest_min_gap_minutes}
            onChange={(e) => update({ digest_min_gap_minutes: Number(e.target.value) })}
            className="h-7 w-20 text-xs bg-slate-950 border-slate-700"
          />
        </div>
      </div>

      <div className="rounded border border-slate-700/60 bg-slate-900/40 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-sky-300 font-mono font-bold">
            Quiet hours (UTC)
          </div>
          <Switch
            checked={cfg.quiet_hours_enabled}
            onCheckedChange={(v) => update({ quiet_hours_enabled: v })}
          />
        </div>
        {cfg.quiet_hours_enabled && (
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>From (min)</span>
            <Input
              type="number" min={0} max={1439}
              value={cfg.quiet_hours_start_min}
              onChange={(e) => update({ quiet_hours_start_min: Number(e.target.value) })}
              className="h-7 w-20 text-xs bg-slate-950 border-slate-700"
            />
            <span>To (min)</span>
            <Input
              type="number" min={0} max={1439}
              value={cfg.quiet_hours_end_min}
              onChange={(e) => update({ quiet_hours_end_min: Number(e.target.value) })}
              className="h-7 w-20 text-xs bg-slate-950 border-slate-700"
            />
          </div>
        )}
      </div>
    </div>
  );
}
