// Finnhub free-tier fundamentals fetcher.
//
// Uses the existing FINNHUB_API_KEY. Fetches:
//   • insider transactions (last 90d net $ flow)
//   • recommendation trend deltas (revisions up/down MoM)
//   • company news last 14d (headlines only)
//
// Free tier: ~60 calls/min. All results cached 6h in Supabase.

const BASE = "https://finnhub.io/api/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type FinnhubFundamentals = {
  symbol: string;
  // Insider
  insiderNetShares90d: number | null;
  insiderNetDollars90d: number | null;
  insiderBuyCount90d: number;
  insiderSellCount90d: number;
  // Recommendation trend delta (latest vs 1mo prior)
  recBuyDelta: number | null;
  recSellDelta: number | null;
  recCurrentBuy: number | null;
  recCurrentSell: number | null;
  // News
  newsHeadlines: string[]; // last 14d, max 20
  newsCount14d: number;
  fetchedAt: string;
  source: "finnhub";
  hasData: boolean;
};

async function fh<T>(path: string, key: string): Promise<T | null> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(key)}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchFinnhubFundamentals(symbol: string): Promise<FinnhubFundamentals> {
  const upper = symbol.toUpperCase();
  const key = process.env.FINNHUB_API_KEY;
  const now = new Date();
  const empty = (reason: string): FinnhubFundamentals => ({
    symbol: upper,
    insiderNetShares90d: null, insiderNetDollars90d: null,
    insiderBuyCount90d: 0, insiderSellCount90d: 0,
    recBuyDelta: null, recSellDelta: null, recCurrentBuy: null, recCurrentSell: null,
    newsHeadlines: [], newsCount14d: 0,
    fetchedAt: now.toISOString(), source: "finnhub", hasData: false,
  });
  if (!key) return empty("missing_key");

  const from90 = new Date(now.getTime() - 90 * 86400_000);
  const from14 = new Date(now.getTime() - 14 * 86400_000);

  const [insider, recs, news] = await Promise.all([
    fh<{ data?: Array<{ change?: number; transactionPrice?: number; transactionCode?: string; filingDate?: string }> }>(
      `/stock/insider-transactions?symbol=${upper}&from=${ymd(from90)}&to=${ymd(now)}`,
      key,
    ),
    fh<Array<{ buy: number; hold: number; sell: number; strongBuy: number; strongSell: number; period: string }>>(
      `/stock/recommendation?symbol=${upper}`,
      key,
    ),
    fh<Array<{ headline: string; datetime: number }>>(
      `/company-news?symbol=${upper}&from=${ymd(from14)}&to=${ymd(now)}`,
      key,
    ),
  ]);

  let netShares = 0;
  let netDollars = 0;
  let buys = 0;
  let sells = 0;
  let insiderHasData = false;
  for (const tx of insider?.data ?? []) {
    const chg = tx.change ?? 0;
    if (!Number.isFinite(chg)) continue;
    insiderHasData = true;
    netShares += chg;
    if (Number.isFinite(tx.transactionPrice ?? NaN) && tx.transactionPrice! > 0) {
      netDollars += chg * tx.transactionPrice!;
    }
    if (chg > 0) buys++;
    else if (chg < 0) sells++;
  }

  const sortedRecs = (recs ?? []).slice().sort((a, b) => (a.period > b.period ? -1 : 1));
  const cur = sortedRecs[0];
  const prior = sortedRecs[1];
  const recBuyDelta =
    cur && prior ? cur.buy + cur.strongBuy - (prior.buy + prior.strongBuy) : null;
  const recSellDelta =
    cur && prior ? cur.sell + cur.strongSell - (prior.sell + prior.strongSell) : null;

  const headlines = (news ?? [])
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 20)
    .map((h) => h.headline);

  return {
    symbol: upper,
    insiderNetShares90d: insiderHasData ? netShares : null,
    insiderNetDollars90d: insiderHasData && netDollars !== 0 ? netDollars : null,
    insiderBuyCount90d: buys,
    insiderSellCount90d: sells,
    recBuyDelta, recSellDelta,
    recCurrentBuy: cur ? cur.buy + cur.strongBuy : null,
    recCurrentSell: cur ? cur.sell + cur.strongSell : null,
    newsHeadlines: headlines,
    newsCount14d: news?.length ?? 0,
    fetchedAt: now.toISOString(),
    source: "finnhub",
    hasData: insiderHasData || !!cur || headlines.length > 0,
  };
}

export async function getFinnhubFundamentalsCached(symbol: string): Promise<FinnhubFundamentals> {
  const upper = symbol.toUpperCase();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cached } = await supabaseAdmin
    .from("finnhub_data_cache")
    .select("payload, updated_at")
    .eq("symbol", upper)
    .eq("kind", "fundamentals")
    .maybeSingle();
  if (cached?.payload && cached.updated_at) {
    const age = Date.now() - new Date(cached.updated_at).getTime();
    if (age < CACHE_TTL_MS) return cached.payload as FinnhubFundamentals;
  }
  const fresh = await fetchFinnhubFundamentals(upper);
  if (fresh.hasData) {
    await supabaseAdmin
      .from("finnhub_data_cache")
      .upsert({ symbol: upper, kind: "fundamentals", payload: fresh, updated_at: new Date().toISOString() });
  }
  return fresh;
}