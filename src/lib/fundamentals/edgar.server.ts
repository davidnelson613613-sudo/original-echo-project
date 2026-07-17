// SEC EDGAR Company Facts fetcher — official, free, no API key.
// Docs: https://www.sec.gov/edgar/sec-api-documentation
// Endpoint: https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json
//
// Provides quarterly + annual fundamentals for every US-listed filer:
// revenue, net income, gross/operating margin, FCF, cash, debt, shares.
// This is the gold standard for free US fundamentals data.
//
// SEC requires a descriptive User-Agent with contact info per their
// fair-access policy: https://www.sec.gov/os/accessing-edgar-data

const SEC_UA = "LaddrxScanner/1.0 (contact@laddrx.app)";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type EdgarFundamentals = {
  symbol: string;
  cik: string;
  entityName: string;
  // Trailing-twelve-months and multi-year derived metrics
  revenueTTM: number | null;
  revenueYoYPct: number | null;
  revenue3yCagrPct: number | null;
  revenueAcceleratingPct: number | null; // latest YoY - prior YoY
  netIncomeTTM: number | null;
  epsTTM: number | null;
  epsYoYPct: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  fcfTTM: number | null;
  fcfMarginPct: number | null;
  cash: number | null;
  totalDebt: number | null;
  sharesOutstanding: number | null;
  shareDilution3yPct: number | null; // positive = dilutive
  ruleOf40: number | null; // revenue growth + FCF margin
  fetchedAt: string;
  source: "sec_edgar";
  hasData: boolean;
};

// SEC maintains a ticker→CIK map at this URL (small, ~1MB, cached in memory).
const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
let tickerCache: Map<string, string> | null = null;
let tickerCacheAt = 0;

