// Nasdaq official index fallback.
//
// Purpose: keep NDX from ever going blank when Yahoo throttles the Worker
// egress IP. Yahoo remains the primary source for index data, but Nasdaq's
// public quote/history endpoints are a second independent, keyless source for
// NASDAQ-100 (`NDX`) specifically.

import type { Bar } from "./market.server";
import type { Quote } from "./quote.server";

type NasdaqHistoryRow = {
  date?: string;
  close?: string;
  volume?: string;
  open?: string;
  high?: string;
  low?: string;
};

type NasdaqHistoryJson = {
  data?: {
    tradesTable?: {
      rows?: NasdaqHistoryRow[];
    };
  } | null;
  status?: { rCode?: number };
};

type NasdaqInfoJson = {
  data?: {
    symbol?: string;
    primaryData?: {
      lastSalePrice?: string;
      netChange?: string;
      percentageChange?: string;
      lastTradeTimestamp?: string;
    };
    keyStats?: {
      previousclose?: { value?: string };
    };
  } | null;
  status?: { rCode?: number };
};

const NASDAQ_SUPPORTED_INDEXES = new Set(["NDX"]);

function supportsNasdaqIndex(symbol: string): boolean {
  return NASDAQ_SUPPORTED_INDEXES.has(symbol.toUpperCase());
}

function numberFromNasdaq(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isoFromNasdaqDate(value: string | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Origin: "https://www.nasdaq.com",
        Referer: "https://www.nasdaq.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`Nasdaq HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchNasdaqIndexDaily(symbol: string, maxBars = 5000): Promise<Bar[]> {
  const sym = symbol.toUpperCase();
  if (!supportsNasdaqIndex(sym)) return [];

  const to = new Date();
  const from = new Date(to);
  const yearsBack = maxBars <= 400 ? 3 : maxBars <= 1500 ? 8 : 35;
  from.setUTCFullYear(from.getUTCFullYear() - yearsBack);

  const url = new URL(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/historical`);
  url.searchParams.set("assetclass", "index");
  url.searchParams.set("fromdate", ymd(from));
  url.searchParams.set("todate", ymd(to));
  url.searchParams.set("limit", String(Math.min(10_000, Math.max(300, maxBars * 2))));

  const j = await fetchJson<NasdaqHistoryJson>(url.toString());
  const rows = j.data?.tradesTable?.rows ?? [];
  const bars: Bar[] = [];
  for (const row of rows) {
    const datetime = isoFromNasdaqDate(row.date);
    const open = numberFromNasdaq(row.open);
    const high = numberFromNasdaq(row.high);
    const low = numberFromNasdaq(row.low);
    const close = numberFromNasdaq(row.close);
    if (!datetime || open == null || high == null || low == null || close == null) continue;
    const volume = numberFromNasdaq(row.volume);
    bars.push({
      datetime,
      open,
      high,
      low,
      close,
      volume: volume ?? undefined,
    });
  }

  // Nasdaq returns newest-first; scanner/deep-history helpers expect ascending
  // here so callers can reverse only when they need newest-first.
  return bars.sort((a, b) => a.datetime.localeCompare(b.datetime)).slice(-maxBars);
}

export async function fetchNasdaqIndexQuote(symbol: string): Promise<Quote | null> {
  const sym = symbol.toUpperCase();
  if (!supportsNasdaqIndex(sym)) return null;

  try {
    const url = new URL(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info`);
    url.searchParams.set("assetclass", "index");
    const j = await fetchJson<NasdaqInfoJson>(url.toString(), 5_000);
    const primary = j.data?.primaryData;
    const price = numberFromNasdaq(primary?.lastSalePrice);
    if (price == null || price <= 0) throw new Error(`Nasdaq invalid quote for ${sym}`);
    const change = numberFromNasdaq(primary?.netChange);
    const changePct = numberFromNasdaq(primary?.percentageChange);
    const previousClose =
      numberFromNasdaq(j.data?.keyStats?.previousclose?.value) ??
      (change != null ? price - change : null);
    return {
      symbol: sym,
      price,
      open: null,
      previousClose,
      change,
      changePct,
      ts: Date.now(),
    };
  } catch {
    const bars = await fetchNasdaqIndexDaily(sym, 10);
    const latest = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    if (!latest) return null;
    const change = prev ? latest.close - prev.close : null;
    return {
      symbol: sym,
      price: latest.close,
      open: latest.open,
      previousClose: prev?.close ?? null,
      change,
      changePct: prev && prev.close !== 0 ? (change! / prev.close) * 100 : null,
      ts: Date.now(),
    };
  }
}

export async function fetchNasdaqIndexQuoteBatch(symbols: string[]): Promise<Record<string, Quote>> {
  const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase()).filter(supportsNasdaqIndex)));
  const results = await Promise.all(wanted.map(async (s) => [s, await fetchNasdaqIndexQuote(s)] as const));
  const out: Record<string, Quote> = {};
  for (const [s, q] of results) if (q) out[s] = q;
  return out;
}