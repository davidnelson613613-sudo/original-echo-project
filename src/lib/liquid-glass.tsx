// Crystal — optional appearance mode.
//
// Adds/removes `crystal` on <html>. All visual work lives inside
// src/crystal/ and only applies when a `.crystal-root` wrapper is
// mounted, so the classic UI is completely untouched. Preference
// persists via the pre-existing `laddrx.liquidGlass` storage key.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "laddrx.liquidGlass";
const HTML_CLASS = "crystal";

type Ctx = { enabled: boolean; setEnabled: (v: boolean) => void; toggle: () => void };

const LiquidGlassCtx = createContext<Ctx>({
  enabled: false,
  setEnabled: () => {},
  toggle: () => {},
});

function applyClass(on: boolean) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (on) el.classList.add(HTML_CLASS);
  else el.classList.remove(HTML_CLASS);
}

export function LiquidGlassProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);

  // Read persisted preference after hydration to avoid SSR mismatch.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "1") {
        setEnabledState(true);
        applyClass(true);
      }
    } catch { /* ignore */ }
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    applyClass(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  return (
    <LiquidGlassCtx.Provider value={{ enabled, setEnabled, toggle }}>
      {children}
    </LiquidGlassCtx.Provider>
  );
}

export function useLiquidGlass() {
  return useContext(LiquidGlassCtx);
}
