// Curated historical systemic-risk events. Each event has a "onset" date
// (the widely-agreed-upon start of the acute phase) and a "peak_drawdown"
// date for the SPY/S&P 500 trough. Windows around these dates are used
// for pattern matching and backtesting.
//
// All dates and drawdown numbers are historical fact and independently
// verifiable. They are used ONLY to tag time windows for matching — the
// engine never "peeks" at them when scoring live data.

export type CrisisKind =
  | "bear_market"
  | "crash"
  | "credit_event"
  | "liquidity_crisis"
  | "banking_crisis"
  | "recession"
  | "flash_crash"
  | "commodity_shock"
  | "sovereign_debt";

export type CrisisEvent = {
  id: string;
  label: string;
  kind: CrisisKind;
  onset: string; // YYYY-MM-DD, first day of acute phase
  trough: string; // YYYY-MM-DD, S&P 500 low
  spx_dd_pct: number; // peak-to-trough drawdown, %
  data_start: string; // earliest date we have data-rich features for the pre-crisis period
  data_available_from: string; // earliest reliable multi-asset feature date
  notes: string;
};

// Windows we can reliably score (Yahoo/Stooq multi-asset coverage):
//   - SPY 1993+, ^VIX 1990+, sector ETFs 1998+, HYG 2007+, GLD 2004+,
//     TLT/IEF/SHY 2002+, IWM 2000+, UUP 2007+
// Events before ~1990 are listed for context but flagged as low-coverage;
// the scanner will not score them into today's analogs.
export const CRISIS_EVENTS: CrisisEvent[] = [
  {
    id: "great_depression",
    label: "Great Depression",
    kind: "crash",
    onset: "1929-10-24",
    trough: "1932-07-08",
    spx_dd_pct: -86,
    data_start: "1929-01-02",
    data_available_from: "1929-01-02",
    notes: "Only price/breadth features available; no cross-asset data.",
  },
  {
    id: "bear_1973_74",
    label: "1973–74 Bear Market",
    kind: "bear_market",
    onset: "1973-01-11",
    trough: "1974-10-03",
    spx_dd_pct: -48,
    data_start: "1972-01-03",
    data_available_from: "1972-01-03",
    notes: "Price-only features on S&P index available.",
  },
  {
    id: "crash_1987",
    label: "Black Monday 1987",
    kind: "crash",
    onset: "1987-10-14",
    trough: "1987-12-04",
    spx_dd_pct: -34,
    data_start: "1986-01-02",
    data_available_from: "1986-01-02",
    notes: "Price-only features; VIX begins 1990.",
  },
  {
    id: "sl_crisis",
    label: "Savings & Loan Crisis",
    kind: "banking_crisis",
    onset: "1989-06-01",
    trough: "1990-10-11",
    spx_dd_pct: -20,
    data_start: "1988-01-04",
    data_available_from: "1990-01-02",
    notes: "VIX becomes available late-1990.",
  },
  {
    id: "japan_bubble",
    label: "Japanese Asset Bubble",
    kind: "bear_market",
    onset: "1990-01-04",
    trough: "1992-08-18",
    spx_dd_pct: -20,
    data_start: "1989-01-03",
    data_available_from: "1990-01-02",
    notes: "Nikkei-driven; US indicators partially applicable.",
  },
  {
    id: "ltcm_1998",
    label: "LTCM / Asia Crisis",
    kind: "liquidity_crisis",
    onset: "1998-08-17",
    trough: "1998-10-08",
    spx_dd_pct: -19,
    data_start: "1997-01-02",
    data_available_from: "1997-01-02",
    notes: "VIX + SPY + sectors available; HY-spread proxy weak.",
  },
  {
    id: "dotcom",
    label: "Dot-com Bust",
    kind: "bear_market",
    onset: "2000-03-24",
    trough: "2002-10-09",
    spx_dd_pct: -49,
    data_start: "1999-01-04",
    data_available_from: "1999-01-04",
    notes: "Full sector + VIX; HY spread proxy weak (HYG starts 2007).",
  },
  {
    id: "gfc_precrisis",
    label: "GFC Pre-Crisis Warnings",
    kind: "credit_event",
    onset: "2007-06-01",
    trough: "2007-10-09",
    spx_dd_pct: -8,
    data_start: "2006-01-03",
    data_available_from: "2007-04-11",
    notes: "HYG begins Apr 2007. Full multi-asset from here on.",
  },
  {
    id: "gfc_2008",
    label: "Global Financial Crisis",
    kind: "banking_crisis",
    onset: "2008-09-15",
    trough: "2009-03-09",
    spx_dd_pct: -57,
    data_start: "2007-01-03",
    data_available_from: "2007-04-11",
    notes: "Full multi-asset coverage. Canonical training example.",
  },
  {
    id: "euro_debt_2011",
    label: "European Sovereign Debt",
    kind: "sovereign_debt",
    onset: "2011-07-22",
    trough: "2011-10-03",
    spx_dd_pct: -19,
    data_start: "2010-01-04",
    data_available_from: "2010-01-04",
    notes: "Full multi-asset coverage.",
  },
  {
    id: "china_2015_16",
    label: "China Devaluation / 2015-16 Correction",
    kind: "bear_market",
    onset: "2015-08-11",
    trough: "2016-02-11",
    spx_dd_pct: -15,
    data_start: "2014-01-02",
    data_available_from: "2014-01-02",
    notes: "Full multi-asset coverage.",
  },
  {
    id: "q4_2018",
    label: "2018 Q4 Fed Tightening",
    kind: "bear_market",
    onset: "2018-10-03",
    trough: "2018-12-24",
    spx_dd_pct: -20,
    data_start: "2017-01-03",
    data_available_from: "2017-01-03",
    notes: "Full multi-asset coverage.",
  },
  {
    id: "covid_2020",
    label: "COVID-19 Crash",
    kind: "crash",
    onset: "2020-02-19",
    trough: "2020-03-23",
    spx_dd_pct: -34,
    data_start: "2019-01-02",
    data_available_from: "2019-01-02",
    notes: "Fastest bear market on record.",
  },
  {
    id: "bear_2022",
    label: "2022 Inflation Bear",
    kind: "bear_market",
    onset: "2022-01-03",
    trough: "2022-10-12",
    spx_dd_pct: -25,
    data_start: "2021-01-04",
    data_available_from: "2021-01-04",
    notes: "Slow-motion bear driven by Fed hiking cycle.",
  },
  {
    id: "svb_2023",
    label: "SVB / Regional Banking Stress",
    kind: "banking_crisis",
    onset: "2023-03-08",
    trough: "2023-03-13",
    spx_dd_pct: -8,
    data_start: "2022-06-01",
    data_available_from: "2022-06-01",
    notes: "Brief but sharp liquidity shock in regional banks.",
  },
];

// Only these events feed the live analog matcher — earlier events lack
// cross-asset data and would corrupt today's fingerprint scoring.
export const ANALOG_ELIGIBLE_EVENTS = CRISIS_EVENTS.filter(
  (e) => e.data_available_from >= "1998-01-01",
);

export const CRISIS_KIND_LABELS: Record<CrisisKind, string> = {
  bear_market: "Prolonged Bear Market",
  crash: "Crash",
  credit_event: "Credit Event",
  liquidity_crisis: "Liquidity Crisis",
  banking_crisis: "Banking Crisis",
  recession: "Recession",
  flash_crash: "Flash Crash",
  commodity_shock: "Commodity Shock",
  sovereign_debt: "Sovereign Debt Crisis",
};
