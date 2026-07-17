import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { History, TrendingUp, TrendingDown, Minus, Loader2, AlertTriangle, CircleOff, CheckCircle2, Clock, Split, ChevronDown, ChevronRight, Database } from "lucide-react";
import { findHistoricalAnalog } from "@/lib/analog-search.functions";
import { buildProbabilityReport } from "@/lib/analog-probabilities";
import { buildWaitVsBuy } from "@/lib/wait-vs-buy";
import { buildScenarios } from "@/lib/analog-scenarios";
import { AnalogDisclaimer } from "@/components/AnalogDisclaimer";
import { useEffect, useState } from "react";
import { getIntradayAnalogProjection } from "@/lib/intraday-analog.functions";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

// Stability: remember what we've been showing so we don't flap between
// nearly-identical analogs. Only switch when a genuinely different date
// arrives with a materially better similarity.
type Memory = {
  displayedDate: string;
  displayedSimilarity: number;
  lastSeenBestDate: string;
  lastSeenSimilarity: number;
  switchedReason?: string;
};
const trendMemory = new Map<string, Memory>();
const SWITCH_MIN_DELTA = 3; // require +3 similarity to switch to a new analog

export function HistoricalAnalogPanel({ symbol, price }: { symbol: string; price: number }) {
  const fn = useServerFn(findHistoricalAnalog);
  const q = useQuery({
    queryKey: ["historical-analog", symbol],
    queryFn: () => fn({ data: { symbol } }),
    // In lockstep with the 60-second scanner cadence so the displayed
    // analog is always the best current match.
    staleTime: 55 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const [trend, setTrend] = useState<"new" | "same" | "switched" | "improving" | "weakening">("new");
  const [switchReason, setSwitchReason] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) return;
    if (q.data.status !== "ok") return;
    const r = q.data.result;
    const curDate = r.best.date;
    const curSim = r.best.similarity;
    const prev = trendMemory.get(symbol);
    if (!prev) {
      trendMemory.set(symbol, {
        displayedDate: curDate, displayedSimilarity: curSim,
        lastSeenBestDate: curDate, lastSeenSimilarity: curSim,
      });
      setTrend("new");
      setSwitchReason(null);
      return;
    }
    if (curDate === prev.displayedDate) {
      const delta = curSim - prev.displayedSimilarity;
      setTrend(delta > 3 ? "improving" : delta < -3 ? "weakening" : "same");
      setSwitchReason(null);
      trendMemory.set(symbol, {
        ...prev, displayedSimilarity: curSim,
        lastSeenBestDate: curDate, lastSeenSimilarity: curSim,
      });
    } else {
      // Different analog — only switch if it's meaningfully better.
      if (curSim - prev.displayedSimilarity >= SWITCH_MIN_DELTA) {
        // Reason: biggest similarity feature difference vs prior displayed
        const topFeat = r.strongestSimilarities[0]?.label ?? "overall shape";
        const reason = `Regime shifted — ${topFeat.toLowerCase()} now matches this period better (${curSim}% vs prior ${prev.displayedSimilarity}%).`;
        trendMemory.set(symbol, {
          displayedDate: curDate, displayedSimilarity: curSim,
          lastSeenBestDate: curDate, lastSeenSimilarity: curSim,
          switchedReason: reason,
        });
        setTrend("switched");
        setSwitchReason(reason);
      } else {
        // Stay on displayed analog but note churn
        setTrend("same");
        setSwitchReason(null);
        trendMemory.set(symbol, {
          ...prev,
          lastSeenBestDate: curDate, lastSeenSimilarity: curSim,
        });
      }
    }
  }, [q.data, symbol]);

  if (q.isLoading) {
    return (
      <Card className="border-violet-500/30 bg-[#0b0f1a]">
        <CardContent className="p-5 flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
          Searching {symbol}'s full price history for the closest analog…
        </CardContent>
      </Card>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card className="border-slate-800 bg-[#0b0f1a]">
        <CardContent className="p-5 text-xs font-mono text-slate-500">
          Historical analog unavailable for {symbol}.
        </CardContent>
      </Card>
    );
  }

  // Outcome-tagged response. Render distinct states for empty vs error.
  if (q.data.status === "error") {
    const label =
      q.data.reason === "no_keys"
        ? "Historical analog lookup disabled — no market-data key configured."
        : "Historical analog lookup unavailable — provider rate-limited or timed out. Will retry on the next scan.";
    return (
      <Card className="border-amber-500/30 bg-[#0b0f1a]">
        <CardContent className="p-5 flex items-start gap-2 text-xs font-mono text-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
          <span>{label}</span>
        </CardContent>
      </Card>
    );
  }
  if (q.data.status === "empty") {
    const label =
      q.data.reason === "insufficient_history"
        ? `Historical data for ${symbol} is temporarily unavailable (data provider returned no bars or rate-limited). The analog engine will retry on the next scan.`
        : q.data.reason === "insufficient_evidence"
          ? `Insufficient historical evidence for ${symbol}. Only ${q.data.sampleSize ?? "a few"} qualifying analog${(q.data.sampleSize ?? 0) === 1 ? "" : "s"} passed the quality gate — below the 4-match floor needed to report probabilities. Today's setup is either unusual for this name or the pool is too thin to be statistically meaningful.`
          : `No comparable historical dip found for ${symbol}. Today's setup does not resemble any prior pattern with meaningful confidence.`;
    return (
      <Card className="border-slate-700 bg-[#0b0f1a]">
        <CardContent className="p-5 flex items-start gap-2 text-xs font-mono text-slate-400">
          <CircleOff className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
          <span>{label}</span>
        </CardContent>
      </Card>
    );
  }

  const r = q.data.result;
  const dataSource = q.data.dataSource;
  const best = r.best;
  const agg = r.aggregate;
  const proj = r.projections;

  const TrendIcon = trend === "improving" ? TrendingUp : trend === "weakening" ? TrendingDown : Minus;
  const trendCls =
    trend === "improving" ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
    : trend === "weakening" ? "text-rose-300 border-rose-500/40 bg-rose-500/10"
    : trend === "switched" ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
    : "text-slate-300 border-slate-600 bg-slate-800/40";
  const trendText =
    trend === "new" ? "New analog"
    : trend === "switched" ? "New closer analog"
    : trend === "improving" ? "Match strengthening"
    : trend === "weakening" ? "Match weakening"
    : "Match stable";

  const bestDate = new Date(best.date);
  const dateLabel = bestDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  const bottomTypeLabel: Record<string, string> = {
    capitulation: "Capitulation",
    v_bottom: "V-Bottom",
    slow_bleed: "Slow bleed",
    double_bottom: "Double bottom",
    rounded: "Rounded",
    retest: "Retest",
    no_bottom: "No bottom",
  };
  const dominantBottom = (Object.entries(agg.bottomTypeDistribution) as [string, number][])
    .sort((a, b) => b[1] - a[1])[0];

  return (
    <Card className="border-violet-500/30 bg-gradient-to-br from-[#151425]/80 via-[#131a2b]/60 to-[#0b0f1a]">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-violet-300" />
            <span className="text-[10px] uppercase tracking-[0.25em] text-violet-300 font-mono font-bold">
              Full-History Analog · {symbol}
            </span>
          </div>
          <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-1 rounded border uppercase tracking-wider ${trendCls}`}>
            <TrendIcon className="h-3 w-3" />
            {trendText}
          </span>
          <SourceBadge src={dataSource} />
        </div>

        {/* Best match */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-black text-white">{dateLabel}</span>
            <span className="text-sm font-mono text-violet-300">{best.similarity}% similar</span>
            {!best.isSameSymbol && (
              <span className="text-[10px] font-mono text-amber-300 border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">
                from {best.symbol}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-mono">{r.summary}</p>
          <p className="text-[10px] text-slate-500 font-mono">
            Searched {r.totalCandidatesSearched.toLocaleString()} eligible windows
            across {r.contributingSymbols.map((c) => `${c.symbol}(${c.matches})`).join(", ")}
            · top {agg.count} aggregated · overall confidence {agg.confidenceOverall}%
          </p>
        </div>

        {/* Analog-changed reason banner */}
        {switchReason && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-mono text-amber-100">
            {switchReason}
          </div>
        )}

        {/* Plain-language narrative of what happened after the closest analog */}
        <div className="rounded-md border border-violet-500/20 bg-[#0b0f1a]/60 px-3 py-2 space-y-1">
          <div className="text-[9px] uppercase tracking-widest text-violet-300 font-mono font-bold">
            What happened after this analog
          </div>
          <p className="text-xs font-mono text-slate-200 leading-relaxed">{r.bestNarrative}</p>
        </div>

        {/* Evidence-only path — daily D1-D90 from matched daily bars, or intraday
            5-min / hourly grid from Yahoo intraday bars. All data real, no modeling. */}
        <RealHistoricalPathPanel symbol={symbol} price={price} matches={r.matches} sampleSize={agg.count} />

        {/* PLAIN-ENGLISH TIMELINE — the "where does price go from here" list */}
        <PlainEnglishTimeline
          price={price}
          horizons={r.horizons}
          expectedRemainingDownsidePct={agg.expectedRemainingDownside}
          expectedDaysToTrough={proj.expectedDaysToTrough}
          projectedFloor={proj.projectedFloor}
          recoveryPrice={proj.recoveryPrice}
          medianDaysToRecovery={agg.medianDaysToRecovery}
          probBottomIn={agg.probBottomIn}
          probContinuedDecline={agg.probContinuedDecline}
          sampleSize={agg.count}
        />

        {/* Historical Probability & Scenario Engine — decision-support block */}
        <ProbabilityEngineBlock result={r} price={price} />






        {/* Market phase + trader-facing answers */}
        <div className="rounded-md border border-violet-500/20 bg-[#0b0f1a]/60 px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[9px] uppercase tracking-widest text-violet-300 font-mono font-bold">
              Current market phase
            </div>
            <FavorabilityBadge value={r.traderAnswers.favorability} score={r.traderAnswers.favorabilityScore} />
          </div>
          <p className="text-xs font-mono text-slate-200">{r.phaseNarrative}</p>
          <div className="grid gap-1 text-[11px] font-mono text-slate-300 pt-1">
            <QA q="Have we seen this before?" a={r.traderAnswers.seenBefore
              ? `Yes — ${r.traderAnswers.occurrences} close analogs found in history.`
              : `Not with high confidence — only ${r.traderAnswers.occurrences} weaker analogs.`} />
            <QA q="Where are we in the move?" a={
              r.traderAnswers.earlyOrLate === "post-bottom" ? "Likely post-bottom based on how similar setups played out."
              : r.traderAnswers.earlyOrLate === "early" ? "Early in the move — most of the decline may be ahead."
              : r.traderAnswers.earlyOrLate === "middle" ? "Middle of the move — decline is developing."
              : r.traderAnswers.earlyOrLate === "late" ? "Late in the move — bottoming zone is approaching or here."
              : "Not in a clear directional phase." } />
            <QA q="What usually happens next?" a={r.traderAnswers.whatUsuallyHappens} />
            <QA q="Biggest risks to this comparison?" a={r.traderAnswers.biggestRisks} />
            {r.traderAnswers.riskRewardNote && (
              <QA q="Risk vs reward?" a={r.traderAnswers.riskRewardNote} />
            )}
          </div>
        </div>


        {/* Bottom / downside strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigStat
            label="Bottom already in"
            value={`${Math.round(agg.probBottomIn * 100)}%`}
            sub={`conf ${agg.confidenceBottomIn}%`}
            tone={agg.probBottomIn > 0.6 ? "green" : agg.probBottomIn > 0.35 ? "neutral" : "red"}
          />
          <BigStat
            label="Historical downside"
            value={agg.expectedRemainingDownside < 0 ? pct(agg.expectedRemainingDownside) : "—"}
            sub={`conf ${agg.confidenceDownside}%`}
            tone="red"
          />
          <BigStat
            label="Days to trough"
            value={`${proj.expectedDaysToTrough}d`}
            sub={`recover ${proj.expectedDaysToRecovery ?? "—"}${proj.expectedDaysToRecovery ? "d" : ""}`}
            tone="neutral"
          />
          <BigStat
            label="Bottom type"
            value={dominantBottom ? bottomTypeLabel[dominantBottom[0]] : "—"}
            sub={dominantBottom ? `${Math.round(dominantBottom[1] * 100)}% of analogs` : ""}
            tone="neutral"
          />
        </div>

        {/* Fingerprint side-by-side */}
        <div className="grid grid-cols-2 gap-3">
          <FingerprintBlock title="Now" f={r.current} />
          <FingerprintBlock title={dateLabel} f={best.features} />
        </div>

        {/* Why it matches */}
        <div className="grid gap-1">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">
            Why this analog
          </div>
          <ul className="text-xs font-mono space-y-0.5">
            {r.strongestSimilarities.map((f) => (
              <li key={f.label} className="flex items-start gap-2 text-slate-300">
                <span className="text-emerald-400">✓</span>
                <span>{f.label} · Δ {f.delta.toFixed(2)} · score {(f.score * 100).toFixed(0)}</span>
              </li>
            ))}
            {r.biggestDifferences.map((f) => (
              <li key={"d" + f.label} className="flex items-start gap-2 text-slate-500">
                <span className="text-slate-600">·</span>
                <span>{f.label} diverges · Δ {f.delta.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Aggregated historical outcomes */}
        <div className="border-t border-violet-500/10 pt-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-violet-300 font-mono font-bold">
            Historical outcomes · weighted avg of top {agg.count} analogs · normalized to {usd(price)}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <ScenarioCell
              label="Downside (mean)"
              price={proj.worstPrice}
              subtitle={`${pct(agg.meanMinLowPct)} · floor ${usd(proj.projectedFloor)} · conf ${agg.confidenceDownside}%`}
              tone="red"
            />
            <ScenarioCell
              label="30 trading days"
              price={proj.priceAt30d ?? price}
              subtitle={
                agg.meanFwd30 !== null
                  ? `${pct(agg.meanFwd30)} · p25 ${proj.priceAt30dLow ? usd(proj.priceAt30dLow) : "—"} / p75 ${proj.priceAt30dHigh ? usd(proj.priceAt30dHigh) : "—"} · conf ${agg.confidenceFwd30}%`
                  : "—"
              }
              tone="neutral"
            />
            <ScenarioCell
              label="90 trading days"
              price={proj.priceAt90d ?? price}
              subtitle={
                agg.meanFwd90 !== null
                  ? `${pct(agg.meanFwd90)} · p25 ${proj.priceAt90dLow ? usd(proj.priceAt90dLow) : "—"} / p75 ${proj.priceAt90dHigh ? usd(proj.priceAt90dHigh) : "—"} · conf ${agg.confidenceFwd90}%`
                  : "—"
              }
              tone="green"
            />
          </div>

          {/* Distribution bar */}
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-widest text-slate-500 font-mono">
              Outcome mix (across matches)
            </div>
            <div className="h-2 w-full rounded overflow-hidden bg-slate-800 flex">
              <div className="bg-emerald-500/70" style={{ width: `${agg.probReversal * 100}%` }} />
              <div className="bg-slate-500/60" style={{ width: `${agg.probChop * 100}%` }} />
              <div className="bg-rose-500/70" style={{ width: `${agg.probContinuedDecline * 100}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-slate-400">
              <div>Reversal <span className="text-emerald-300">{Math.round(agg.probReversal * 100)}%</span></div>
              <div>Chop <span className="text-slate-300">{Math.round(agg.probChop * 100)}%</span></div>
              <div>Continued decline <span className="text-rose-300">{Math.round(agg.probContinuedDecline * 100)}%</span></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-500">
            <div>Recovered within 90d: <span className="text-slate-300">{Math.round(agg.recoveryRate * 100)}%</span></div>
            <div>Median days to recovery: <span className="text-slate-300">{agg.medianDaysToRecovery !== null ? `${agg.medianDaysToRecovery}d` : "—"}</span></div>
            <div>Avg max rally: <span className="text-slate-300">{pct(agg.meanMaxRally)}</span></div>
            <div>Avg forward vol: <span className="text-slate-300">{agg.meanForwardVol.toFixed(0)}%</span></div>
            <div>Agreement across matches: <span className="text-slate-300">{Math.round(agg.agreement * 100)}%</span></div>
            <div>Reversal target (60d high): <span className="text-slate-300">{usd(proj.recoveryPrice)}</span></div>
          </div>
        </div>

        {/* Multi-timeframe forward expectations */}
        <div className="border-t border-violet-500/10 pt-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-violet-300 font-mono font-bold">
            Forward expectations by horizon
          </div>
          <div className="grid grid-cols-7 gap-1 text-[10px] font-mono">
            {r.horizons.map((h) => {
              const cls = h.meanPct >= 0 ? "text-emerald-300" : "text-rose-300";
              return (
                <div key={h.days} className="rounded border border-slate-800 bg-[#0b0f1a]/60 p-1.5 space-y-0.5 text-center">
                  <div className="text-slate-500">{h.days}d</div>
                  <div className={`font-black ${cls}`}>{pct(h.meanPct)}</div>
                  <div className="text-slate-500 leading-tight">p25 {h.p25.toFixed(1)}</div>
                  <div className="text-slate-500 leading-tight">p75 {h.p75.toFixed(1)}</div>
                  <div className="text-emerald-400/70">↑{Math.round(h.probUp * 100)}%</div>
                  <div className="h-0.5 w-full rounded bg-slate-800 overflow-hidden">
                    <div className="h-full bg-violet-400" style={{ width: `${h.confidence}%` }} />
                  </div>
                  <div className="text-[9px] text-slate-500">n={h.sample}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Failure analysis */}
        <div className="border-t border-violet-500/10 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-violet-300 font-mono font-bold">
              Historical failure analysis
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              {Math.round(r.failureAnalysis.failureRate * 100)}% of analogs failed
            </span>
          </div>
          <p className="text-[11px] font-mono text-slate-300">{r.failureAnalysis.summary}</p>
          {r.failureAnalysis.failedExamples.length > 0 && (
            <div className="grid gap-1 text-[10px] font-mono text-slate-400">
              {r.failureAnalysis.failedExamples.map((f) => {
                const d = new Date(f.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
                return (
                  <div key={f.date + f.symbol} className="flex items-start justify-between gap-2 rounded bg-slate-900/50 px-2 py-1">
                    <span>
                      {d}{f.symbol && f.symbol !== r.symbol ? ` (${f.symbol})` : ""} · {f.similarity}% match · {f.reason}
                    </span>
                    <span className="text-rose-300 shrink-0">{pct(f.minLowPct)} / 90d {f.fwd90 !== null ? pct(f.fwd90) : "—"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-violet-500/10 pt-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-violet-300 font-mono font-bold">
            Trade planning · from analog
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
            <PlanCell
              label="Deepest ladder rung"
              value={usd(proj.projectedFloor)}
              note={`p25 downside ${pct(agg.p25MinLowPct)}`}
            />
            <PlanCell
              label="TP2 candidate"
              value={usd(proj.recoveryPrice)}
              note={agg.confidenceOverall >= 60 ? "widen TP" : "hold default TP"}
            />
            <PlanCell
              label="Suggested hold"
              value={proj.expectedDaysToRecovery ? `${proj.expectedDaysToRecovery}d` : `${proj.expectedDaysToTrough}d+`}
              note={proj.expectedDaysToRecovery ? "to recovery" : "to trough (no recovery in 90d)"}
            />
            <PlanCell
              label="Ladder bias"
              value={
                agg.probBottomIn > 0.6 ? "Deploy now"
                : agg.probContinuedDecline > 0.55 ? "Stagger deep"
                : "Standard"
              }
              note={
                agg.probBottomIn > 0.6 ? `${Math.round(agg.probBottomIn * 100)}% bottom-in`
                : agg.probContinuedDecline > 0.55 ? `${Math.round(agg.probContinuedDecline * 100)}% decline`
                : `${Math.round(agg.probChop * 100)}% chop`
              }
            />
          </div>
          <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
            Guidance is one evidence source — blend with regime, risk, and market context. Confidence weighting: overall {agg.confidenceOverall}%, downside {agg.confidenceDownside}%, 90d {agg.confidenceFwd90}%.
          </p>
        </div>

        {/* Bottom-type distribution */}
        <div className="border-t border-violet-500/10 pt-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">
            Bottom shape distribution
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-[10px] font-mono">
            {(Object.entries(agg.bottomTypeDistribution) as [string, number][])
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded bg-slate-900/50 px-2 py-1">
                  <span className="text-slate-400">{bottomTypeLabel[k]}</span>
                  <span className="text-slate-200">{Math.round(v * 100)}%</span>
                </div>
              ))}
          </div>
        </div>

        {/* Runner-ups — each expandable to show why this historical date matched */}
        {r.matches.length > 1 && (
          <div className="border-t border-violet-500/10 pt-3">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-2">
              Other close analogs — click any row to see why it matched
            </div>
            <div className="grid gap-1">
              {r.matches.slice(1).map((m) => (
                <AnalogMatchRow key={m.symbol + m.idx} match={m} />
              ))}
            </div>
          </div>
        )}


        {/* Persistent disclaimer footer */}
        <AnalogDisclaimer />
      </CardContent>
    </Card>
  );
}

// ── Per-match "why did this match?" row (Phase-4 explainability) ──────────
// Expands to show the top contributing features (with delta + score) and the
// real forward outcome for this specific historical date. All numbers come
// straight from the analog search — no re-computation, no invented data.

function AnalogMatchRow({
  match,
}: {
  match: import("@/lib/analog-search.server").AnalogHit;
}) {
  const [open, setOpen] = useState(false);
  const d = new Date(match.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  // Rank features by score (higher = better match on that feature).
  const sorted = [...match.distanceBreakdown].sort((a, b) => b.score - a.score);
  const strongest = sorted.slice(0, 4);
  const weakest = sorted.slice(-2).reverse();
  const f = match.forward;
  const pctStr = (n: number | null | undefined) =>
    n === null || n === undefined || Number.isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const fmtDelta = (delta: number) =>
    `${delta >= 0 ? "+" : ""}${delta.toFixed(Math.abs(delta) >= 10 ? 0 : 2)}`;
  return (
    <div className="rounded border border-slate-800/60 bg-slate-900/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-mono text-slate-400 hover:bg-slate-800/40 transition"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="truncate">
            {d}
            {!match.isSameSymbol && <span className="text-amber-300"> ({match.symbol})</span>}
            {" · "}{pctStr(f.minLowPct)} then / {pctStr(f.fwd90)} 90d
          </span>
        </span>
        <span className="text-slate-500 shrink-0">{match.similarity}%</span>
      </button>
      {open && (
        <div className="border-t border-slate-800/60 px-2 py-2 space-y-2 text-[11px] font-mono text-slate-400">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              Strongest similarities
            </div>
            <div className="grid gap-0.5">
              {strongest.map((s) => (
                <div key={s.key} className="flex items-center justify-between">
                  <span className="text-slate-300">{s.label}</span>
                  <span className="text-slate-500">
                    Δ {fmtDelta(s.delta)} · <span className="text-emerald-300">{Math.round(s.score * 100)}%</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          {weakest.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                Biggest differences
              </div>
              <div className="grid gap-0.5">
                {weakest.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-slate-300">{s.label}</span>
                    <span className="text-slate-500">
                      Δ {fmtDelta(s.delta)} · <span className="text-rose-300">{Math.round(s.score * 100)}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-slate-800/60 pt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <div>Max drawdown after: <span className="text-slate-300">{pctStr(f.minLowPct)}</span></div>
            <div>Days to trough: <span className="text-slate-300">{f.daysToTrough}</span></div>
            <div>Fwd 30d: <span className="text-slate-300">{pctStr(f.fwd30)}</span></div>
            <div>Fwd 90d: <span className="text-slate-300">{pctStr(f.fwd90)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Historical Probability & Scenario Engine (Phase-1 upgrade) ────────────

function ProbabilityEngineBlock({
  result,
  price,
}: {
  result: import("@/lib/analog-search.server").AnalogSearchResult;
  price: number;
}) {
  // Build the enriched report client-side from the already-fetched analog
  // matches — no extra data round-trip, no extra credit spend.

  const report = buildProbabilityReport(result);
  const wvb = buildWaitVsBuy(report);
  const scenarios = buildScenarios(result);

  const verdictMeta =
    wvb.verdict === "BUY_NOW"
      ? { label: "BUY NOW", cls: "text-emerald-200 border-emerald-500/50 bg-emerald-500/10", Icon: CheckCircle2 }
      : wvb.verdict === "WAIT"
        ? { label: "WAIT", cls: "text-amber-200 border-amber-500/50 bg-amber-500/10", Icon: Clock }
        : { label: "SPLIT ENTRY", cls: "text-sky-200 border-sky-500/50 bg-sky-500/10", Icon: Split };

  const VIcon = verdictMeta.Icon;

  return (
    <div className="space-y-3 rounded-lg border border-violet-500/30 bg-[#0b0f1a]/70 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[9px] uppercase tracking-widest text-violet-300 font-mono font-bold">
          Historical Probability & Scenario Engine
        </div>
        <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">
          {report.matchQuality.replace("_", " ")} match · n={report.sampleSize} · conf {report.confidenceOverall}%
        </span>
      </div>

      {/* Verdict card */}
      <div className={`flex items-start gap-3 rounded-md border px-3 py-2 ${verdictMeta.cls}`}>
        <VIcon className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-sm font-black font-mono tracking-wider">{verdictMeta.label}</span>
            <span className="text-[10px] font-mono opacity-80">confidence {wvb.confidence}%</span>
          </div>
          <p className="text-[11px] font-mono leading-relaxed opacity-95">{wvb.rationale}</p>
        </div>
      </div>

      {/* Wait-vs-Buy comparison table */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-emerald-300 font-mono font-bold">Buy now</div>
          <MicroStat label="Immediate recovery (5d)" value={`${Math.round(wvb.buyNow.probImmediateRecovery * 100)}%`} />
          <MicroStat label="Dips ~3% first" value={`${Math.round(wvb.buyNow.probDrawdownFirst3pct * 100)}%`} />
          <MicroStat label="Avg 30d return" value={pct(wvb.buyNow.avgForwardReturn30d)} />
          <MicroStat label="Avg max adverse" value={pct(wvb.buyNow.expectedMaxAdversePct)} />
        </div>
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-amber-300 font-mono font-bold">Wait for dip</div>
          <MicroStat label="Better entry appears" value={`${Math.round(wvb.wait.probBetterEntryAppears * 100)}%`} />
          <MicroStat label="Avg entry improvement" value={pct(wvb.wait.avgEntryImprovementPct)} />
          <MicroStat label="Miss-the-move risk" value={`${Math.round(wvb.wait.probMissTheMove * 100)}%`} />
          <MicroStat label="Suggested limit" value={pct(wvb.wait.suggestedLimitPct)} />
        </div>
      </div>

      {/* Direction probabilities */}
      <div className="rounded-md border border-slate-800 bg-[#0b0f1a]/60 p-2 space-y-1">
        <div className="text-[9px] uppercase tracking-wider text-violet-300 font-mono font-bold">Direction probabilities</div>
        <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
          <DirCell label="Reversal higher" v={report.direction.reversalHigher} tone="green" />
          <DirCell label="Continued decline" v={report.direction.continuedDecline} tone="red" />
          <DirCell label="Bottom already in" v={report.direction.bottomAlreadyIn} tone="green" />
          <DirCell label="False breakdown" v={report.direction.falseBreakdown} tone="neutral" />
          <DirCell label="Recovered w/i 90d" v={report.direction.recoveredWithin90d} tone="green" />
          <DirCell label="Chop / range" v={report.direction.choppyRange} tone="neutral" />
        </div>
      </div>

      {/* Horizon table */}
      <div className="rounded-md border border-slate-800 bg-[#0b0f1a]/60 p-2 space-y-1">
        <div className="text-[9px] uppercase tracking-wider text-violet-300 font-mono font-bold">
          Outcome by horizon (historical)
        </div>
        <div className="grid grid-cols-[auto_repeat(6,minmax(0,1fr))] gap-x-2 gap-y-0.5 text-[10px] font-mono">
          <div className="text-slate-500">horizon</div>
          {report.horizons.map((h) => <div key={h.days} className="text-slate-500 text-right">T+{h.days}d</div>)}
          <div className="text-slate-400">mean</div>
          {report.horizons.map((h) => <div key={h.days} className={`text-right ${h.meanPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{pct(h.meanPct)}</div>)}
          <div className="text-slate-400">median</div>
          {report.horizons.map((h) => <div key={h.days} className="text-right text-slate-200">{pct(h.medianPct)}</div>)}
          <div className="text-slate-400">win rate</div>
          {report.horizons.map((h) => <div key={h.days} className="text-right text-slate-200">{Math.round(h.winRate * 100)}%</div>)}
          <div className="text-slate-400">p25 / p75</div>
          {report.horizons.map((h) => <div key={h.days} className="text-right text-slate-400">{h.p25.toFixed(1)}/{h.p75.toFixed(1)}</div>)}
          <div className="text-slate-400">fail (≤-5%)</div>
          {report.horizons.map((h) => <div key={h.days} className="text-right text-slate-400">{Math.round(h.failureRate * 100)}%</div>)}
          <div className="text-slate-500">n</div>
          {report.horizons.map((h) => <div key={h.days} className="text-right text-slate-500">{h.sample}</div>)}
        </div>
      </div>

      {/* Depth curve */}
      <div className="rounded-md border border-slate-800 bg-[#0b0f1a]/60 p-2 space-y-1">
        <div className="text-[9px] uppercase tracking-wider text-violet-300 font-mono font-bold">
          Prob. price reaches level within 90d
        </div>
        <div className="grid grid-cols-6 gap-1 text-[10px] font-mono text-center">
          {report.depthCurve.map((d) => {
            const rp = price * (1 + d.dropPct / 100);
            return (
              <div key={d.dropPct} className="rounded border border-slate-800 bg-slate-900/40 p-1">
                <div className="text-slate-500">{d.dropPct}%</div>
                <div className="text-slate-200 font-black">{Math.round(d.probReached * 100)}%</div>
                <div className="text-slate-500">{usd(rp)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scenarios */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {scenarios.scenarios.map((s) => {
          const tone =
            s.kind === "bullish" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
            : s.kind === "bearish" ? "border-rose-500/30 bg-rose-500/5 text-rose-100"
            : "border-slate-700 bg-slate-900/40 text-slate-100";
          return (
            <div key={s.kind} className={`rounded-md border p-2 space-y-1 ${tone}`}>
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-wider font-mono font-bold">{s.label}</span>
                <span className="text-[10px] font-mono opacity-90">{Math.round(s.frequency * 100)}%</span>
              </div>
              <div className="h-1 w-full rounded bg-black/30 overflow-hidden">
                <div className={s.kind === "bullish" ? "h-full bg-emerald-400" : s.kind === "bearish" ? "h-full bg-rose-400" : "h-full bg-slate-400"} style={{ width: `${Math.round(s.frequency * 100)}%` }} />
              </div>
              <div className="text-[10px] font-mono opacity-90">
                90d: {pct(s.avgReturn90d)} · range {usd(s.priceLow)}–{usd(s.priceHigh)}
              </div>
              <p className="text-[10px] font-mono opacity-80 leading-snug">{s.narrative}</p>
              {s.supporting.length > 0 && (
                <div className="text-[9px] font-mono opacity-70">
                  {s.supporting.map((sp) => `${sp.date.slice(0, 10)}${sp.symbol !== result.symbol ? ` (${sp.symbol})` : ""}`).join(" · ")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[9px] font-mono text-slate-500 leading-relaxed">
        {scenarios.disclaimer}
      </p>
    </div>
  );
}

function MicroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[10px] font-mono">
      <span className="opacity-70">{label}</span>
      <span className="font-black">{value}</span>
    </div>
  );
}

function DirCell({ label, v, tone }: { label: string; v: number; tone: "green" | "red" | "neutral" }) {
  const color = tone === "green" ? "text-emerald-300" : tone === "red" ? "text-rose-300" : "text-slate-300";
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 p-1 space-y-0.5">
      <div className="text-slate-500 text-[9px] leading-tight">{label}</div>
      <div className={`font-black text-[11px] ${color}`}>{Math.round(v * 100)}%</div>
    </div>
  );
}

function FingerprintBlock({ title, f }: { title: string; f: import("@/lib/analog-search.server").WindowFeatures }) {
  return (
    <div className="rounded-md border border-slate-800 bg-[#0b0f1a]/60 p-2 space-y-0.5">
      <div className="text-[9px] uppercase tracking-wider text-violet-300 font-mono font-bold">{title}</div>
      <Row label="DD 60d / 20d" value={`${pct(f.dd60)} / ${pct(f.dd20)}`} />
      <Row label="DD 1y" value={pct(f.dd252)} />
      <Row label="52w range" value={`${f.pct52wRange.toFixed(0)}%`} />
      <Row label="5d / 20d / 60d" value={`${pct(f.ret5, 1)} / ${pct(f.ret20, 1)} / ${pct(f.ret60, 1)}`} />
      <Row label="RSI(14) / slope" value={`${f.rsi14.toFixed(0)} / ${f.rsiSlope5.toFixed(1)}`} />
      <Row label="MACD hist" value={f.macdHist.toFixed(2)} />
      <Row label="vs 20/50/200" value={`${f.distSma20.toFixed(1)} / ${f.distSma50.toFixed(1)} / ${f.distSma200.toFixed(1)}`} />
      <Row label="ATR% / vol exp" value={`${f.atrPct.toFixed(2)} / ${f.volExpansion.toFixed(2)}`} />
      <Row label="Realized vol" value={`${f.realizedVol20.toFixed(0)}%`} />
      <Row label="RS SPY 20/60" value={`${f.rsVsSpy20.toFixed(1)} / ${f.rsVsSpy60.toFixed(1)}`} />
      <Row label="Market DD/RSI" value={`${f.spyDd60.toFixed(1)} / ${f.spyRsi14.toFixed(0)}`} />
      <Row label="Down bars 20" value={`${f.pctDownBars20.toFixed(0)}%`} />
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[10px] font-mono">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function BigStat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "red" | "green" | "neutral" }) {
  const color =
    tone === "red" ? "border-rose-500/30 text-rose-200"
    : tone === "green" ? "border-emerald-500/30 text-emerald-200"
    : "border-slate-700 text-slate-200";
  return (
    <div className={`rounded-md border bg-[#0b0f1a]/60 px-2 py-2 ${color}`}>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 leading-tight">{label}</div>
      <div className="text-sm font-mono font-black mt-1 truncate">{value}</div>
      <div className="text-[10px] font-mono text-slate-500 truncate">{sub}</div>
    </div>
  );
}
function ScenarioCell({
  label, price, subtitle, tone,
}: {
  label: string; price: number; subtitle: string; tone: "red" | "neutral" | "green";
}) {
  const color =
    tone === "red" ? "text-rose-300 border-rose-500/30"
    : tone === "green" ? "text-emerald-300 border-emerald-500/30"
    : "text-slate-200 border-slate-700";
  return (
    <div className={`rounded-md border bg-[#0b0f1a]/60 px-2 py-2 ${color}`}>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 leading-tight">{label}</div>
      <div className="text-sm font-mono font-black mt-1">{usd(price)}</div>
      <div className="text-[10px] font-mono text-slate-500 truncate">{subtitle}</div>
    </div>
  );
}
function PlanCell({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md border border-violet-500/20 bg-[#0b0f1a]/60 px-2 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 leading-tight">{label}</div>
      <div className="text-sm font-mono font-black mt-1 text-violet-100 truncate">{value}</div>
      <div className="text-[10px] font-mono text-slate-500 truncate">{note}</div>
    </div>
  );
}

function QA({ q, a }: { q: string; a: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-2">
      <span className="text-slate-500">{q}</span>
      <span className="text-slate-200">{a}</span>
    </div>
  );
}

function FavorabilityBadge({ value, score }: { value: "favorable" | "mixed" | "unfavorable"; score: number }) {
  const cls =
    value === "favorable" ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
    : value === "unfavorable" ? "text-rose-300 border-rose-500/40 bg-rose-500/10"
    : "text-slate-300 border-slate-600 bg-slate-800/40";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${cls}`}>
      {value} · {score >= 0 ? "+" : ""}{score}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAIN-ENGLISH TIMELINE
// Turns the horizon table into a literal day-by-day list a human can read
// without knowing what "p25/p75" means. Honest about the fact we use daily
// closing data (no intraday hourly forecasts).
// ─────────────────────────────────────────────────────────────────────────────

type HRow = {
  days: number;
  meanPct: number;
  p25: number;
  p75: number;
  probUp: number;
  sample: number;
  confidence: number;
};


function PlainEnglishTimeline({
  price,
  horizons,
  expectedRemainingDownsidePct,
  expectedDaysToTrough,
  projectedFloor,
  recoveryPrice,
  medianDaysToRecovery,
  probBottomIn,
  probContinuedDecline,
  sampleSize,
}: {
  price: number;
  horizons: HRow[];
  expectedRemainingDownsidePct: number;
  expectedDaysToTrough: number;
  projectedFloor: number;
  recoveryPrice: number;
  medianDaysToRecovery: number | null;
  probBottomIn: number;
  probContinuedDecline: number;
  sampleSize: number;
}) {
  const usable = horizons.filter((h) => h.sample > 0);
  if (!usable.length) return null;

  const dipLine =
    expectedRemainingDownsidePct < -0.25
      ? `Along the way, similar setups usually dipped another ${expectedRemainingDownsidePct.toFixed(1)}% first — to about ${usd(projectedFloor)}, typically hit around day ${expectedDaysToTrough}. ${Math.round(probContinuedDecline * 100)}% of matches kept dropping before recovering.`
      : `Similar setups usually did not drop meaningfully further from here — ${Math.round(probBottomIn * 100)}% had already put in the low.`;

  const recoveryLine =
    medianDaysToRecovery !== null
      ? `Back to prior peak (~${usd(recoveryPrice)}) took a typical ${medianDaysToRecovery} trading days when it happened.`
      : `Most matches did not fully reclaim their prior peak inside 90 days.`;

  const shortLabel = (d: number) => {
    if (d === 1) return "TOMORROW";
    if (d === 5) return "1 WEEK";
    if (d === 10) return "2 WEEKS";
    if (d === 20) return "1 MONTH";
    if (d === 30) return "6 WEEKS";
    if (d === 60) return "3 MONTHS";
    if (d === 90) return "4½ MONTHS";
    return `${d}D`;
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#0a0c10] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <div>
          <h3 className="text-[10px] font-bold tracking-[0.2em] text-violet-400 uppercase font-mono">
            Historical Outcomes
          </h3>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            Reference price <span className="text-slate-300 font-bold">{usd(price)}</span> · {sampleSize} matches
          </div>
        </div>
        <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">
          Plain English
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        {usable.map((h) => {
          const meanPrice = price * (1 + h.meanPct / 100);
          const loPrice = price * (1 + h.p25 / 100);
          const hiPrice = price * (1 + h.p75 / 100);
          const upPct = Math.round(h.probUp * 100);
          const downPct = 100 - upPct;
          const bullish = h.meanPct >= 0;
          const deltaColor = bullish ? "text-emerald-400" : "text-rose-400";
          return (
            <div
              key={h.days}
              className="rounded-xl border border-slate-800 bg-[#0b0f19] p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-slate-400 tracking-wider font-mono">
                  {shortLabel(h.days)}
                </span>
                <span className={`text-[10px] font-mono ${deltaColor}`}>
                  {pct(h.meanPct)}
                </span>
              </div>
              <div className="text-sm font-bold text-white font-mono tracking-tight">
                {usd(meanPrice)}
              </div>
              <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden flex" aria-label={`Win ${upPct}% / Loss ${downPct}%`}>
                <div className="h-full bg-emerald-500" style={{ width: `${upPct}%` }} />
                <div className="h-full bg-rose-500" style={{ width: `${downPct}%` }} />
              </div>
              <div className="flex justify-between text-[9px] font-bold uppercase tracking-tighter font-mono">
                <span className="text-emerald-400">Win {upPct}%</span>
                <span className="text-rose-400">Loss {downPct}%</span>
              </div>
              <div className="text-[9px] text-slate-500 font-mono pt-1 border-t border-slate-800/60">
                Range {usd(loPrice)}–{usd(hiPrice)} · conf {h.confidence}%
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-800 px-4 py-3 space-y-1.5 text-[11px] font-mono text-slate-300 leading-relaxed">
        <div>{dipLine}</div>
        <div>{recoveryLine}</div>
      </div>

      <div className="border-t border-slate-800 px-4 py-3 text-[10px] font-mono text-slate-500 leading-relaxed italic">
        Based on real daily closing prices from the closest historical matches — not intraday. Historical outcomes only, not a prediction.
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL HISTORICAL PATH
// Evidence-only chart: every point is an actual future trading day from the
// matched historical windows, aggregated by trading-day offset. No hourly/minute
// interpolation, no modeled path, no fake data.
// ─────────────────────────────────────────────────────────────────────────────

type PathMatch = import("@/lib/analog-search.server").AnalogHit;

function statPercentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[i];
}

function RealHistoricalPathChart({
  price,
  matches,
  sampleSize,
  embedded,
}: {
  price: number;
  matches: PathMatch[];
  sampleSize: number;
  embedded?: boolean;
}) {
  const [selectedDay, setSelectedDay] = useState(1);
  const maxDay = 90;
  const rows = Array.from({ length: maxDay + 1 }, (_, day) => {
    const closeVals: number[] = [];
    const lowVals: number[] = [];
    const highVals: number[] = [];
    for (const m of matches) {
      const point = m.forward.path?.find((p) => p.day === day);
      if (!point) continue;
      closeVals.push(point.closePct);
      lowVals.push(point.lowPct);
      highVals.push(point.highPct);
    }
    if (!closeVals.length) return null;
    const medianClosePct = statPercentile(closeVals, 50);
    const p25ClosePct = statPercentile(closeVals, 25);
    const p75ClosePct = statPercentile(closeVals, 75);
    const medianLowPct = statPercentile(lowVals, 50);
    const medianHighPct = statPercentile(highVals, 50);
    return {
      day,
      sample: closeVals.length,
      medianClosePct,
      p25ClosePct,
      p75ClosePct,
      medianLowPct,
      medianHighPct,
      medianClosePrice: price * (1 + medianClosePct / 100),
      p25ClosePrice: price * (1 + p25ClosePct / 100),
      p75ClosePrice: price * (1 + p75ClosePct / 100),
      medianLowPrice: price * (1 + medianLowPct / 100),
      medianHighPrice: price * (1 + medianHighPct / 100),
      probUp: closeVals.filter((v) => v > 0).length / closeVals.length,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length) return null;

  const selected = rows.find((r) => r.day === selectedDay) ?? rows[Math.min(1, rows.length - 1)] ?? rows[0];
  const svgW = 320;
  const svgH = 118;
  const padX = 10;
  const padY = 10;
  const yVals = rows.flatMap((r) => [r.p25ClosePrice, r.p75ClosePrice, r.medianClosePrice, r.medianLowPrice, r.medianHighPrice]).concat([price]);
  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);
  const rangeY = Math.max(0.01, maxY - minY);
  const x = (day: number) => padX + (day / maxDay) * (svgW - padX * 2);
  const y = (value: number) => padY + (1 - (value - minY) / rangeY) * (svgH - padY * 2);
  const medianPath = rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(r.day).toFixed(1)},${y(r.medianClosePrice).toFixed(1)}`).join(" ");
  const bandPath =
    rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(r.day).toFixed(1)},${y(r.p75ClosePrice).toFixed(1)}`).join(" ") +
    " " +
    [...rows].reverse().map((r) => `L${x(r.day).toFixed(1)},${y(r.p25ClosePrice).toFixed(1)}`).join(" ") +
    " Z";
  const selectedX = x(selected.day);
  const selectedY = y(selected.medianClosePrice);
  const handleScrub = (clientX: number, el: HTMLDivElement | null) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const day = Math.max(0, Math.min(maxDay, Math.round(frac * maxDay)));
    setSelectedDay(day);
  };
  const deltaCls = selected.medianClosePct > 0.05 ? "text-emerald-400" : selected.medianClosePct < -0.05 ? "text-rose-400" : "text-slate-300";

  const Wrapper: React.ElementType = embedded ? "div" : "section";
  const wrapperClass = embedded ? "" : "rounded-2xl border border-slate-800 bg-[#0a0c10] overflow-hidden";
  return (
    <Wrapper className={wrapperClass}>
      {!embedded && (
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <h3 className="text-[10px] font-bold tracking-[0.2em] text-cyan-400 uppercase font-mono">
              Real Historical Path
            </h3>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {sampleSize} analog matches · actual daily bars only
            </p>
          </div>
          <span className="px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-[9px] font-bold font-mono text-emerald-300 uppercase tracking-widest">
            No model data
          </span>
        </div>
      )}
      {embedded && (
        <p className="px-4 pt-2 text-[10px] text-slate-500 font-mono">
          {sampleSize} daily analog matches · actual daily bars only
        </p>
      )}

      <div className="px-4 mt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white tracking-tight font-mono">
            {usd(selected.medianClosePrice)}
          </span>
          <span className={`text-sm font-semibold font-mono ${deltaCls}`}>
            {pct(selected.medianClosePct, 2)}
          </span>
        </div>
        <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">
          Trading day {selected.day} · actual median close · p25/p75 {usd(selected.p25ClosePrice)}–{usd(selected.p75ClosePrice)}
        </p>
      </div>

      <div
        className="px-4 mt-4 h-40 relative touch-none select-none cursor-crosshair"
        onMouseMove={(e) => handleScrub(e.clientX, e.currentTarget)}
        onTouchStart={(e) => e.touches[0] && handleScrub(e.touches[0].clientX, e.currentTarget)}
        onTouchMove={(e) => e.touches[0] && handleScrub(e.touches[0].clientX, e.currentTarget)}
      >
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="realHistoryBand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1={padX} y1={y(price)} x2={svgW - padX} y2={y(price)} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.7" />
          <path d={bandPath} fill="url(#realHistoryBand)" stroke="none" />
          <path d={medianPath} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
          {[1, 5, 20, 60, 90].map((d) => (
            <line key={d} x1={x(d)} y1={svgH - padY} x2={x(d)} y2={svgH - padY + 3} stroke="#64748b" strokeWidth="0.7" />
          ))}
          <line x1={selectedX} y1={padY} x2={selectedX} y2={svgH - padY} stroke="#f8fafc" strokeOpacity="0.35" strokeWidth="0.75" />
          <circle cx={selectedX} cy={selectedY} r="3" fill="#f8fafc" stroke="#22d3ee" strokeWidth="1" />
        </svg>
      </div>

      <div className="px-4 mt-1 flex justify-between text-[9px] font-mono text-slate-600 uppercase tracking-widest">
        <span>D1</span><span>D5</span><span>D20</span><span>D60</span><span>D90</span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-800 border-t border-slate-800 bg-slate-900/30 mt-3">
        <div className="p-3 text-center">
          <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider font-mono">Actual High/Low</p>
          <p className="text-xs font-mono text-white mt-1">{usd(selected.medianLowPrice)}–{usd(selected.medianHighPrice)}</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider font-mono">P(Up)</p>
          <p className="text-xs font-mono text-white mt-1">{Math.round(selected.probUp * 100)}%</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider font-mono">Evidence</p>
          <p className="text-xs font-mono text-white mt-1">n={selected.sample}</p>
        </div>
      </div>

      <details className="group border-t border-slate-800">
        <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-slate-400 hover:text-slate-200">
          <span>Closest historical examples</span>
          <span className="text-slate-500 group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <ol className="px-4 pb-3 space-y-1">
          {matches.slice(0, 8).map((m) => {
            const point = m.forward.path?.find((p) => p.day === selected.day) ?? m.forward.path?.[m.forward.path.length - 1];
            if (!point) return null;
            const d = new Date(m.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
            const dir = point.closePct > 0.05 ? "text-emerald-400" : point.closePct < -0.05 ? "text-rose-400" : "text-slate-400";
            return (
              <li key={`${m.symbol}-${m.idx}-${selected.day}`} className="flex items-baseline justify-between gap-2 text-[11px] font-mono border-b border-slate-800/60 pb-1 last:border-0">
                <span className="text-cyan-200 min-w-[8rem] truncate">{d}{!m.isSameSymbol ? ` · ${m.symbol}` : ""}</span>
                <span className={`${dir} min-w-[4rem] text-right`}>{pct(point.closePct, 2)}</span>
                <span className="text-slate-500 text-[10px] min-w-[8rem] text-right">
                  low/high {pct(point.lowPct, 1)} / {pct(point.highPct, 1)}
                </span>
                <span className="text-slate-500 min-w-[3rem] text-right">{m.similarity}%</span>
              </li>
            );
          })}
        </ol>
      </details>

      <div className="border-t border-slate-800 px-4 py-3 text-[10px] font-mono text-slate-500 leading-relaxed italic">
        Daily view: real future trading-day closes, lows, and highs from the closest historical matches, normalized to today's price. Switch to <span className="text-slate-400">5-min</span> or <span className="text-slate-400">Hourly</span> above for real intraday paths from Yahoo bars.
      </div>
    </Wrapper>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Real Historical Path — Resolution Panel
// Wraps the daily D1-D90 view and the intraday (5-min / hourly) view behind
// a segmented control. Both views draw exclusively from real historical bars:
//   • Daily: matched forward daily bars from decades of history via analog-search.
//   • Intraday: 60 days of 5-min bars from Yahoo → sessions grouped, closest
//     morning shapes selected, forward paths aligned. See intraday-analog.server.ts.
// Nothing is modeled or interpolated. Every point is an empirical percentile
// across real prior sessions.
// ─────────────────────────────────────────────────────────────────────────────

type Resolution = "5min" | "1h" | "1d";
const INTRADAY_ANALOG_QUERY_VERSION = "tz-v3-projected-default";

function RealHistoricalPathPanel({
  symbol,
  price,
  matches,
  sampleSize,
}: {
  symbol: string;
  price: number;
  matches: PathMatch[];
  sampleSize: number;
}) {
  const [resolution, setResolution] = useState<Resolution>("1d");
  return (
    <section className="rounded-2xl border border-slate-800 bg-[#0a0c10] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h3 className="text-[10px] font-bold tracking-[0.2em] text-cyan-400 uppercase font-mono">
            Real Historical Path
          </h3>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
            Percentile paths across real prior sessions · no modeling
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900/60 p-0.5 text-[9px] font-mono uppercase tracking-widest">
          {(
            [
              { k: "5min" as Resolution, label: "5-min" },
              { k: "1h" as Resolution, label: "Hourly" },
              { k: "1d" as Resolution, label: "Daily" },
            ]
          ).map((opt) => (
            <button
              key={opt.k}
              type="button"
              onClick={() => setResolution(opt.k)}
              className={`px-2 py-1 rounded-full transition-colors ${
                resolution === opt.k
                  ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
                  : "text-slate-500 hover:text-slate-300 border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {resolution === "1d" ? (
        <RealHistoricalPathChart price={price} matches={matches} sampleSize={sampleSize} embedded />
      ) : (
        <IntradayHistoricalPathChart symbol={symbol} price={price} bucket={resolution} />
      )}
    </section>
  );
}

// Intraday panel — real 5-minute Yahoo history, optionally bucketed to hourly.
function IntradayHistoricalPathChart({
  symbol,
  price,
  bucket,
}: {
  symbol: string;
  price: number;
  bucket: "5min" | "1h";
}) {
  const fn = useServerFn(getIntradayAnalogProjection);
  const q = useQuery({
    queryKey: ["intraday-analog-panel", INTRADAY_ANALOG_QUERY_VERSION, symbol.toUpperCase()],
    queryFn: () => fn({ data: { symbol: symbol.toUpperCase(), version: INTRADAY_ANALOG_QUERY_VERSION } }),
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const data = q.data;

  useEffect(() => {
    setSelectedIdx(null);
  }, [bucket, data?.status === "ok" ? data.asOfIso : ""]);

  if (q.isLoading) {
    return (
      <div className="px-4 py-6 text-xs font-mono text-slate-500">
        Loading intraday historical bars for {symbol.toUpperCase()}…
      </div>
    );
  }
  if (!data || data.status !== "ok") {
    const note = data && data.status === "empty" ? data.note : "Intraday historical bars are not available for this symbol right now.";
    const isClosed = data && data.status === "empty" && data.reason === "market_closed";
    return (
      <div className="px-4 py-6 text-xs font-mono text-slate-400 space-y-2">
        <div className="flex items-center gap-2 text-slate-500">
          <AlertTriangle className="h-3 w-3" />
          <span className="uppercase tracking-widest text-[10px]">
            {isClosed ? "Intraday paused · market closed" : "Intraday unavailable"}
          </span>
        </div>
        <p className="text-slate-400">{note}</p>
        <p className="text-[10px] text-slate-600">
          {isClosed
            ? <>Resumes automatically at the next open. In the meantime, switch to <span className="text-slate-400">Daily</span> above.</>
            : <>Falls back on daily bars — switch to <span className="text-slate-400">Daily</span> above.</>}
        </p>
      </div>
    );
  }

  // Build combined points list (actual so far + projection ahead), bucketing
  // to hourly when requested. Bucketing = take the last point in each hour.
  type Point = { minutes: number; label: string; medianPrice: number; p25Price: number; p75Price: number; isActual: boolean };
  const pts: Point[] = [];
  const actualAtAnchor = data.currentPrice;
  const anchorMin = data.currentMinutesFromOpen;

  for (const b of data.actual) {
    pts.push({
      minutes: b.minutesFromOpen,
      label: b.time,
      medianPrice: b.price,
      p25Price: b.price,
      p75Price: b.price,
      isActual: true,
    });
  }
  for (const p of data.projection) {
    pts.push({
      minutes: p.minutesFromOpen,
      label: `${String(Math.floor(p.minutesFromOpen / 60)).padStart(2, "0")}:${String(p.minutesFromOpen % 60).padStart(2, "0")}`,
      medianPrice: p.medianPrice,
      p25Price: p.p25Price,
      p75Price: p.p75Price,
      isActual: false,
    });
  }
  pts.sort((a, b) => a.minutes - b.minutes);

  const rows: Point[] = bucket === "1h"
    ? (() => {
        const byHour = new Map<number, Point>();
        for (const p of pts) {
          const h = Math.floor(p.minutes / 60);
          byHour.set(h, p); // last point in the hour wins
        }
        return [...byHour.values()].sort((a, b) => a.minutes - b.minutes);
      })()
    : pts;

  if (!rows.length) return null;

  const firstProjectedIdx = rows.findIndex((r) => !r.isActual);
  const defaultIdx = firstProjectedIdx >= 0 ? firstProjectedIdx : rows.length - 1;
  const activeIdx = Math.min(selectedIdx ?? defaultIdx, rows.length - 1);
  const selected = rows[activeIdx] ?? rows[0];
  const svgW = 320;
  const svgH = 118;
  const padX = 10;
  const padY = 10;
  const yVals = rows.flatMap((r) => [r.medianPrice, r.p25Price, r.p75Price]).concat([price, actualAtAnchor]);
  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);
  const rangeY = Math.max(0.01, maxY - minY);
  const xAt = (i: number) => padX + (i / Math.max(1, rows.length - 1)) * (svgW - padX * 2);
  const yAt = (v: number) => padY + (1 - (v - minY) / rangeY) * (svgH - padY * 2);

  const medianPath = rows.map((r, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(r.medianPrice).toFixed(1)}`).join(" ");
  const bandPath =
    rows.map((r, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(r.p75Price).toFixed(1)}`).join(" ") +
    " " +
    [...rows].reverse().map((r, ri) => `L${xAt(rows.length - 1 - ri).toFixed(1)},${yAt(r.p25Price).toFixed(1)}`).join(" ") +
    " Z";

  const anchorIdx = rows.findIndex((r) => r.minutes >= anchorMin);
  const anchorX = anchorIdx >= 0 ? xAt(anchorIdx) : xAt(0);
  const selectedX = xAt(activeIdx);
  const selectedY = yAt(selected.medianPrice);

  const selPct = ((selected.medianPrice - price) / price) * 100;
  const deltaCls = selPct > 0.05 ? "text-emerald-400" : selPct < -0.05 ? "text-rose-400" : "text-slate-300";
  const label = bucket === "1h" ? "Hourly close (real historical median)" : "5-min close (real historical median)";
  const asOfEt = new Date(data.asOfIso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });

  const handleScrub = (clientX: number, el: HTMLDivElement | null) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setSelectedIdx(Math.round(frac * (rows.length - 1)));
  };

  return (
    <>
      <div className="px-4 mt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white tracking-tight font-mono">{usd(selected.medianPrice)}</span>
          <span className={`text-sm font-semibold font-mono ${deltaCls}`}>{pct(selPct, 2)}</span>
        </div>
        <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">
          {selected.label} ET · {label} · {selected.isActual ? "actual tape" : "analog band"}
        </p>
      </div>

      <div
        className="px-4 mt-4 h-40 relative touch-none select-none cursor-crosshair"
        onMouseMove={(e) => handleScrub(e.clientX, e.currentTarget)}
        onTouchStart={(e) => e.touches[0] && handleScrub(e.touches[0].clientX, e.currentTarget)}
        onTouchMove={(e) => e.touches[0] && handleScrub(e.touches[0].clientX, e.currentTarget)}
      >
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="intradayBand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1={padX} y1={yAt(price)} x2={svgW - padX} y2={yAt(price)} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.7" />
          <path d={bandPath} fill="url(#intradayBand)" stroke="none" />
          <path d={medianPath} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
          <line x1={anchorX} y1={padY} x2={anchorX} y2={svgH - padY} stroke="#22d3ee" strokeDasharray="3 3" strokeOpacity="0.5" strokeWidth="0.75" />
          <line x1={selectedX} y1={padY} x2={selectedX} y2={svgH - padY} stroke="#f8fafc" strokeOpacity="0.35" strokeWidth="0.75" />
          <circle cx={selectedX} cy={selectedY} r="3" fill="#f8fafc" stroke="#22d3ee" strokeWidth="1" />
        </svg>
      </div>

      <div className="px-4 mt-1 flex justify-between text-[9px] font-mono text-slate-600 uppercase tracking-widest">
        <span>{rows[0]?.label}</span>
        <span>NOW</span>
        <span>{rows[rows.length - 1]?.label}</span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-800 border-t border-slate-800 bg-slate-900/30 mt-3">
        <div className="p-3 text-center">
          <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider font-mono">Median EOD</p>
          <p className="text-xs font-mono text-white mt-1">{usd(data.medianCloseByEod)}</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider font-mono">P(Up EOD)</p>
          <p className="text-xs font-mono text-white mt-1">{Math.round(data.probUpByEod * 100)}%</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider font-mono">Evidence</p>
          <p className="text-xs font-mono text-white mt-1">n={data.sampleSize}</p>
        </div>
      </div>

      <div className="border-t border-slate-800 px-4 py-3 text-[10px] font-mono text-slate-500 leading-relaxed italic">
        Real {bucket === "1h" ? "hourly" : "5-minute"} bars from ~54 historical sessions (Yahoo Finance, last 60 trading days). Forward points are the empirical median + p25/p75 of what real prior sessions with today's morning shape did next. No forecasting model. As of {asOfEt} ET.
      </div>
    </>
  );
}

function SourceBadge({ src }: { src: "yahoo" | "stooq" | "cache" }) {
  const cls =
    src === "yahoo" ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
    : src === "stooq" ? "border-teal-500/40 bg-teal-500/10 text-teal-200"
    : "border-slate-600 bg-slate-800/40 text-slate-300";
  return (
    <span
      title={
        src === "yahoo" ? "Daily bars from Yahoo Finance (split/dividend adjusted, ~20y history)."
        : src === "stooq" ? "Daily bars from Stooq (fallback when Yahoo returns thin/failed history)."
        : "Bars served from in-memory cache; refreshes next US market close."
      }
      className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-1 rounded border uppercase tracking-wider ${cls}`}
    >
      <Database className="h-3 w-3" />
      {src}
    </span>
  );
}
