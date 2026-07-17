import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "laddrx:simple-mode";

type Ctx = {
  simple: boolean;
  setSimple: (v: boolean) => void;
  toggle: () => void;
};

const SimpleModeContext = createContext<Ctx>({
  simple: false,
  setSimple: () => {},
  toggle: () => {},
});

export function SimpleModeProvider({ children }: { children: ReactNode }) {
  const [simple, setSimpleState] = useState(false);

  // Read persisted value after mount (avoid SSR hydration mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "1") setSimpleState(true);
    } catch {
      /* ignore */
    }
  }, []);

  // Reflect state on <html data-simple-mode="…"> so CSS / other panels can react.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.simpleMode = simple ? "on" : "off";
  }, [simple]);

  const setSimple = useCallback((v: boolean) => {
    setSimpleState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => setSimple(!simple), [simple, setSimple]);

  return (
    <SimpleModeContext.Provider value={{ simple, setSimple, toggle }}>
      {children}
    </SimpleModeContext.Provider>
  );
}

export function useSimpleMode() {
  return useContext(SimpleModeContext);
}

// ─── Plain-English glossary ──────────────────────────────────────────────
// Reused across the UI: when Simple Mode is ON, jargon can be replaced or
// annotated with these friendlier explanations. Nothing here changes any
// scanner logic — this is purely presentation copy.

export const PLAIN_ENGLISH: Record<string, { label: string; blurb: string }> = {
  RSI: {
    label: "Momentum score",
    blurb: "How strong recent buying or selling has been. Below 30 = oversold, above 70 = overheated.",
  },
  ATR: {
    label: "Typical daily swing",
    blurb: "How much this ticker usually moves in a day. Bigger = wilder price swings.",
  },
  SMA20: { label: "20-day average price", blurb: "The average close over the last 20 trading days." },
  SMA50: { label: "50-day average price", blurb: "The average close over the last 50 trading days." },
  SMA200: {
    label: "Long-term trend line",
    blurb: "The 200-day average. Above it = uptrend, below = downtrend.",
  },
  EMA9: { label: "Short-term trend line", blurb: "A fast 9-day moving average that reacts quickly." },
  NO_DIP: { label: "No pullback yet", blurb: "Prices are elevated — nothing to buy into right now." },
  FAKE_OUT: { label: "Weak signal", blurb: "The dip may be misleading or too thin. Be patient." },
  FAST_CRASH: { label: "Fast selloff", blurb: "A sharp drop that can bounce, but risk is elevated." },
  SLOW_BLEED: { label: "Slow weakness", blurb: "Steady selling pressure. Wait for stronger evidence." },
  V_BOUNCE_LIKELY: { label: "Sharp rebound likely", blurb: "Setup that historically bounces fast." },
  SUPPORT_TEST: { label: "Testing support", blurb: "Price is near an important support area; watch if it holds." },
  WATCH: { label: "Just watch", blurb: "Not ready yet — keep an eye on it." },
  PROBE: { label: "Small test buy", blurb: "Consider a small starter position to test the waters." },
  BUY_STARTER: { label: "Start buying", blurb: "Good spot for your first tranche." },
  BUY_LADDER: { label: "Buy the full ladder", blurb: "Strong setup — execute the planned tranches." },
};

/**
 * Small inline helper for Simple Mode: renders a subtle plain-English
 * subtitle beneath a technical label. Returns null when Simple Mode is off,
 * so it can be dropped in anywhere without affecting the pro layout.
 */
export function PlainHint({ children }: { children: ReactNode }) {
  const { simple } = useSimpleMode();
  if (!simple) return null;
  return (
    <div className="mt-1 text-[11px] leading-snug text-cyan-100/70">
      {children}
    </div>
  );
}
