import { lazy, Suspense } from "react";

// Recharts is ~90 KB gzipped; only the terminal detail sheet and expanded
// position rows actually render a chart. Lazy-loading this component keeps
// recharts out of the initial bundle for every page load.
const Inner = lazy(() =>
  import("@/components/IntradayAnalogChart").then((m) => ({ default: m.IntradayAnalogChart })),
);

function ChartFallback({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`w-full rounded-xl border border-slate-800/60 bg-slate-900/40 animate-pulse ${
        compact ? "h-24" : "h-64"
      }`}
      aria-hidden
    />
  );
}

export function IntradayAnalogChartLazy({
  symbol,
  compact = false,
}: {
  symbol: string;
  compact?: boolean;
}) {
  return (
    <Suspense fallback={<ChartFallback compact={compact} />}>
      <Inner symbol={symbol} compact={compact} />
    </Suspense>
  );
}
