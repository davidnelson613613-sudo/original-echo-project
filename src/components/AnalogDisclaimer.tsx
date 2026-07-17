import { Info } from "lucide-react";

export function AnalogDisclaimer({
  variant = "full",
}: {
  variant?: "full" | "compact";
}) {
  const text =
    variant === "compact"
      ? "Historical probabilities from closest analog matches — not a guarantee or prediction. Prices are split- and dividend-adjusted, so historical values may differ from raw quotes at the time."
      : "All probabilities, scenarios and expected moves shown here are derived from the closest historical analog matches to today's setup. They are historical tendencies — not forecasts, guarantees, or predictions of future price. Past behavior in similar market conditions does not ensure the same outcome now. Historical prices shown are split- and dividend-adjusted using Yahoo's adjusted-close ratios, so a bar's normalized value may differ from the raw price printed on that date.";
  return (
    <div className="flex items-start gap-2 rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-[10px] font-mono text-slate-400 leading-relaxed">
      <Info className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
      <span>{text}</span>
    </div>
  );
}
