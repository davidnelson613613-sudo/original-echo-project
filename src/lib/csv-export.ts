import type { Bracket } from "./brackets";

export type CsvTranche = {
  day: number;
  pct: number;
  price: number;
  label: string;
  mode?: "limit" | "market" | "pullback";
};

export function tranchesToCsv(
  symbol: string,
  capital: number,
  fractional: boolean,
  tranches: CsvTranche[],
  brackets?: Bracket[],
): string {
  const rows: string[][] = [];
  rows.push([
    "Symbol",
    "Rung",
    "Action",
    "OrderType",
    "LimitPrice",
    "Shares",
    "Capital",
    "TakeProfit1",
    "TakeProfit2",
    "StopLoss",
    "Note",
  ]);
  tranches.forEach((t, i) => {
    const cap = capital * t.pct;
    const shares = fractional
      ? Math.round((cap / t.price) * 10000) / 10000
      : Math.floor(cap / t.price);
    const b = brackets?.[i];
    rows.push([
      symbol,
      String(t.day),
      "BUY",
      t.mode === "market" ? "MARKET" : t.mode === "pullback" ? "LIMIT_PULLBACK" : "LIMIT",
      t.price.toFixed(2),
      String(shares),
      cap.toFixed(2),
      b ? b.tp1.toFixed(2) : "",
      b ? b.tp2.toFixed(2) : "",
      b ? b.stop.toFixed(2) : "",
      t.label,
    ]);
  });
  return rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function downloadCsv(filename: string, content: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}