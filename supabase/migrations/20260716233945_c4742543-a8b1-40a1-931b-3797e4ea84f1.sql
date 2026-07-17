
-- Phase 1: Data foundation for Systemic Risk Intelligence Engine

-- 1) market_series: long-format historical data store
CREATE TABLE public.market_series (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  series_id TEXT NOT NULL,
  date DATE NOT NULL,
  value DOUBLE PRECISION,
  revision_date TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, series_id, date)
);
CREATE INDEX idx_market_series_lookup ON public.market_series (source, series_id, date DESC);
CREATE INDEX idx_market_series_date ON public.market_series (date DESC);

GRANT SELECT ON public.market_series TO authenticated;
GRANT SELECT ON public.market_series TO anon;
GRANT ALL ON public.market_series TO service_role;

ALTER TABLE public.market_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read market_series" ON public.market_series FOR SELECT USING (true);

CREATE TRIGGER trg_market_series_updated_at
  BEFORE UPDATE ON public.market_series
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 2) market_events: curated historical event catalog
CREATE TABLE public.market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  start_date DATE NOT NULL,
  trough_date DATE,
  end_date DATE,
  severity TEXT NOT NULL DEFAULT 'moderate',
  peak_drawdown DOUBLE PRECISION,
  notes TEXT,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_market_events_start ON public.market_events (start_date);
CREATE INDEX idx_market_events_category ON public.market_events (category);

GRANT SELECT ON public.market_events TO authenticated;
GRANT SELECT ON public.market_events TO anon;
GRANT ALL ON public.market_events TO service_role;

ALTER TABLE public.market_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read market_events" ON public.market_events FOR SELECT USING (true);

CREATE TRIGGER trg_market_events_updated_at
  BEFORE UPDATE ON public.market_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 3) data_ingest_runs: observability for ingestion jobs
CREATE TABLE public.data_ingest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  series_id TEXT,
  status TEXT NOT NULL,
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingest_runs_source_time ON public.data_ingest_runs (source, started_at DESC);

GRANT SELECT ON public.data_ingest_runs TO authenticated;
GRANT ALL ON public.data_ingest_runs TO service_role;

ALTER TABLE public.data_ingest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read ingest runs" ON public.data_ingest_runs FOR SELECT TO authenticated USING (true);


