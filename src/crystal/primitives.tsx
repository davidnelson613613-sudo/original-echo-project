// Crystal primitives. Every reusable surface, control, and text style
// lives here. Components are ref-forwarded so they slot into existing
// keyboard / focus flows.
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

function cx(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

/* ─────────── Slab: primary floating crystal surface ─────────── */
export const CrystalSlab = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { hoverable?: boolean; rise?: boolean }
>(function CrystalSlab({ className, hoverable, rise, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={cx("cr-slab", hoverable && "cr-hoverable", rise && "cr-rise", className)}
      {...rest}
    />
  );
});

/* ─────────── Pane: softer floating container ─────────── */
export const CrystalPane = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { rise?: boolean }
>(function CrystalPane({ className, rise, ...rest }, ref) {
  return <div ref={ref} className={cx("cr-pane", rise && "cr-rise", className)} {...rest} />;
});

/* ─────────── Pill: capsule button ─────────── */
export const CrystalPill = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    ghost?: boolean;
    icon?: ReactNode;
  }
>(function CrystalPill({ className, active, ghost, icon, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      data-active={active ? "true" : "false"}
      className={cx("cr-pill", ghost && "cr-pill-ghost", className)}
      {...rest}
    >
      {icon}
      {children != null && <span>{children}</span>}
    </button>
  );
});

/* ─────────── Orb: circular icon button ─────────── */
export const CrystalOrb = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    label?: string;
    size?: number;
  }
>(function CrystalOrb({ className, active, label, size, style, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      data-active={active ? "true" : "false"}
      aria-label={label}
      title={label}
      className={cx("cr-orb", className)}
      style={size ? { ...style, ["--sz" as unknown as string]: `${size}px` } : style}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ─────────── Segmented curved control ─────────── */
export function CrystalSegmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("cr-segmented", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          data-active={value === o.value ? "true" : "false"}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────── Typography ─────────── */
export function MicroLabel({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <span className={cx("cr-micro", className)} style={style}>{children}</span>;
}
export function StatNum({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <span className={cx("cr-num", className)} style={style}>{children}</span>;
}
export function Serif({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <span className={cx("cr-serif", className)} style={style}>{children}</span>;
}

/* ─────────── ProgressArc: soft SVG stroke arc for scores ─────────── */
export function ProgressArc({
  value,
  size = 44,
  tone = "#67e8f9",
  label,
}: {
  value: number; // 0-100
  size?: number;
  tone?: string;
  label?: ReactNode;
}) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative inline-grid place-items-center" style={{ height: size, width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{
            transition: "stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1)",
            filter: `drop-shadow(0 0 6px ${tone}88)`,
          }}
        />
      </svg>
      {label != null && (
        <div className="absolute inset-0 grid place-items-center text-[10px] font-medium text-white/80 tabular-nums">
          {label}
        </div>
      )}
    </div>
  );
}

/* ─────────── ScoreRay: horizontal thin bar with soft glow ─────────── */
export function ScoreRay({
  value,
  tone = "#67e8f9",
  label,
}: {
  value: number;
  tone?: string;
  label?: string;
}) {
  const pct = Math.max(2, Math.min(100, value));
  return (
    <div className="flex items-center gap-3 text-[10px]">
      {label && (
        <span className="w-12 shrink-0 font-mono uppercase tracking-[0.2em] text-white/45">
          {label}
        </span>
      )}
      <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${tone}, rgba(232,246,255,0.85))`,
            boxShadow: `0 0 12px ${tone}88`,
            transition: "width 700ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums text-white/85">
        {value.toFixed(0)}
      </span>
    </div>
  );
}
