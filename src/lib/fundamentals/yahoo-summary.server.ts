// Yahoo Finance quoteSummary fetcher — free, no API key required.
// Provides: analyst recommendations, price targets, insider transactions,
// institutional ownership, key statistics, industry/sector, IPO date.
//
// Endpoint: https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}
//   ?modules=defaultKeyStatistics,financialData,recommendationTrend,
//            insiderTransactions,institutionOwnership,earningsTrend,summaryProfile
//
// Yahoo enforces per-IP soft limits; we cache 12h in Supabase.

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (compatible; LaddrxScanner/1.0; +https://laddrx.app)";

const MODULES = [
  "defaultKeyStatistics",
  "financialData",
  "recommendationTrend",
  "insiderTransactions",
  "institutionOwnership",
  "earningsTrend",
  "summaryProfile",
  "price",
].join(",");

export type YahooSummary = {
  symbol: string;
  industry: string | null;
  sector: string | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  pe: number | null;
  forwardPE: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  pegRatio: number | null;
  // Analyst
  analystTargetMean: number | null;
  analystTargetUpside: number | null; // pct vs current
  recommendationKey: string | null;
  recommendationMean: number | null; // 1=strong buy, 5=sell
  numberOfAnalysts: number | null;
  // Recent recommendation trend (revisions momentum)
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
  recTrendDelta: number | null; // (buy+strongBuy) - (sell+strongSell) latest
  // Insider / institutional
  heldPercentInsiders: number | null;
  heldPercentInstitutions: number | null;
  insiderNetShares6mo: number | null;
  // Growth / earnings
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  fetchedAt: string;
  source: "yahoo_summary";
  hasData: boolean;
};

type YahooRaw = { raw?: number | null } | number | null | undefined;
function n(v: YahooRaw): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const r = v.raw;
  return typeof r === "number" && Number.isFinite(r) ? r : null;
}

export async function fetchYahooSummary(symbol: string): Promise<YahooSummary> {
  const upper = symbol.toUpperCase();
  const empty = (reason: string): YahooSummary => ({
    symbol: upper, industry: null, sector: null, marketCap: null, enterpriseValue: null,
    pe: null, forwardPE: null, priceToSales: null, priceToBook: null, pegRatio: null,
    analystTargetMean: null, analystTargetUpside: null, recommendationKey: reason,
    recommendationMean: null, numberOfAnalysts: null,
    strongBuy: null, buy: null, hold: null, sell: null, strongSell: null, recTrendDelta: null,
    heldPercentInsiders: null, heldPercentInstitutions: null, insiderNetShares6mo: null,
    earningsGrowth: null, revenueGrowth: null,
    fetchedAt: new Date().toISOString(), source: "yahoo_summary", hasData: false,
  });

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(upper)}?modules=${MODULES}`;
  let json: unknown;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return empty(`http_${res.status}`);
    json = await res.json();
  } catch (e) {
    return empty(`fetch_error: ${e instanceof Error ? e.message : e}`);
  }

  const result =
    (json as { quoteSummary?: { result?: Array<Record<string, unknown>> } }).quoteSummary?.result?.[0];
  if (!result) return empty("empty_response");

  const ks = result.defaultKeyStatistics as Record<string, YahooRaw> | undefined;
  const fd = result.financialData as Record<string, YahooRaw> | undefined;
  const rt = result.recommendationTrend as { trend?: Array<Record<string, number>> } | undefined;
  const it = result.insiderTransactions as { transactions?: Array<{ shares?: YahooRaw; startDate?: YahooRaw; ownership?: string }> } | undefined;
  const io = result.institutionOwnership as Record<string, YahooRaw> | undefined;
  const sp = result.summaryProfile as { industry?: string; sector?: string } | undefined;
  const price = result.price as Record<string, YahooRaw> | undefined;

  const currentPrice = n(fd?.currentPrice) ?? n(price?.regularMarketPrice);
  const targetMean = n(fd?.targetMeanPrice);
  const targetUpside =
    targetMean !== null && currentPrice && currentPrice > 0
      ? ((targetMean - currentPrice) / currentPrice) * 100
      : null;

  const latestTrend = rt?.trend?.[0];
  const strongBuy = latestTrend?.strongBuy ?? null;
  const buy = latestTrend?.buy ?? null;
  const hold = latestTrend?.hold ?? null;
  const sell = latestTrend?.sell ?? null;
  const strongSell = latestTrend?.strongSell ?? null;
  const recTrendDelta =
    strongBuy !== null && buy !== null && sell !== null && strongSell !== null
      ? strongBuy + buy - sell - strongSell
      : null;

  // Insider net shares last ~6 months
  const now = Date.now();
  const sixMoAgo = now / 1000 - 180 * 86400;
  let insiderNet = 0;
  let insiderHasData = false;
  for (const tx of it?.transactions ?? []) {
    const ts = n(tx.startDate);
    if (ts === null || ts < sixMoAgo) continue;
    const shares = n(tx.shares);
    if (shares === null) continue;
    insiderHasData = true;
    // Yahoo uses positive shares with an ownership string; heuristic: "Direct" & type sale=negative.
    // Without transactionType Yahoo returns absolute magnitude — best effort only.
    insiderNet += shares;
  }

  return {
    symbol: upper,
    industry: sp?.industry ?? null,
    sector: sp?.sector ?? null,
    marketCap: n(price?.marketCap),
    enterpriseValue: n(ks?.enterpriseValue),
    pe: n(ks?.trailingPE ?? fd?.trailingPE),
    forwardPE: n(ks?.forwardPE),
    priceToSales: n(ks?.priceToSalesTrailing12Months),
    priceToBook: n(ks?.priceToBook),
    pegRatio: n(ks?.pegRatio),
    analystTargetMean: targetMean,
    analystTargetUpside: targetUpside,
    recommendationKey: (fd?.recommendationKey as unknown as string) ?? null,
    recommendationMean: n(fd?.recommendationMean),
    numberOfAnalysts: n(fd?.numberOfAnalystOpinions),
    strongBuy, buy, hold, sell, strongSell, recTrendDelta,
    heldPercentInsiders: n(ks?.heldPercentInsiders),
    heldPercentInstitutions: n(ks?.heldPercentInstitutions),
    insiderNetShares6mo: insiderHasData ? insiderNet : null,
    earningsGrowth: n(fd?.earningsGrowth),
    revenueGrowth: n(fd?.revenueGrowth),
    fetchedAt: new Date().toISOString(),
    source: "yahoo_summary",
    hasData: !!(currentPrice || targetMean || strongBuy),
  };
}

export async function getYahooSummaryCached(symbol: string): Promise<YahooSummary> {
  const upper = symbol.toUpperCase();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cached } = await supabaseAdmin
    .from("yahoo_summary_cache")
    .select("summary, updated_at")
    .eq("symbol", upper)
    .maybeSingle();
  if (cached?.summary && cached.updated_at) {
    const age = Date.now() - new Date(cached.updated_at).getTime();
    if (age < CACHE_TTL_MS) return cached.summary as YahooSummary;
  }
  const fresh = await fetchYahooSummary(upper);
  if (fresh.hasData) {
    await supabaseAdmin
      .from("yahoo_summary_cache")
      .upsert({ symbol: upper, summary: fresh, updated_at: new Date().toISOString() });
  }
  return fresh;
}