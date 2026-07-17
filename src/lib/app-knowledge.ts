/**
 * LADDRX app knowledge base.
 *
 * Plain-English semantics of every real feature, panel, control, metric,
 * label, and state code used in this specific app. Both the Simple Mode
 * "Explain Anything" inspector AND the AI Copilot bubble use this as
 * ground-truth context so the AI never falls back to generic definitions
 * ("a bar chart shows values…") — it always speaks about what the thing
 * actually does IN LADDRX.
 *
 * Rules for authors:
 *  - Keep entries specific to LADDRX behavior, not generic finance defs.
 *  - Every entry should answer: what this is, what it controls/shows,
 *    why it exists in LADDRX, and what a beginner should do with it.
 *  - Aliases are used for fuzzy matching against visible UI text.
 *  - Keep each `body` under ~700 chars so multiple can fit in one prompt.
 */

export type KnowledgeEntry = {
  slug: string;
  title: string;
  /** Lowercase phrases that indicate this entry is relevant. */
  aliases: string[];
  /** Optional route prefixes this entry applies to. Empty = global. */
  routes?: string[];
  body: string;
};

const K: KnowledgeEntry[] = [
  // ─── App-level ──────────────────────────────────────────────────
  {
    slug: "app.overview",
    title: "What LADDRX is",
    aliases: ["laddrx", "terminal", "home", "dashboard", "what is this app", "what does this app do"],
    body:
      "LADDRX is a pullback / dip-buying trading terminal. It continuously scans a small universe of tickers (SPY for context, plus QQQ, NDX, SMH, SOXX, SOXQ and related names), classifies whether each one is in a real pullback, and — if so — builds a step-by-step 'ladder' of small buys spread across price levels so the user never has to guess a single entry price. Every recommendation is math-driven and, since the Historical Pattern Recognition upgrade, also grounded in similar past setups. LADDRX does NOT place real orders — it plans, tracks, and explains.",
  },
  {
    slug: "app.simple-mode",
    title: "Simple Mode",
    aliases: ["simple mode", "explain anything", "beginner", "plain english", "toggle simple"],
    body:
      "Simple Mode is a translation layer, not a different app. It never removes or downgrades an advanced feature. When ON, it adds plain-English hints under jargon, unlocks the 'Explain Anything' inspector (tap OR draw a circle around anything on screen for a specific explanation), and shows the beginner intro card at the top of each page. Toggle it from the top menu.",
  },
  {
    slug: "app.top-menu",
    title: "Top menu bar",
    aliases: ["top menu", "menu", "header", "top bar", "nav", "navigation"],
    body:
      "The top bar is the app's global control strip. It holds: LADDRX brand, page links (Terminal, AI Copilot, Simulation / Validation), the Simple Mode toggle, the Speed Mode selector, the Capital input, the Fractional-shares switch, and Auto-Fill / Recovery Capture toggles. Every setting here affects only THIS browser — nothing is sent to a server or shared with other users.",
  },

  // ─── Home / scanner ─────────────────────────────────────────────
  {
    slug: "home.scanner",
    title: "Live scanner rows",
    aliases: ["scan", "scanner", "row", "opportunity", "top pick", "pick", "cards", "ticker card"],
    routes: ["/"],
    body:
      "Each row on the home page is one ticker the scanner is watching. The row summarizes: current price and daily change, the regime (is this even a dip?), the scenario the engine picked (WATCH / PROBE / BUY_STARTER / BUY_LADDER), a Setup Quality and Execution Confidence score (0–100), risk level, and — when triggered — a compact ladder of tranches (small step-by-step buys). Rows re-sort continuously; the top row is what the engine currently ranks best.",
  },
  {
    slug: "home.price-change",
    title: "Price & daily change",
    aliases: ["price", "change", "daily change", "1d", "%", "percent", "quote"],
    body:
      "Each row's price is the last traded print from the quote feed; the % change is that price vs the prior day's close. Green = up on the day, red = down. LADDRX itself doesn't act on this number directly — it's shown so the user can sanity-check that the setup matches what they're seeing on their own screen.",
  },
  {
    slug: "home.regime",
    title: "Regime badge",
    aliases: ["regime", "no_dip", "fake_out", "fast_crash", "slow_bleed", "v_bounce", "support_test", "state", "no dip", "fake out", "fast crash", "slow bleed", "support test"],
    body:
      "The regime badge is the engine's answer to 'is this actually a pullback worth buying?'. NO_DIP = no meaningful dip yet. FAKE_OUT = the dip signal is likely misleading or too thin. FAST_CRASH = a sharp downside move that can bounce but carries higher risk. SLOW_BLEED = steady weakness where patience matters. V_BOUNCE_LIKELY = a setup that historically snaps back fast. SUPPORT_TEST = price is testing an important support area. Regime is derived from moving-average distance, RSI, drawdown depth, intraday behavior, and market context.",
  },
  {
    slug: "home.scenario",
    title: "Scenario / action tag",
    aliases: ["scenario", "watch", "probe", "buy_starter", "buy_ladder", "action", "signal status"],
    body:
      "The scenario tag is the plain instruction for the user right now. WATCH = do nothing yet. PROBE = tiny test buy allowed. BUY_STARTER = good place for your first tranche. BUY_LADDER = strong enough setup that the full planned ladder of buys is on the table. It is chosen from the regime + Setup Quality + Execution Confidence + historical analog evidence.",
  },
  {
    slug: "home.ladder",
    title: "The ladder / tranches / rungs",
    aliases: ["ladder", "tranche", "rung", "step", "entries", "buy plan", "levels", "1st buy", "2nd buy"],
    body:
      "A ladder is a sequence of small planned buys at progressively lower prices (or, in momentum mode, into strength). Each rung shows: which buy it is (1st/2nd/…), the trigger price, the % of the position it represents, and whether it's a limit / market / pullback order. This exists so the user never has to pick a single entry — laddering averages the cost and survives more scenarios. Speed Mode changes how tight or spread out the rungs are.",
  },
  {
    slug: "home.rung.price",
    title: "Rung trigger price",
    aliases: ["trigger", "trigger price", "limit price", "entry price"],
    body:
      "The trigger price on a rung is the level at which THAT specific tranche is meant to fire. It's derived from the current price, the setup's ATR (typical daily swing), and the depth of the pullback. Auto-Fill (if on) logs a fill as soon as scan-time price crosses this level; otherwise the user places or records the fill manually.",
  },
  {
    slug: "home.rung.pct",
    title: "Rung % of position",
    aliases: ["%", "percent", "% of capital", "size", "position size"],
    body:
      "Each rung's percentage is how much of THIS ticker's total planned position that tranche represents. Percentages across all rungs sum to ~100%. If the total planned capital for the position is $1,000 and this rung says 25%, buying it means committing $250 at the trigger price.",
  },
  {
    slug: "home.bracket",
    title: "Bracket exit (stop / target)",
    aliases: ["bracket", "stop", "target", "exit", "stop loss", "take profit", "tp", "sl"],
    body:
      "The bracket is the pre-computed exit plan for a filled ladder: a protective stop-loss under the setup and one or more take-profit targets above it. Stops are sized to typical daily swing (ATR) so market noise doesn't knock you out; targets are tied to prior structure and analog outcomes. It exists so the user has a real exit BEFORE entering, not a hope.",
  },
  {
    slug: "home.setupQuality",
    title: "Setup Quality score",
    aliases: ["setup quality", "setupquality", "quality score", "sq"],
    body:
      "Setup Quality (0–100) is how clean the technical picture looks: trend intact, oversold enough to matter, volume behaving, structure holding. Historical Pattern Recognition can nudge it ±20 pts when a strong analog is found. Roughly: 70+ = engine likes the setup; 40–70 = mixed; under 40 = messy tape, be patient.",
  },
  {
    slug: "home.executionConfidence",
    title: "Execution Confidence score",
    aliases: ["execution confidence", "executionconfidence", "confidence", "ec"],
    body:
      "Execution Confidence (0–100) is how confident the engine is that the plan will actually work AS PLANNED right now (fills, follow-through, no obvious regime break). Analog evidence can shift it ±15 pts. Low confidence + high quality means 'good idea, wrong moment.' High confidence + low quality means 'the plan will fire cleanly but the setup itself is thin.'",
  },
  {
    slug: "home.risk",
    title: "Risk level",
    aliases: ["risk", "risk level", "riskreasons", "low", "medium", "high", "extreme"],
    body:
      "Risk is a bucketed rating (LOW / MEDIUM / HIGH / EXTREME) built from downside distance to the stop, historical failure rate of similar setups, drawdown expectations, and broad-market stress (SPY behavior). Historical analogs can bump it up or down when past behavior warrants it. HIGH / EXTREME never means 'don't trade' — it means 'if you do, size down and respect the stop'.",
  },
  {
    slug: "home.speedMode",
    title: "Speed Mode toggle",
    aliases: ["speed mode", "speedmode", "aggressive", "conservative", "balanced", "fast", "fresh"],
    body:
      "Speed Mode changes how aggressively the ladder is built and how fresh data is fetched. Conservative = fewer, deeper rungs, wait for real weakness. Balanced (default) = the standard 3–4 rung plan with cached data. Aggressive / Fresh = tighter, faster rungs that fire on smaller pullbacks and force fresh quotes each scan. It only reshapes execution — regime and scores are the same.",
  },
  {
    slug: "home.capital",
    title: "Capital ($) input",
    aliases: ["capital", "capital input", "total capital", "$", "dollar"],
    body:
      "The Capital input is how much you're willing to allocate to ONE full position. LADDRX uses it to size every rung: e.g. capital $5,000 and a rung at 25% means that tranche costs about $1,250. It is stored in this browser only. Change it any time — new ladders are re-sized automatically; previously filled tranches keep their original size.",
  },
  {
    slug: "home.fractional",
    title: "Fractional shares toggle",
    aliases: ["fractional", "fractional shares", "partial share"],
    body:
      "Fractional shares on = LADDRX will show non-whole-share sizes (e.g. 3.42 shares at $500), which most modern brokers accept. Off = every tranche is rounded down to whole shares, which can leave a small amount of the intended capital unused on expensive tickers.",
  },
  {
    slug: "home.autoFill",
    title: "Auto-Fill Detection",
    aliases: ["auto-fill", "auto fill", "autofill", "auto-fill detection"],
    body:
      "Auto-Fill Detection watches scan-time prices and, when the price crosses a rung's trigger level, records that tranche as filled in your local Positions panel. It doesn't touch a real broker — it just automates the bookkeeping so you can focus on decisions. Turn it off if you'd rather record fills by hand.",
  },
  {
    slug: "home.recoveryCapture",
    title: "Recovery Capture",
    aliases: ["recovery capture", "recovery"],
    body:
      "Recovery Capture is a companion to Auto-Fill. After the first rungs fill and price then bounces back quickly, Recovery Capture tops up the remaining planned rungs at market-adjacent levels so you don't miss the position when the pullback ends abruptly. Safe to leave on; it never adds capital beyond the plan.",
  },
  {
    slug: "home.positions",
    title: "Positions panel",
    aliases: ["positions", "position", "my trades", "open", "book", "my positions", "positions panel"],
    body:
      "Positions is the user's live book: which tickers they've marked as filled, at what tranche, average cost, capital deployed, and how the current bracket is performing. It's local to this browser — LADDRX does not place real orders. Its job is to show the plan-vs-reality picture so the user can act on the same brackets the engine designed. Each position exposes Reset (wipe the plan) and manual-fill editing.",
  },
  {
    slug: "home.manualFill",
    title: "Manual fill dialog",
    aliases: ["manual fill", "record fill", "add fill", "edit fill"],
    body:
      "The manual-fill dialog lets you record a real trade you placed at your broker: which rung, how many shares, at what price, and when. It updates your local Positions panel so the bracket, average cost, and remaining rungs stay accurate. Nothing here contacts a broker.",
  },
  {
    slug: "home.resetPosition",
    title: "Reset position",
    aliases: ["reset", "reset position", "wipe", "clear position"],
    body:
      "Reset wipes the saved buy-ladder plan and fills for a single symbol. Use it when you want the scanner to build a fresh plan from scratch (e.g. after the setup broke or you closed the position at your broker). It only clears local state — it doesn't send an order.",
  },
  {
    slug: "home.trackRecord",
    title: "Track record panel",
    aliases: ["track record", "trackrecord", "history", "past signals", "signal outcomes"],
    body:
      "Track Record logs every signal the scanner has emitted and, over time, scores how those setups actually played out (bounced, failed, went sideways) at 1d / 3d / 5d horizons. Beginners should skim it before sizing up: if the last several signals in the current regime failed, be extra patient.",
  },
  {
    slug: "home.analog",
    title: "Historical Pattern Recognition (analog panel)",
    aliases: ["analog", "historical", "pattern", "similarity", "base rate", "historical pattern", "past setup"],
    body:
      "The Historical Pattern Recognition Scanner searches years of daily bars for setups that look like today's (same drawdown shape, same momentum, same relative behavior vs SPY / sector). It reports similarity %, sample size, how often that pattern bounced vs kept dropping, typical recovery time, and worst-case drawdown. This evidence is piped INTO the live engine — it can shift Setup Quality (±20), Execution Confidence (±15), and Risk. Not a display-only card.",
  },
  {
    slug: "home.analog.similarity",
    title: "Analog similarity %",
    aliases: ["similarity", "similarity %", "match %"],
    body:
      "Similarity % is how close today's setup fingerprint is to the best historical analog on record (0–100). It combines drawdown shape, RSI, ATR, distance to key moving averages, and relative strength vs SPY. 70+ = a strong echo of a past setup; under 50 = weak match, treat the historical outcomes as loose guidance only.",
  },
  {
    slug: "home.analog.favorability",
    title: "Analog favorability",
    aliases: ["favorable", "unfavorable", "mixed", "favorability"],
    body:
      "The analog verdict boils the historical outcomes down to one word: FAVORABLE (past setups mostly bounced), MIXED (roughly even), UNFAVORABLE (past setups usually kept dropping). It's shorthand for the deeper base-rate stats and directly influences the live Risk badge and Execution Confidence.",
  },
  {
    slug: "home.refresh",
    title: "Refresh / rescan",
    aliases: ["refresh", "rescan", "reload", "update", "fresh scan"],
    body:
      "Refresh forces the scanner to pull fresh quotes and re-run regime, scoring, risk, and analog search for the whole universe. The scanner also auto-refreshes on a timer, but a manual refresh is useful right after a big market move.",
  },
  {
    slug: "home.csvExport",
    title: "CSV export",
    aliases: ["csv", "export", "download", "csv export"],
    body:
      "The CSV export button dumps the current scan (rows, indicators, ladders, brackets) as a CSV file so you can review it in Excel / Google Sheets or archive a snapshot. It's a read-only export — nothing is sent anywhere.",
  },

  // ─── Indicators (used in tooltips, chips, and hints) ────────────
  {
    slug: "ind.rsi",
    title: "RSI (momentum score)",
    aliases: ["rsi", "momentum"],
    body:
      "RSI is a 0–100 momentum score based on the average of recent up moves vs down moves. Below 30 = oversold (buyers may step in); above 70 = overheated. LADDRX uses it as one input to the regime and Setup Quality — not as a standalone buy signal.",
  },
  {
    slug: "ind.atr",
    title: "ATR (typical daily swing)",
    aliases: ["atr", "atr14", "average true range", "daily swing"],
    body:
      "ATR is the average true range — how much this ticker usually moves in a day, in dollars. LADDRX uses it to size stops (so noise doesn't knock you out) and to space ladder rungs (so tranches don't stack too close together on a wild ticker).",
  },
  {
    slug: "ind.sma",
    title: "Moving averages (SMA20/50/200, EMA9)",
    aliases: ["sma", "sma20", "sma50", "sma200", "ema", "ema9", "moving average"],
    body:
      "SMA20, SMA50, SMA200 are simple averages of the last 20 / 50 / 200 closes; EMA9 is a fast 9-day exponential average. LADDRX uses distance to these lines (dist %) as a trend/pullback proxy: a stock well above SMA200 with a small pullback to SMA20 is a classic dip-buy shape.",
  },
  {
    slug: "ind.drawdown",
    title: "Drawdown %",
    aliases: ["drawdown", "drawdown20", "drawdown60", "dd", "pullback %"],
    body:
      "Drawdown % is how far the ticker is below its recent high (typically over a 20- or 60-day window). It's how LADDRX quantifies 'how deep is the dip?'. Deeper drawdowns can be better opportunities OR broken trends — the regime badge tells you which.",
  },

  // ─── Simulation sandbox ─────────────────────────────────────────
  {
    slug: "sim.overview",
    title: "Simulation & Testing sandbox",
    aliases: ["simulation", "sandbox", "sim", "backtest", "replay", "scenario test"],
    routes: ["/simulation"],
    body:
      "The Simulation page is an isolated sandbox for testing the scanner and Historical Pattern Recognition against synthetic or replayed market conditions. Nothing here touches live positions or live recommendations — it exists so users (and the engine) can validate behavior in extreme scenarios (flash crash, slow bleed, V-bounce, chop) before trusting a signal live.",
  },
  {
    slug: "sim.replay",
    title: "Historical Replay",
    aliases: ["historical replay", "replay", "step through"],
    routes: ["/simulation"],
    body:
      "Historical Replay steps the engine through real past days bar-by-bar and shows what regime / scenario / ladder / bracket it would have produced on each date. Use it to see how the current logic would have handled famous events (2020 COVID crash, 2022 semi drawdown, 2023 SVB dip, etc.).",
  },
  {
    slug: "sim.sensitivity",
    title: "Sensitivity panel",
    aliases: ["sensitivity", "parameters", "tuning", "knobs", "sweep"],
    routes: ["/simulation"],
    body:
      "Sensitivity sweeps key parameters (thresholds, weights, ATR multipliers) and shows how outputs change. It helps confirm the engine isn't fragile to tiny knob turns and highlights which parameters actually matter.",
  },
  {
    slug: "sim.validation",
    title: "AI Validation & Optimization",
    aliases: ["validation", "champion", "challenger", "promotion", "gate", "calibration"],
    routes: ["/simulation/validation"],
    body:
      "AI Validation is the sandbox's quality-control lab. It runs the scanner across many historical scenarios under strict no-look-ahead rules, computes accuracy / calibration / stability metrics, generates challenger configs, and only PROMOTES a config to champion if it passes a regression gate against the current champion. Nothing here touches live data.",
  },

  // ─── AI copilot ─────────────────────────────────────────────────
  {
    slug: "ai.bubble",
    title: "AI Copilot bubble",
    aliases: ["ai bubble", "copilot", "chat", "assistant", "brain", "ask ai"],
    body:
      "The floating AI bubble is a full copilot with access to the live scan snapshot, positions, settings, capability catalog, track record, and validation history. Ask 'why is SMH ranked top?' or 'what would change if SPY drops 1%?' and it reads the live state to answer. It can also trigger safe app actions (rescan, toggle Auto-Fill / Recovery Capture, set capital, navigate) — never destructive ones without a clear ask.",
  },
  {
    slug: "ai.explainer",
    title: "Simple Mode Explainer",
    aliases: ["explainer", "explain anything", "circle to search", "tap to explain", "explain button"],
    body:
      "The Explainer is the little cyan pill at the bottom-left of the screen (only in Simple Mode). It has two modes: TAP — point at any single element to get a plain-English explanation; CIRCLE — literally draw a shape with your finger around anything on screen and it explains what you circled, using the surrounding context. Both modes share the SAME intelligence as the AI Copilot bubble.",
  },
  {
    slug: "ai.model-picker",
    title: "AI model picker",
    aliases: ["model", "model picker", "gpt", "gemini", "which model"],
    body:
      "The model picker in the copilot header lets you switch which underlying LLM powers responses (Gemini Flash / Pro, GPT-5 tiers). Flash / mini / nano = faster and cheaper; Pro / flagship = slower and more thorough. All models see the same live app state and use the same tools; only the reasoning quality and latency change.",
  },
  {
    slug: "ai.threads",
    title: "Chat threads / history",
    aliases: ["thread", "threads", "history", "conversation", "chat history"],
    body:
      "The copilot keeps every conversation as a separate thread, stored only in this browser. Use the panel toggle to switch threads, start a new one, or delete an old one. Threads survive reloads but never leave your device.",
  },
  {
    slug: "ai.voice",
    title: "Voice questions (mic button)",
    aliases: ["voice", "mic", "microphone", "speak", "talk"],
    body:
      "The mic button in the Explainer's follow-up composer records your question, transcribes it locally through the AI Gateway, and sends it as text. Tap once to start, tap again to stop. Useful when you'd rather ask 'why did this go red?' out loud than type it.",
  },
];