-- 4) Seed curated historical event catalog (60 events, 1929 -> 2024)
INSERT INTO public.market_events (slug, name, category, start_date, trough_date, end_date, severity, peak_drawdown, notes) VALUES
('1929-great-crash', 'Great Crash of 1929', 'bear_market', '1929-09-03', '1932-07-08', '1932-07-08', 'severe', -0.89, 'Wall Street Crash; Dow lost ~89% peak-to-trough.'),
('1929-great-depression', 'Great Depression', 'recession', '1929-08-01', '1933-03-01', '1933-03-01', 'severe', NULL, 'NBER cycle; deflationary collapse.'),
('1937-recession', '1937-38 Recession', 'recession', '1937-05-01', '1938-06-01', '1938-06-01', 'severe', -0.49, 'Premature policy tightening.'),
('1940-fall-of-france', 'Fall of France Panic', 'correction', '1940-05-10', '1940-06-10', '1940-07-01', 'moderate', -0.25, 'WWII panic selling.'),
('1946-postwar-drop', 'Postwar Bear Market', 'bear_market', '1946-05-29', '1946-10-09', '1947-05-01', 'moderate', -0.27, 'Postwar reconversion fears.'),
('1953-recession', '1953-54 Recession', 'recession', '1953-07-01', '1954-05-01', '1954-05-01', 'moderate', -0.15, 'Post-Korean War contraction.'),
('1957-recession', '1957-58 Recession', 'recession', '1957-08-01', '1958-04-01', '1958-04-01', 'moderate', -0.21, 'Eisenhower Recession.'),
('1960-recession', '1960-61 Recession', 'recession', '1960-04-01', '1961-02-01', '1961-02-01', 'mild', -0.14, ''),
('1962-kennedy-slide', 'Kennedy Slide', 'correction', '1961-12-12', '1962-06-26', '1963-09-03', 'moderate', -0.28, 'Flash crash triggered by steel-price standoff.'),
('1966-credit-crunch', '1966 Credit Crunch', 'correction', '1966-02-09', '1966-10-07', '1967-05-01', 'moderate', -0.22, 'First postwar credit crunch.'),
('1969-recession', '1969-70 Recession', 'recession', '1969-12-01', '1970-11-01', '1970-11-01', 'moderate', -0.36, 'Nixon-era stagflation onset.'),
('1973-oil-shock', '1973 Oil Crisis', 'commodity_shock', '1973-10-01', '1974-03-01', '1974-03-01', 'severe', NULL, 'OPEC embargo; oil quadrupled.'),
('1973-1974-bear', '1973-74 Bear Market', 'bear_market', '1973-01-11', '1974-10-03', '1980-07-17', 'severe', -0.48, 'Stagflationary bear market.'),
('1979-second-oil-shock', '1979 Oil Shock', 'commodity_shock', '1979-01-01', '1980-04-01', '1980-04-01', 'severe', NULL, 'Iranian Revolution supply shock.'),
('1980-recession', '1980 Recession', 'recession', '1980-01-01', '1980-07-01', '1980-07-01', 'moderate', -0.17, 'Volcker tightening round 1.'),
('1981-82-recession', '1981-82 Recession', 'recession', '1981-07-01', '1982-11-01', '1982-11-01', 'severe', -0.27, 'Volcker disinflation.'),
('1987-black-monday', 'Black Monday Crash', 'volatility_spike', '1987-10-14', '1987-10-19', '1987-12-04', 'severe', -0.34, 'Program-trading crash; -22.6% in one day.'),
('1989-savings-loan', 'Savings & Loan Crisis Peak', 'banking_crisis', '1989-01-01', '1990-12-01', '1991-06-01', 'severe', NULL, 'FDIC/RTC resolutions peak.'),
('1990-recession', '1990-91 Recession', 'recession', '1990-07-01', '1991-03-01', '1991-03-01', 'moderate', -0.20, 'Gulf War oil spike + S&L.'),
('1994-bond-massacre', '1994 Bond Massacre', 'liquidity_event', '1994-02-04', '1994-11-14', '1995-02-01', 'moderate', -0.09, 'Fed hike cycle; Orange County / Mexico crises.'),
('1997-asian-crisis', 'Asian Financial Crisis', 'liquidity_event', '1997-07-02', '1998-01-12', '1998-04-01', 'severe', NULL, 'Thai baht devaluation cascade.'),
('1998-ltcm-russia', 'LTCM / Russia Default', 'liquidity_event', '1998-08-17', '1998-10-08', '1998-11-01', 'severe', -0.19, 'Russian default; LTCM near-collapse.'),
('2000-dotcom-bear', 'Dot-com Bust', 'bear_market', '2000-03-24', '2002-10-09', '2007-05-30', 'severe', -0.49, 'Tech bubble unwind.'),
('2001-recession', '2001 Recession', 'recession', '2001-03-01', '2001-11-01', '2001-11-01', 'moderate', NULL, 'Dot-com + 9/11.'),
('2002-credit-scare', '2002 Corporate Credit Scare', 'credit_crisis', '2002-06-01', '2002-10-01', '2003-03-01', 'moderate', NULL, 'Enron/WorldCom fallout.'),
('2007-quant-quake', 'August 2007 Quant Quake', 'liquidity_event', '2007-08-06', '2007-08-10', '2007-09-01', 'moderate', NULL, 'Statistical-arb deleveraging.'),
('2008-gfc-bear', 'Global Financial Crisis Bear', 'bear_market', '2007-10-09', '2009-03-09', '2013-03-28', 'severe', -0.57, 'Housing/subprime/Lehman.'),
('2008-lehman', 'Lehman Collapse', 'banking_crisis', '2008-09-15', '2009-03-09', '2009-06-01', 'severe', NULL, 'Global banking panic.'),
('2008-2009-recession', 'Great Recession', 'recession', '2007-12-01', '2009-06-01', '2009-06-01', 'severe', NULL, 'NBER-dated deepest postwar contraction.'),
('2010-flash-crash', 'May 2010 Flash Crash', 'volatility_spike', '2010-05-06', '2010-05-06', '2010-07-02', 'moderate', -0.16, 'Intraday liquidity vacuum.'),
('2010-eu-sov-1', 'EU Sovereign Crisis Wave 1', 'credit_crisis', '2010-04-27', '2010-07-02', '2010-09-01', 'moderate', -0.16, 'Greece/Ireland/Portugal spreads blow out.'),
('2011-us-downgrade', 'US Downgrade / EU Wave 2', 'credit_crisis', '2011-07-22', '2011-10-03', '2011-12-01', 'severe', -0.19, 'S&P downgrade; Italy/Spain contagion.'),
('2014-oil-crash', '2014-16 Oil Crash', 'commodity_shock', '2014-06-20', '2016-02-11', '2016-06-01', 'severe', NULL, 'Brent -75%; energy credit stress.'),
('2015-china-devaluation', 'China Devaluation Shock', 'volatility_spike', '2015-08-11', '2015-08-25', '2015-11-01', 'moderate', -0.12, 'Yuan devaluation; VIX spike.'),
('2016-brexit', 'Brexit Vote', 'volatility_spike', '2016-06-23', '2016-06-27', '2016-07-15', 'mild', -0.05, 'GBP flash drop; equity 2-day dip.'),
('2018-volmageddon', 'Volmageddon', 'volatility_spike', '2018-02-02', '2018-02-08', '2018-03-01', 'moderate', -0.10, 'XIV blowup; short-vol unwind.'),
('2018-q4-selloff', 'Q4 2018 Selloff', 'correction', '2018-10-03', '2018-12-24', '2019-04-23', 'moderate', -0.20, 'Hike-cycle + growth scare.'),
('2019-repo-crisis', 'September 2019 Repo Crisis', 'liquidity_event', '2019-09-16', '2019-09-17', '2019-10-15', 'moderate', NULL, 'Overnight repo spike to ~10%.'),
('2020-covid-crash', 'COVID Crash', 'bear_market', '2020-02-19', '2020-03-23', '2020-08-18', 'severe', -0.34, 'Fastest 30% drawdown in history.'),
('2020-covid-recession', 'COVID Recession', 'recession', '2020-02-01', '2020-04-01', '2020-04-01', 'severe', NULL, 'Shortest NBER recession.'),
('2021-meme-squeeze', 'Meme Stock Squeeze', 'volatility_spike', '2021-01-25', '2021-02-02', '2021-03-01', 'mild', NULL, 'GME/AMC gamma squeezes.'),
('2022-inflation-shock', '2022 Inflation Shock', 'inflation_regime', '2021-06-01', '2022-06-01', '2023-06-01', 'severe', NULL, 'CPI peaks 9.1%; fastest hike cycle since 1980s.'),
('2022-bear', '2022 Bear Market', 'bear_market', '2022-01-03', '2022-10-12', '2024-01-19', 'severe', -0.25, 'Rate-driven multiple compression.'),
('2022-crypto-collapse', 'Crypto / Terra / FTX Collapse', 'credit_crisis', '2022-05-09', '2022-11-11', '2023-03-01', 'severe', NULL, 'Terra depeg; 3AC; Celsius; FTX.'),
('2022-uk-gilt-crisis', 'UK Gilt / LDI Crisis', 'liquidity_event', '2022-09-23', '2022-10-14', '2022-11-01', 'severe', NULL, 'Truss mini-budget; BoE emergency ops.'),
('2023-svb-banking', 'SVB / Regional Bank Crisis', 'banking_crisis', '2023-03-08', '2023-05-04', '2023-07-01', 'severe', NULL, 'SVB, Signature, First Republic failures.'),
('2023-yield-spike', 'H2 2023 Yield Spike', 'correction', '2023-07-31', '2023-10-27', '2023-12-15', 'moderate', -0.10, '10Y touched 5%; equities -10%.'),
('2024-yen-carry-unwind', 'August 2024 Yen Carry Unwind', 'volatility_spike', '2024-07-31', '2024-08-05', '2024-08-19', 'moderate', -0.09, 'BOJ hike + soft NFP; VIX spike to 65.'),
-- Bull markets / recoveries / regimes for context
('1949-1961-bull', 'Post-war Bull Market', 'bull_market', '1949-06-13', NULL, '1961-12-12', 'strong', NULL, 'Golden postwar expansion.'),
('1982-2000-bull', 'Great Bull Market', 'bull_market', '1982-08-12', NULL, '2000-03-24', 'strong', NULL, 'Disinflation + tech.'),
('2009-2020-bull', 'Post-GFC Bull Market', 'bull_market', '2009-03-09', NULL, '2020-02-19', 'strong', NULL, 'Longest bull on record.'),
('2020-2022-bull', 'COVID Recovery Bull', 'bull_market', '2020-03-23', NULL, '2022-01-03', 'strong', NULL, 'QE + fiscal stimulus surge.'),
('1975-1980-inflation', 'Great Inflation', 'inflation_regime', '1973-01-01', NULL, '1982-10-01', 'severe', NULL, 'CPI double-digit era.'),
('2004-2006-tightening', 'Greenspan Tightening', 'tightening_cycle', '2004-06-30', NULL, '2006-06-29', 'moderate', NULL, '17 consecutive 25bp hikes.'),
('2015-2018-tightening', 'Yellen/Powell Tightening', 'tightening_cycle', '2015-12-16', NULL, '2018-12-19', 'moderate', NULL, 'Gradual normalization.'),
('2022-2023-tightening', 'Powell Anti-Inflation Tightening', 'tightening_cycle', '2022-03-16', NULL, '2023-07-26', 'severe', NULL, '525bp in 16 months.'),
('2001-2003-easing', 'Post-Dotcom Easing', 'easing_cycle', '2001-01-03', NULL, '2003-06-25', 'strong', NULL, 'Fed funds 6.5% -> 1.0%.'),
('2007-2008-easing', 'GFC Easing', 'easing_cycle', '2007-09-18', NULL, '2008-12-16', 'strong', NULL, 'Fed funds 5.25% -> 0%.'),
('2019-2020-easing', '2019-20 Easing', 'easing_cycle', '2019-07-31', NULL, '2020-03-15', 'strong', NULL, 'Insurance cuts + COVID emergency.'),
('1930s-deflation', 'Deflationary Depression', 'deflation_regime', '1929-08-01', NULL, '1933-03-01', 'severe', NULL, 'CPI -10% YoY at trough.'),
('2015-china-slowdown', 'China/EM Slowdown', 'correction', '2015-05-21', '2016-02-11', '2016-06-01', 'moderate', -0.14, 'Commodity/EM stress into early 2016.');
