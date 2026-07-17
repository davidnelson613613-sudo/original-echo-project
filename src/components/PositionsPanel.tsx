import { Briefcase, TrendingDown, TrendingUp, X } from "lucide-react";
import type { PositionMap } from "@/lib/positions";
import type { ScanRow } from "@/lib/market.functions";
import { Button } from "@/components/ui/button";
import { IntradayAnalogChartLazy as IntradayAnalogChart } from "@/components/IntradayAnalogChartLazy";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

type Row = {
  symbol: string;
  shares: number;
  avgCost: number;
  costBasis: number;
  price: number;
  marketValue: number;
  pl: number;
  plPct: number;
  fills: number;
  totalCapital: number;
  deployedPct: number;
};

function buildRows(positions: PositionMap, scanRows: ScanRow[]): Row[] {
  const priceMap = new Map(scanRows.map((r) => [r.symbol, r.price]));
  const out: Row[] = [];
  for (const p of Object.values(positions)) {
    const shares = p.entries.reduce((a, e) => a + e.shares, 0);
    if (shares <= 0) continue;
    const cost = p.entries.reduce((a, e) => a + e.shares * e.price, 0);
    const avgCost = cost / shares;
    const price = priceMap.get(p.symbol) ?? avgCost;
    const marketValue = shares * price;
    const pl = marketValue - cost;
    const plPct = (pl / cost) * 100;
    const deployedPct = p.entries.reduce((a, e) => a + e.pct, 0) * 100;
    out.push({
      symbol: p.symbol,
      shares,
      avgCost,
      costBasis: cost,
      price,
      marketValue,
      pl,
      plPct,
      fills: p.entries.length,
      totalCapital: p.totalCapital,
      deployedPct,
    });
  }
  return out;
}

export function PositionsPanel({
  positions,
  scanRows,
  onReset,
  onFocusSymbol,
}: {
  positions: PositionMap;
  scanRows: ScanRow[];
  onReset: (symbol: string) => void;
  onFocusSymbol?: (symbol: string) => void;
}) {
  const jumpTo = (symbol: string) => {
    onFocusSymbol?.(symbol);
    if (typeof document === "undefined") return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`sym-card-${symbol}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };
  const rows = buildRows(positions, scanRows);
  if (rows.length === 0) return null;
  const totalPl = rows.reduce((a, r) => a + r.pl, 0);
  const totalMv = rows.reduce((a, r) => a + r.marketValue, 0);
  const totalCost = rows.reduce((a, r) => a + r.costBasis, 0);
  const totalPct = totalCost > 0 ? (totalPl / totalCost) * 100 : 0;

  return (
    <section className="rounded-lg border border-emerald-500/20 bg-[#131a2b]/60 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-emerald-400" />
          <span className="text-[10px] uppercase tracking-[0.25em] text-emerald-300 font-mono font-bold">
            Live Positions
          </span>
          <span className="text-[10px] text-slate-500 font-mono">({rows.length})</span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">Total P&amp;L</div>
          <div
            className={`font-mono text-sm font-bold ${
              totalPl >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {totalPl >= 0 ? "+" : ""}
            {usd(totalPl)}{" "}
            <span className="text-[11px] opacity-70">({pct(totalPct)})</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">MV {usd(totalMv)}</div>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.symbol}
            role="button"
            tabIndex={0}
            onClick={() => jumpTo(r.symbol)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                jumpTo(r.symbol);
              }
            }}
            className="rounded-md border border-slate-800 bg-slate-950/40 p-2.5 cursor-pointer hover:border-cyan-500/50 hover:bg-slate-900/60 transition"
            title={`Jump to ${r.symbol} details`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-mono font-black text-slate-100">{r.symbol}</span>
                <span className="text-[10px] text-slate-500 font-mono truncate">
                  {r.shares.toLocaleString()} sh · avg {usd(r.avgCost)} · {r.fills} fill
                  {r.fills > 1 ? "s" : ""}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onReset(r.symbol);
                }}
                className="h-6 w-6 p-0 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                title="Close/reset position"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-[11px] font-mono">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">Price</div>
                <div className="text-slate-200">{usd(r.price)}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">MV</div>
                <div className="text-slate-200">{usd(r.marketValue)}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">P&amp;L</div>
                <div
                  className={`flex items-center gap-0.5 ${
                    r.pl >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {r.pl >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {r.pl >= 0 ? "+" : ""}
                  {usd(r.pl)}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">%</div>
                <div className={r.plPct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                  {pct(r.plPct)}
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-cyan-400/60"
                  style={{ width: `${Math.min(100, r.deployedPct)}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-500 font-mono">
                {Math.round(r.deployedPct)}% deployed
              </span>
            </div>
            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
              <IntradayAnalogChart symbol={r.symbol} compact />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}