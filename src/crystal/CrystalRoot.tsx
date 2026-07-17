import type { ReactNode } from "react";
import { AbyssBackdrop } from "./AbyssBackdrop";

// Every crystal page mounts inside this wrapper so tokens + backdrop
// scope correctly. The inline SVG defs provide the real optical
// refraction filter used by every glass surface via `backdrop-filter`.
export function CrystalRoot({ children }: { children: ReactNode }) {
  return (
    <div className="crystal-root relative min-h-screen">
      <CrystalFilters />
      <AbyssBackdrop />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// Real refraction: feTurbulence generates a smooth noise field which
// feDisplacementMap uses to bend the pixels sampled from behind the
// surface. The result is a subtle, physically-plausible warp that a
// pure CSS blur cannot produce. Three filter presets so different
// surface sizes get proportional refraction.
function CrystalFilters() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute -z-50 h-0 w-0"
      focusable="false"
    >
      <defs>
        <filter id="cr-refract-lg" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.009 0.013" numOctaves="2" seed="17" result="n" />
          <feGaussianBlur in="n" stdDeviation="1.6" result="nb" />
          <feDisplacementMap in="SourceGraphic" in2="nb" scale="34" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="cr-refract-md" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.014 0.018" numOctaves="2" seed="41" result="n" />
          <feGaussianBlur in="n" stdDeviation="1.2" result="nb" />
          <feDisplacementMap in="SourceGraphic" in2="nb" scale="22" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="cr-refract-sm" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.026" numOctaves="1" seed="7" result="n" />
          <feGaussianBlur in="n" stdDeviation="0.8" result="nb" />
          <feDisplacementMap in="SourceGraphic" in2="nb" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