/** Match knowledge entries against arbitrary text (element label + context). */
export function matchKnowledge(text: string, route?: string, limit = 8): KnowledgeEntry[] {
  const t = (text || "").toLowerCase();
  const scored: Array<{ e: KnowledgeEntry; score: number }> = [];
  for (const e of K) {
    if (e.routes && route && !e.routes.some((r) => route.startsWith(r))) continue;
    let score = 0;
    for (const a of e.aliases) {
      if (!a) continue;
      if (t.includes(a)) score += a.length; // longer match = stronger
    }
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}

/** Always-on route primer so the AI knows what page the user is on. */
export function routePrimer(route?: string): KnowledgeEntry[] {
  const out: KnowledgeEntry[] = [K.find((e) => e.slug === "app.overview")!];
  if (!route || route === "/" || route === "/index") {
    const home = K.find((e) => e.slug === "home.scanner");
    if (home) out.push(home);
  } else if (route.startsWith("/simulation/validation")) {
    const val = K.find((e) => e.slug === "sim.validation");
    if (val) out.push(val);
  } else if (route.startsWith("/simulation")) {
    const sim = K.find((e) => e.slug === "sim.overview");
    if (sim) out.push(sim);
  } else if (route.startsWith("/ai")) {
    const ai = K.find((e) => e.slug === "ai.bubble");
    if (ai) out.push(ai);
  }
  return out;
}

export function buildAppFacts(text: string, route?: string, limit = 6): string {
  const primer = routePrimer(route);
  const matches = matchKnowledge(text, route, limit).filter(
    (m) => !primer.some((p) => p.slug === m.slug),
  );
  const all = [...primer, ...matches];
  if (all.length === 0) return "";
  return all
    .map((e) => `### ${e.title} [${e.slug}]\n${e.body}`)
    .join("\n\n");
}

/** Full dump — used when the AI needs the whole catalog at once (rare). */
export function allKnowledge(): KnowledgeEntry[] {
  return K.slice();
}
