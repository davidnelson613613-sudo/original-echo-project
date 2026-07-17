import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tranchesToCsv, downloadCsv, type CsvTranche } from "@/lib/csv-export";
import type { Bracket } from "@/lib/brackets";
import { toast } from "sonner";

export function CsvExportButton({
  symbol,
  capital,
  fractional,
  tranches,
  brackets,
  className,
}: {
  symbol: string;
  capital: number;
  fractional: boolean;
  tranches: CsvTranche[];
  brackets?: Bracket[];
  className?: string;
}) {
  const onClick = () => {
    const csv = tranchesToCsv(symbol, capital, fractional, tranches, brackets);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`laddrx-${symbol.toLowerCase()}-${stamp}.csv`, csv);
    toast.success(`Exported ${symbol} plan`);
  };
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      className={`h-7 border-cyan-500/30 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10 ${className ?? ""}`}
    >
      <Download className="h-3 w-3 mr-1" />
      <span className="text-[10px] font-mono">CSV</span>
    </Button>
  );
}