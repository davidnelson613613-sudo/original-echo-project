// Client-safe metadata for the FRED starter series list. Kept out of
// `.server.ts` files so the UI can import it without pulling server-only code
// into the client bundle.

export type FredSeriesMeta = {
  series_id: string;
  label: string;
  frequency: "d" | "w" | "m" | "q";
  available_from: string;
  category: string;
};

export const FRED_STARTER_SERIES: FredSeriesMeta[] = [
  { series_id: "DGS10",        label: "10Y Treasury Yield",          frequency: "d", available_from: "1962-01-02", category: "rates" },
  { series_id: "DGS2",         label: "2Y Treasury Yield",           frequency: "d", available_from: "1976-06-01", category: "rates" },
  { series_id: "DGS3MO",       label: "3M Treasury Yield",           frequency: "d", available_from: "1981-09-01", category: "rates" },
  { series_id: "T10Y2Y",       label: "10Y - 2Y Spread",             frequency: "d", available_from: "1976-06-01", category: "rates" },
  { series_id: "T10Y3M",       label: "10Y - 3M Spread",             frequency: "d", available_from: "1982-01-04", category: "rates" },
  { series_id: "BAMLH0A0HYM2", label: "High Yield OAS Spread",       frequency: "d", available_from: "1996-12-31", category: "credit" },
  { series_id: "BAMLC0A0CM",   label: "IG Corporate OAS Spread",     frequency: "d", available_from: "1996-12-31", category: "credit" },
  { series_id: "VIXCLS",       label: "CBOE VIX",                    frequency: "d", available_from: "1990-01-02", category: "stress" },
  { series_id: "DTWEXBGS",     label: "Broad Dollar Index",          frequency: "d", available_from: "2006-01-02", category: "cross_asset" },
  { series_id: "UNRATE",       label: "Unemployment Rate",           frequency: "m", available_from: "1948-01-01", category: "macro" },
  { series_id: "CPIAUCSL",     label: "CPI All Urban Consumers",     frequency: "m", available_from: "1947-01-01", category: "macro" },
  { series_id: "INDPRO",       label: "Industrial Production Index", frequency: "m", available_from: "1919-01-01", category: "macro" },
  { series_id: "PAYEMS",       label: "Nonfarm Payrolls",            frequency: "m", available_from: "1939-01-01", category: "macro" },
  { series_id: "HOUST",        label: "Housing Starts",              frequency: "m", available_from: "1959-01-01", category: "macro" },
  { series_id: "UMCSENT",      label: "UMich Consumer Sentiment",    frequency: "m", available_from: "1978-01-01", category: "macro" },
  { series_id: "M2SL",         label: "M2 Money Supply",             frequency: "m", available_from: "1959-01-01", category: "macro" },
  { series_id: "GDPC1",        label: "Real GDP",                    frequency: "q", available_from: "1947-01-01", category: "macro" },
];
