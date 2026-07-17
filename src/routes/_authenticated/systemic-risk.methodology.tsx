import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { FRED_STARTER_SERIES } from "@/lib/market-data/fred-series";

export const Route = createFileRoute("/_authenticated/systemic-risk/methodology")({
  head: () => ({
    meta: [
      { title: "Systemic Risk — Methodology" },
      { name: "description", content: "Architecture, data sources, features, models, and known limitations of the Systemic Risk Intelligence Engine." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MethodologyPage,
});

function MethodologyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <Link to="/systemic-risk/v2" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Engine
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing in this engine is a black box. Every number on the dashboard traces back to raw historical data via
          reproducible calculations described below.
        </p>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Architecture</h2>
          <pre className="mt-3 overflow-x-auto rounded-md border bg-muted p-4 text-xs">{`FRED / Yahoo / Treasury  ──▶  market_series  (long-format raw store)
                                       │
                                       ▼
                          computeFeatureVector(date)
                                       │
                                       ▼
                          market_features  (normalized fingerprint)
                                       │
                    ┌──────────┬───────┴──────┬────────────┐
                    ▼          ▼              ▼            ▼
              Yield Curve   Credit        Volatility     Macro
                Model        Model          Model        Model
                                       │
                       Cross-Asset  +  Breadth
                                       │
                                       ▼
                          Composite  (weighted mean by data confidence)
                                       │
                                       ▼
                   systemic_risk_v2_snapshots  (persisted)
                                       │
                                       ▼
                        Historical Analog Matcher
                                (top-K similar dates)`}</pre>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Data Sources</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
            <li><b>FRED</b> — {FRED_STARTER_SERIES.length} macro / rates / credit / vol / cross-asset series (1919→today depending on series)</li>
            <li><b>Yahoo Finance</b> — equity price history (already integrated for analog scanner; wired in via existing yahoo.server.ts)</li>
            <li><b>SEC EDGAR</b> — fundamentals cache (already integrated)</li>
            <li><b>U.S. Treasury / BLS / BEA</b> — accessible via FRED aliases; direct connectors are plug-in points for later phases</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Feature Library ({FRED_STARTER_SERIES.length} raw series → 16 normalized features)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each feature is stored raw + z-score (expanding window) + long-history percentile. See <code>src/lib/market-data/features.server.ts</code> for the canonical definitions.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Ensemble Models</h2>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm">
            <li><b>Yield Curve Stress</b> — 2s10s + 3m10y inversion depth (percentile-inverted, since lower spread = higher risk)</li>
            <li><b>Credit Stress</b> — HY OAS level + 3-month change + IG OAS level</li>
            <li><b>Volatility Regime</b> — VIX spot + 21-day mean</li>
            <li><b>Macro Deterioration</b> — Unemployment Δ + IP/Payrolls/Housing YoY + Sentiment + CPI YoY</li>
            <li><b>Cross-Asset Divergence</b> — USD 3m change + 10Y real rate</li>
            <li><b>Breadth Deterioration</b> — fraction of features in the top decile of risk</li>
          </ol>
          <p className="mt-2 text-sm text-muted-foreground">
            Each model outputs 0–100 with per-driver reasoning. The composite is a data-confidence-weighted mean of all six models.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Regime Levels</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
            <li>0–20 <b>Healthy</b> · 20–35 <b>Improving</b> · 35–50 <b>Neutral</b></li>
            <li>50–65 <b>Elevated Risk</b> · 65–80 <b>High Risk</b> · 80–100 <b>Severe Historical Risk</b></li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Historical Analog Matching</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Today's 16-dim normalized risk vector is compared against monthly anchors from 1962 onward. Similarity =
            1 − mean absolute per-feature risk difference. Top matches are annotated with the historical event covering
            that date (if any), the features that agree, and the features that disagree.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Validation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            See <Link to="/systemic-risk/validation" className="underline">the Validation page</Link> — precision / recall /
            F1 vs. historical bear markets, per-event lead time, and a reliability diagram (predicted decile vs. realized 12-month event rate).
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Known Limitations</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
            <li>Credit spreads (HY/IG OAS) start in 1996 — analogs before that use price/rate features only.</li>
            <li>VIX starts in 1990 — pre-1990 volatility analogs synthesized from realized vol on price data (roadmap item).</li>
            <li>Pre-1970 events (Great Depression, WWII shocks, 1966 credit crunch) are cataloged but have low-confidence
                analog fits because the required credit/vol features do not exist for that era.</li>
            <li>The composite currently reads FRED only; equity breadth, sector rotation, and international coherence
                features are Phase 7+ additions (they plug into <code>FEATURE_DEFS</code> without engine changes).</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-medium">Roadmap</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
            <li>Equity market-structure features (SPY drawdown, 200d breadth, sector dispersion) via Yahoo/Stooq.</li>
            <li>Regime-classifier model (HMM/GMM) as a 7th ensemble member.</li>
            <li>Logistic-regression composite weight learning against forward-drawdown labels.</li>
            <li>International coherence block (EM vs DM, EU rates).</li>
            <li>Nightly cron wiring for <code>/api/public/hooks/compute-risk</code> via pg_cron.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
