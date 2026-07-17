// Stagger helper — returns a style with an animation-delay derived from
// an index so a grid or list rises into place instead of snapping in.
export function riseDelay(i: number, stepMs = 55, cap = 480): React.CSSProperties {
  return { animationDelay: `${Math.min(i * stepMs, cap)}ms` };
}
