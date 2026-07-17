// Fundamentals scoring for Future Leaders.
//
// Pulls EDGAR (revenue/EPS/FCF), Yahoo quoteSummary (analyst / institutional
// / insider / valuation) and Finnhub (insider $ + rec-trend delta + news
// count) and produces four component scores that plug into the composite:
//   growth, profitability, insider, analyst
// Each is 0..100 with reasons[] and dataComplete. All three sources are
// free and already cached in Supabase — this function is best-effort and
// never throws.

import { getEdgarFundamentalsCached, type EdgarFundamentals } from "@/lib/fundamentals/edgar.server";
import { getYahooSummaryCached, type YahooSummary } from "@/lib/fundamentals/yahoo-summary.server";
import { getFinnhubFundamentalsCached, type FinnhubFundamentals } from "@/lib/fundamentals/finnhub-fundamentals.server";

export type FundamentalComponent = {
  score: number;
  reasons: string[];
  dataComplete: boolean;
};

export type FundamentalsBundle = {
  edgar: EdgarFundamentals | null;
  yahoo: YahooSummary | null;
  finnhub: FinnhubFundamentals | null;
  growth: FundamentalComponent;
  profitability: FundamentalComponent;
  insider: FundamentalComponent;
  analyst: FundamentalComponent;
  fetchedAt: string;
  sources: string[];
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const linear = (x: number | null | undefined, lo: number, hi: number): number => {
  if (x == null || !Number.isFinite(x) || hi === lo) return 50;
  return clamp(((x - lo) / (hi - lo)) * 100);
};

function scoreGrowth(e: EdgarFundamentals | null): FundamentalComponent {
  const reasons: string[] = [];
  if (!e || !e.hasData) return { score: 50, reasons: ["No EDGAR filings"], dataComplete: false };
  let s = 50;
  let n = 0;
  if (e.revenueYoYPct != null) {
    s += (linear(e.revenueYoYPct, -10, 60) - 50) * 0.4;
    if (e.revenueYoYPct >= 30) reasons.push(`Revenue YoY +${e.revenueYoYPct.toFixed(1)}% (hyper-growth)`);
    else if (e.revenueYoYPct >= 15) reasons.push(`Revenue YoY +${e.revenueYoYPct.toFixed(1)}%`);
    else if (e.revenueYoYPct < 0) reasons.push(`Revenue declining ${e.revenueYoYPct.toFixed(1)}%`);
    n++;
  }
  if (e.revenue3yCagrPct != null) {
    s += (linear(e.revenue3yCagrPct, 0, 50) - 50) * 0.35;
    if (e.revenue3yCagrPct >= 25) reasons.push(`3y revenue CAGR ${e.revenue3yCagrPct.toFixed(1)}%`);
    n++;
  }
  if (e.revenueAcceleratingPct != null) {
    s += (linear(e.revenueAcceleratingPct, -10, 15) - 50) * 0.25;
    if (e.revenueAcceleratingPct > 5) reasons.push(`Growth accelerating (+${e.revenueAcceleratingPct.toFixed(1)}pp)`);
    else if (e.revenueAcceleratingPct < -5) reasons.push(`Growth decelerating (${e.revenueAcceleratingPct.toFixed(1)}pp)`);
    n++;
  }
  return { score: clamp(s), reasons, dataComplete: n >= 2 };
}

function scoreProfitability(e: EdgarFundamentals | null): FundamentalComponent {
  const reasons: string[] = [];
  if (!e || !e.hasData) return { score: 50, reasons: ["No EDGAR filings"], dataComplete: false };
  let s = 50;
  let n = 0;
  if (e.grossMarginPct != null) {
    s += (linear(e.grossMarginPct, 20, 75) - 50) * 0.25;
    if (e.grossMarginPct >= 60) reasons.push(`Gross margin ${e.grossMarginPct.toFixed(0)}% (software-like)`);
    n++;
  }
  if (e.operatingMarginPct != null) {
    s += (linear(e.operatingMarginPct, -10, 35) - 50) * 0.25;
    if (e.operatingMarginPct >= 20) reasons.push(`Operating margin ${e.operatingMarginPct.toFixed(0)}%`);
    else if (e.operatingMarginPct < 0) reasons.push(`Unprofitable (op margin ${e.operatingMarginPct.toFixed(0)}%)`);
    n++;
  }
  if (e.fcfMarginPct != null) {
    s += (linear(e.fcfMarginPct, -5, 30) - 50) * 0.25;
    if (e.fcfMarginPct >= 20) reasons.push(`FCF margin ${e.fcfMarginPct.toFixed(0)}%`);
    else if (e.fcfMarginPct < 0) reasons.push(`Negative FCF margin (${e.fcfMarginPct.toFixed(0)}%)`);
    n++;
  }
  if (e.ruleOf40 != null) {
    s += (linear(e.ruleOf40, 10, 60) - 50) * 0.25;
    if (e.ruleOf40 >= 40) reasons.push(`Rule-of-40: ${e.ruleOf40.toFixed(0)} (elite)`);
    n++;
  }
  if (e.shareDilution3yPct != null && e.shareDilution3yPct > 15) {
    s -= 8;
    reasons.push(`Diluting shares +${e.shareDilution3yPct.toFixed(0)}% over 3y`);
  }
  return { score: clamp(s), reasons, dataComplete: n >= 2 };
}

function scoreInsider(
  y: YahooSummary | null,
  fh: FinnhubFundamentals | null,
): FundamentalComponent {
  const reasons: string[] = [];
  let s = 50;
  let complete = false;
  const netDollars = fh?.insiderNetDollars90d ?? null;
  if (netDollars != null) {
    complete = true;
    if (netDollars > 5_000_000) { s += 20; reasons.push(`Insiders net buying $${(netDollars / 1e6).toFixed(1)}M (90d)`); }
    else if (netDollars > 500_000) { s += 10; reasons.push(`Insiders net buying $${(netDollars / 1e6).toFixed(2)}M`); }
    else if (netDollars < -20_000_000) { s -= 20; reasons.push(`Heavy insider selling $${(Math.abs(netDollars) / 1e6).toFixed(1)}M`); }
    else if (netDollars < -5_000_000) { s -= 10; reasons.push(`Insiders net selling $${(Math.abs(netDollars) / 1e6).toFixed(1)}M`); }
  }
  const instFrac = y?.heldPercentInstitutions ?? null;
  const inst = instFrac != null ? instFrac * 100 : null;
  if (inst != null) {
    complete = true;
    if (inst > 70) { s += 6; reasons.push(`Institutional ownership ${inst.toFixed(0)}%`); }
    else if (inst < 20) { s -= 4; reasons.push(`Low institutional ownership ${inst.toFixed(0)}%`); }
  }
  return { score: clamp(s), reasons, dataComplete: complete };
}

function scoreAnalyst(
  y: YahooSummary | null,
  fh: FinnhubFundamentals | null,
): FundamentalComponent {
  const reasons: string[] = [];
  let s = 50;
  let complete = false;
  if (y?.recommendationMean != null) {
    complete = true;
    // Yahoo: 1=strong buy → 5=sell. Invert to a 0..100 quality.
    s += (linear(-y.recommendationMean, -4, -1) - 50) * 0.4;
    if (y.recommendationMean <= 1.8) reasons.push(`Analyst consensus strong buy (${y.recommendationMean.toFixed(2)})`);
    else if (y.recommendationMean >= 3.5) reasons.push(`Analyst consensus lukewarm (${y.recommendationMean.toFixed(2)})`);
  }
  if (y?.analystTargetUpside != null) {
    complete = true;
    s += (linear(y.analystTargetUpside, -20, 60) - 50) * 0.35;
    if (y.analystTargetUpside > 25) reasons.push(`+${y.analystTargetUpside.toFixed(0)}% to mean price target`);
    else if (y.analystTargetUpside < -10) reasons.push(`${y.analystTargetUpside.toFixed(0)}% vs price target`);
  }
  if (fh?.recBuyDelta != null) {
    if (fh.recBuyDelta > 0) { s += Math.min(10, fh.recBuyDelta * 2); reasons.push(`+${fh.recBuyDelta} buy revisions MoM`); }
    else if (fh.recBuyDelta < 0) { s += Math.max(-10, fh.recBuyDelta * 2); reasons.push(`${fh.recBuyDelta} buy revisions MoM`); }
  }
  return { score: clamp(s), reasons, dataComplete: complete };
}

export async function buildFundamentalsBundle(symbol: string): Promise<FundamentalsBundle> {
  const [edgar, yahoo, finnhub] = await Promise.all([
    getEdgarFundamentalsCached(symbol).catch(() => null),
    getYahooSummaryCached(symbol).catch(() => null),
    getFinnhubFundamentalsCached(symbol).catch(() => null),
  ]);
  const sources: string[] = [];
  if (edgar?.hasData) sources.push("sec_edgar");
  if (yahoo) sources.push("yahoo_quotesummary");
  if (finnhub?.hasData) sources.push("finnhub");
  return {
    edgar,
    yahoo,
    finnhub,
    growth: scoreGrowth(edgar),
    profitability: scoreProfitability(edgar),
    insider: scoreInsider(yahoo, finnhub),
    analyst: scoreAnalyst(yahoo, finnhub),
    fetchedAt: new Date().toISOString(),
    sources,
  };
}

// Blend a fundamentals bundle into an existing composite score. Weight is
// applied only for components that returned real data — no free ride for
// missing filings.
export function applyFundamentalsToComposite(
  priceComposite: number,
  b: FundamentalsBundle,
): { composite: number; adjustment: number; weightUsed: number } {
  const parts: Array<{ score: number; weight: number }> = [];
  if (b.growth.dataComplete) parts.push({ score: b.growth.score, weight: 0.10 });
  if (b.profitability.dataComplete) parts.push({ score: b.profitability.score, weight: 0.08 });
  if (b.insider.dataComplete) parts.push({ score: b.insider.score, weight: 0.05 });
  if (b.analyst.dataComplete) parts.push({ score: b.analyst.score, weight: 0.05 });
  const wFundamentals = parts.reduce((a, p) => a + p.weight, 0);
  if (wFundamentals === 0) return { composite: priceComposite, adjustment: 0, weightUsed: 0 };
  const fundScore = parts.reduce((a, p) => a + p.score * p.weight, 0) / wFundamentals;
  const wPrice = 1 - wFundamentals;
  const blended = priceComposite * wPrice + fundScore * wFundamentals;
  return { composite: blended, adjustment: blended - priceComposite, weightUsed: wFundamentals };
}