async function loadTickerMap(): Promise<Map<string, string>> {
  if (tickerCache && Date.now() - tickerCacheAt < CACHE_TTL_MS) return tickerCache;
  const res = await fetch(TICKER_MAP_URL, { headers: { "User-Agent": SEC_UA } });
  if (!res.ok) throw new Error(`SEC ticker map HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
  const map = new Map<string, string>();
  for (const v of Object.values(json)) {
    map.set(v.ticker.toUpperCase(), String(v.cik_str).padStart(10, "0"));
  }
  tickerCache = map;
  tickerCacheAt = Date.now();
  return map;
}

type FactUnit = { end: string; val: number; fy?: number; fp?: string; form?: string };
type CompanyFacts = {
  cik: number;
  entityName: string;
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, FactUnit[]> }>;
  };
};

function pickUnits(facts: CompanyFacts, concept: string): FactUnit[] {
  const c = facts.facts?.["us-gaap"]?.[concept];
  if (!c?.units) return [];
  // Prefer USD; some concepts use USD/shares or shares.
  const units = c.units.USD ?? c.units["USD/shares"] ?? c.units.shares ?? [];
  // Only 10-Q / 10-K filings; sort ascending by end date.
  return units
    .filter((u) => u.form === "10-Q" || u.form === "10-K")
    .sort((a, b) => a.end.localeCompare(b.end));
}

function firstConcept(facts: CompanyFacts, concepts: string[]): FactUnit[] {
  for (const c of concepts) {
    const u = pickUnits(facts, c);
    if (u.length) return u;
  }
  return [];
}

// Sum the four most recent non-overlapping quarterly values ending on/before `asOf`.
function ttm(units: FactUnit[]): number | null {
  if (units.length === 0) return null;
  // Take last 4 quarterly points (10-Q). If only annual (10-K) available, use latest.
  const quarterly = units.filter((u) => u.form === "10-Q");
  if (quarterly.length >= 4) {
    const last4 = quarterly.slice(-4);
    return last4.reduce((a, b) => a + b.val, 0);
  }
  const annual = units.filter((u) => u.form === "10-K");
  if (annual.length) return annual[annual.length - 1].val;
  return null;
}

function yoy(units: FactUnit[]): number | null {
  const q = units.filter((u) => u.form === "10-Q");
  if (q.length < 8) return null;
  const cur4 = q.slice(-4).reduce((a, b) => a + b.val, 0);
  const prev4 = q.slice(-8, -4).reduce((a, b) => a + b.val, 0);
  if (prev4 === 0) return null;
  return ((cur4 - prev4) / Math.abs(prev4)) * 100;
}

function threeYearCagr(units: FactUnit[]): number | null {
  const annual = units.filter((u) => u.form === "10-K").sort((a, b) => a.end.localeCompare(b.end));
  if (annual.length < 4) return null;
  const last = annual[annual.length - 1].val;
  const three = annual[annual.length - 4].val;
  if (three <= 0 || last <= 0) return null;
  return (Math.pow(last / three, 1 / 3) - 1) * 100;
}

function latestValue(units: FactUnit[]): number | null {
  if (!units.length) return null;
  return units[units.length - 1].val;
}

export async function fetchEdgarFundamentals(symbol: string): Promise<EdgarFundamentals> {
  const upper = symbol.toUpperCase();
  const empty = (reason: string): EdgarFundamentals => ({
    symbol: upper, cik: "", entityName: reason,
    revenueTTM: null, revenueYoYPct: null, revenue3yCagrPct: null, revenueAcceleratingPct: null,
    netIncomeTTM: null, epsTTM: null, epsYoYPct: null,
    grossMarginPct: null, operatingMarginPct: null, netMarginPct: null,
    fcfTTM: null, fcfMarginPct: null, cash: null, totalDebt: null,
    sharesOutstanding: null, shareDilution3yPct: null, ruleOf40: null,
    fetchedAt: new Date().toISOString(), source: "sec_edgar", hasData: false,
  });

  let cik: string;
  try {
    const map = await loadTickerMap();
    const found = map.get(upper);
    if (!found) return empty("not_in_sec_ticker_map");
    cik = found;
  } catch (e) {
    return empty(`ticker_map_error: ${e instanceof Error ? e.message : e}`);
  }

  let facts: CompanyFacts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": SEC_UA, Accept: "application/json" },
    });
    if (!res.ok) return empty(`edgar_http_${res.status}`);
    facts = (await res.json()) as CompanyFacts;
  } catch (e) {
    return empty(`edgar_fetch_error: ${e instanceof Error ? e.message : e}`);
  }

  const revenue = firstConcept(facts, [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
  ]);
  const netIncome = firstConcept(facts, ["NetIncomeLoss"]);
  const eps = firstConcept(facts, ["EarningsPerShareBasic", "EarningsPerShareDiluted"]);
  const grossProfit = firstConcept(facts, ["GrossProfit"]);
  const operatingIncome = firstConcept(facts, ["OperatingIncomeLoss"]);
  const cfo = firstConcept(facts, ["NetCashProvidedByUsedInOperatingActivities"]);
  const capex = firstConcept(facts, ["PaymentsToAcquirePropertyPlantAndEquipment"]);
  const cash = firstConcept(facts, ["CashAndCashEquivalentsAtCarryingValue", "Cash"]);
  const longDebt = firstConcept(facts, ["LongTermDebtNoncurrent", "LongTermDebt"]);
  const shortDebt = firstConcept(facts, ["ShortTermBorrowings", "DebtCurrent"]);
  const shares = firstConcept(facts, [
    "CommonStockSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingBasic",
  ]);

  const revenueTTM = ttm(revenue);
  const netIncomeTTM = ttm(netIncome);
  const fcfTTM = (() => {
    const c = ttm(cfo);
    const x = ttm(capex);
    if (c === null) return null;
    return c - (x ?? 0);
  })();
  const grossTTM = ttm(grossProfit);
  const opTTM = ttm(operatingIncome);

  const revYoY = yoy(revenue);
  const revYoYPrior = (() => {
    const q = revenue.filter((u) => u.form === "10-Q");
    if (q.length < 12) return null;
    const cur4 = q.slice(-8, -4).reduce((a, b) => a + b.val, 0);
    const prev4 = q.slice(-12, -8).reduce((a, b) => a + b.val, 0);
    if (prev4 === 0) return null;
    return ((cur4 - prev4) / Math.abs(prev4)) * 100;
  })();

  const sharesLatest = latestValue(shares);
  const shares3yAgo = (() => {
    const annual = shares.filter((u) => u.form === "10-K");
    if (annual.length < 4) return null;
    return annual[annual.length - 4].val;
  })();

  const totalDebt = ((latestValue(longDebt) ?? 0) + (latestValue(shortDebt) ?? 0)) || null;

  const revenueYoYPct = revYoY;
  const fcfMarginPct = revenueTTM && fcfTTM !== null && revenueTTM > 0 ? (fcfTTM / revenueTTM) * 100 : null;

  return {
    symbol: upper,
    cik,
    entityName: facts.entityName ?? upper,
    revenueTTM,
    revenueYoYPct,
    revenue3yCagrPct: threeYearCagr(revenue),
    revenueAcceleratingPct:
      revYoY !== null && revYoYPrior !== null ? revYoY - revYoYPrior : null,
    netIncomeTTM,
    epsTTM: ttm(eps),
    epsYoYPct: yoy(eps),
    grossMarginPct: grossTTM && revenueTTM && revenueTTM > 0 ? (grossTTM / revenueTTM) * 100 : null,
    operatingMarginPct: opTTM !== null && revenueTTM && revenueTTM > 0 ? (opTTM / revenueTTM) * 100 : null,
    netMarginPct: netIncomeTTM !== null && revenueTTM && revenueTTM > 0 ? (netIncomeTTM / revenueTTM) * 100 : null,
    fcfTTM,
    fcfMarginPct,
    cash: latestValue(cash),
    totalDebt,
    sharesOutstanding: sharesLatest,
    shareDilution3yPct:
      sharesLatest && shares3yAgo ? ((sharesLatest - shares3yAgo) / shares3yAgo) * 100 : null,
    ruleOf40:
      revenueYoYPct !== null && fcfMarginPct !== null ? revenueYoYPct + fcfMarginPct : null,
    fetchedAt: new Date().toISOString(),
    source: "sec_edgar",
    hasData: revenueTTM !== null || netIncomeTTM !== null,
  };
}

// Cached wrapper: check Supabase cache first, fall back to live fetch, write-through.
export async function getEdgarFundamentalsCached(symbol: string): Promise<EdgarFundamentals> {
  const upper = symbol.toUpperCase();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: cached } = await supabaseAdmin
    .from("edgar_facts_cache")
    .select("facts, updated_at")
    .eq("symbol", upper)
    .maybeSingle();

  if (cached?.facts && cached.updated_at) {
    const age = Date.now() - new Date(cached.updated_at).getTime();
    if (age < CACHE_TTL_MS) return cached.facts as EdgarFundamentals;
  }

  const fresh = await fetchEdgarFundamentals(upper);
  if (fresh.hasData) {
    await supabaseAdmin
      .from("edgar_facts_cache")
      .upsert({ symbol: upper, cik: fresh.cik, facts: fresh, updated_at: new Date().toISOString() });
  }
  return fresh;
}