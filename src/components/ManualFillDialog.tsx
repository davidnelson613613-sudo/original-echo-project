import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { LadderRung } from "@/lib/speed-mode";

export type ManualFillTranche = {
  day: number;
  pct: number;
  price: number;
  label: string;
};

export type ExistingFill = {
  price: number;
  shares: number;
};

type SizeMode = "shares" | "dollars";

export function ManualFillDialog({
  open,
  onOpenChange,
  symbol,
  tranche,
  capital,
  fractional,
  plannedLadder,
  scenarioKey,
  existing,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  symbol: string;
  tranche: ManualFillTranche | null;
  capital: number;
  fractional: boolean;
  plannedLadder: LadderRung[];
  scenarioKey: string;
  existing?: ExistingFill | null;
  onConfirm: (
    entry: { day: number; pct: number; shares: number; price: number; auto: false },
    meta: { totalCapital: number; scenario: string; plannedLadder: LadderRung[] },
  ) => void;
}) {
  const [price, setPrice] = useState("");
  const [shares, setShares] = useState("");
  const [dollars, setDollars] = useState("");
  const [mode, setMode] = useState<SizeMode>("shares");

  const defaultShares = useMemo(() => {
    if (!tranche) return 0;
    const cap = capital * tranche.pct;
    const s = cap / tranche.price;
    return fractional ? Math.round(s * 10000) / 10000 : Math.max(1, Math.floor(s));
  }, [tranche, capital, fractional]);

  useEffect(() => {
    if (!open || !tranche) return;
    const initPrice = existing?.price ?? tranche.price;
    const initShares = existing?.shares ?? defaultShares;
    setPrice(initPrice.toFixed(2));
    setShares(String(initShares));
    setDollars((initPrice * initShares).toFixed(2));
    setMode("shares");
  }, [open, tranche, existing, defaultShares]);

  if (!tranche) return null;

  const priceNum = Number(price);
  const validPrice = Number.isFinite(priceNum) && priceNum > 0;

  // Derive shares from whichever field the user is editing.
  // Dollars mode always allows fractional shares — a dollar amount implies
  // fractional buying regardless of the top-level fractional toggle.
  let sharesNum = 0;
  if (mode === "shares") {
    const raw = Number(shares);
    sharesNum = fractional ? raw : Math.floor(raw);
  } else {
    const d = Number(dollars);
    if (validPrice && Number.isFinite(d) && d > 0) {
      sharesNum = Math.round((d / priceNum) * 10000) / 10000;
    }
  }

  const validShares = Number.isFinite(sharesNum) && sharesNum > 0;
  const notional = validPrice ? priceNum * sharesNum : 0;
  const pctOfPlan = capital > 0 ? notional / capital : tranche.pct;
  const canSave = validPrice && validShares;

  const onPriceChange = (v: string) => {
    setPrice(v);
    const p = Number(v);
    if (!Number.isFinite(p) || p <= 0) return;
    if (mode === "shares") {
      setDollars((p * Number(shares || 0)).toFixed(2));
    } else {
      const d = Number(dollars || 0);
      setShares(String(Math.round((d / p) * 10000) / 10000));
    }
  };
  const onSharesChange = (v: string) => {
    setMode("shares");
    setShares(v);
    const s = Number(v);
    if (validPrice && Number.isFinite(s)) setDollars((priceNum * s).toFixed(2));
  };
  const onDollarsChange = (v: string) => {
    setMode("dollars");
    setDollars(v);
    const d = Number(v);
    if (validPrice && Number.isFinite(d) && d > 0) {
      setShares(String(Math.round((d / priceNum) * 10000) / 10000));
    }
  };

  const save = () => {
    if (!canSave) return;
    onConfirm(
      { day: tranche.day, pct: pctOfPlan, shares: sharesNum, price: priceNum, auto: false },
      { totalCapital: capital, scenario: scenarioKey, plannedLadder },
    );
    toast.success(
      `${existing ? "Fill updated" : "Manual fill recorded"} · ${symbol} · ${sharesNum} sh @ $${priceNum.toFixed(2)}`,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0f1524] border-cyan-500/30 text-slate-100">
        <DialogHeader>
          <DialogTitle className="font-mono">
            {existing ? "Re-edit Fill" : "Edit & Mark Filled"} · {symbol} · Day {tranche.day}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Enter what you actually executed — by share count OR by dollars spent
            (great for fractional buys). You can re-open this any time to fix a
            mistake; the ladder, buying power and Recovery Capture rebuild from
            whatever you save here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Fill Price
            </Label>
            <Input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => onPriceChange(e.target.value)}
              className="font-mono bg-[#131a2b] border-cyan-500/20 mt-1"
            />
            <div className="text-[10px] text-slate-500 mt-1 font-mono">
              Rung target ${tranche.price.toFixed(2)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                Shares
              </Label>
              <Input
                type="number"
                step={fractional ? "0.0001" : "1"}
                value={shares}
                onChange={(e) => onSharesChange(e.target.value)}
                className={`font-mono bg-[#131a2b] mt-1 ${mode === "shares" ? "border-cyan-400/60" : "border-cyan-500/20"}`}
              />
              <div className="text-[10px] text-slate-500 mt-1 font-mono">
                Planned {defaultShares} sh
              </div>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                Dollars Spent
              </Label>
              <Input
                type="number"
                step="0.01"
                value={dollars}
                onChange={(e) => onDollarsChange(e.target.value)}
                className={`font-mono bg-[#131a2b] mt-1 ${mode === "dollars" ? "border-cyan-400/60" : "border-cyan-500/20"}`}
              />
              <div className="text-[10px] text-slate-500 mt-1 font-mono">
                e.g. $500 = {validPrice ? (500 / priceNum).toFixed(4) : "—"} sh
              </div>
            </div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs font-mono text-slate-300 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Notional</span>
              <span>${notional.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">% of plan</span>
              <span>{(pctOfPlan * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Rung</span>
              <span className="truncate ml-2">{tranche.label}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={!canSave}
            className="bg-cyan-500 hover:bg-cyan-400 text-[#0b0f1a] font-bold"
          >
            {existing ? "Save Changes" : "Save Manual Fill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
