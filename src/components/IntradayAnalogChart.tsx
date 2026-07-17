import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Clock, TrendingUp } from "lucide-react";
import {
  getIntradayAnalogProjection,
  type IntradayProjectionResult,
} from "@/lib/intraday-analog.functions";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const INTRADAY_ANALOG_QUERY_VERSION = "tz-v3-projected-default";

function minutesToLabel(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function isUsMarketOpen(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

type Row = {
  m: number;
  time: string;
  actual?: number;
  median?: number;
  p25?: number;
  p75?: number;
  bandLow?: number;
  bandSpan?: number;
};

export function IntradayAnalogChart({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Re-render every minute so "as of" label stays honest even between fetches.
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const q = useQuery<IntradayProjectionResult>({
    queryKey: ["intraday-analog", INTRADAY_ANALOG_QUERY_VERSION, symbol.toUpperCase()],
    queryFn: () => getIntradayAnalogProjection({ data: { symbol: symbol.toUpperCase(), version: INTRADAY_ANALOG_QUERY_VERSION } }),
    refetchInterval: () => (isUsMarketOpen() ? 60_000 : 15 * 60_000),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const rows: Row[] = useMemo(() => {
    if (!q.data || q.data.status !== "ok") return [];
    const map = new Map<number, Row>();
    for (const b of q.data.actual) {
      map.set(b.minutesFromOpen, { m: b.minutesFromOpen, time: b.time, actual: b.price });
    }
    for (const p of q.data.projection) {
      const existing = map.get(p.minutesFromOpen) ?? { m: p.minutesFromOpen, time: minutesToLabel(p.minutesFromOpen) };
      existing.median = p.medianPrice;
      existing.p25 = p.p25Price;
      existing.p75 = p.p75Price;
      existing.bandLow = p.p25Price;
      existing.bandSpan = p.p75Price - p.p25Price;
      map.set(p.minutesFromOpen, existing);
    }
    // Ensure projection starts at the current price so lines connect visually.
    const anchor = q.data.currentMinutesFromOpen;
    const anchorRow = map.get(anchor);
    if (anchorRow) {
      anchorRow.median = anchorRow.actual;
      anchorRow.p25 = anchorRow.actual;
      anchorRow.p75 = anchorRow.actual;
      anchorRow.bandLow = anchorRow.actual;
      anchorRow.bandSpan = 0;
    }
    return [...map.values()].sort((a, b) => a.m - b.m);
  }, [q.data]);

  if (q.isLoading) {
    return (
      <Card className="border-cyan-500/20 bg-[#131a2b]/60">
        <CardContent className="p-4 text-xs text-slate-400 font-mono">
          Loading intraday analog for {symbol}…
        </CardContent>
      </Card>
    );
  }
  if (!q.data || q.data.status !== "ok") {
    return (
      <Card className="border-slate-800 bg-[#131a2b]/40">
        <CardContent className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 font-mono font-bold">
            <Activity className="h-3 w-3" /> Intraday Analog · {symbol}
          </div>
          <div className="text-xs text-slate-400">{q.data?.note ?? q.error?.message ?? "Unavailable."}</div>
        </CardContent>
      </Card>
    );
  }

  const d = q.data;
  const bias = d.medianPctByEod;
  const biasColor = bias > 0.15 ? "text-emerald-300" : bias < -0.15 ? "text-rose-300" : "text-slate-300";
  const asOfEt = new Date(d.asOfIso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });

  return (
    <Card className="border-cyan-500/20 bg-[#131a2b]/60">
      <CardContent className={compact ? "p-3 space-y-2" : "p-4 space-y-3"}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-cyan-300 font-mono font-bold">
              <Activity className="h-3 w-3" /> Intraday Analog Path · {d.symbol}
            </div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-1.5">
              <Clock className="h-2.5 w-2.5" />
              Based on <span className="text-slate-300">{d.sampleSize}</span> historical days · similarity{" "}
              <span className="text-slate-300">{d.meanSimilarity}%</span> · confidence{" "}
              <span className="text-slate-300">{d.confidence}%</span> · as of {asOfEt} ET
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-widest text-slate-500 font-mono">Historical Median EOD</div>
            <div className={`font-mono text-sm ${biasColor}`}>
              {usd(d.medianCloseByEod)}{" "}
              <span className="text-[10px] text-slate-500">
                ({bias >= 0 ? "+" : ""}{bias.toFixed(2)}%)
              </span>
            </div>
            <div className="text-[9px] text-slate-500 font-mono">
              {usd(d.p25CloseByEod)} – {usd(d.p75CloseByEod)} · P(up) {Math.round(d.probUpByEod * 100)}%
            </div>
          </div>
        </div>

        <div className={compact ? "h-40" : "h-56"}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: "#64748b" }}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v))}
                width={50}
              />
              <Tooltip
                contentStyle={{ background: "#0b0f1a", border: "1px solid #334155", fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(value: number | string, name: string) => {
                  if (typeof value !== "number") return [value, name];
                  return [usd(value), name];
                }}
              />
              {/* Confidence band: transparent base + colored span stacked */}
              <Area
                type="monotone"
                dataKey="bandLow"
                stackId="band"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
                name=" "
              />
              <Area
                type="monotone"
                dataKey="bandSpan"
                stackId="band"
                stroke="none"
                fill="#22d3ee"
                fillOpacity={0.12}
                isAnimationActive={false}
                name="p25–p75 band"
              />
              <ReferenceLine
                x={minutesToLabel(d.currentMinutesFromOpen)}
                stroke="#22d3ee"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#e2e8f0"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                name="Actual"
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="median"
                stroke="#22d3ee"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
                name="Median historical path"
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-[2px] w-3 bg-slate-200" /> Actual
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-[2px] w-3 bg-cyan-400" style={{ borderTop: "1px dashed" }} /> Median analog path
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 bg-cyan-400/25 rounded" /> 25th–75th percentile
          </span>
        </div>

        <p className="text-[10px] text-slate-500 leading-relaxed">
          <TrendingUp className="inline h-2.5 w-2.5 mr-1 text-cyan-400" />
          Real intraday analog evidence only: future points are the empirical median of real prior 5-minute sessions with today's shape. No modeled minute data.
        </p>
      </CardContent>
    </Card>
  );
}