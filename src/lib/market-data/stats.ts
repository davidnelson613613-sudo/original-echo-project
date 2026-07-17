// Pure math utilities for the Systemic Risk Engine. No I/O; safe anywhere.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function std(xs: number[], sample = true): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (sample ? xs.length - 1 : xs.length));
}

export function zscore(x: number, xs: number[]): number {
  const sd = std(xs);
  if (sd === 0 || !Number.isFinite(sd)) return 0;
  return (x - mean(xs)) / sd;
}

/** Percentile rank of x within xs, 0..1 */
export function percentileRank(x: number, xs: number[]): number {
  if (xs.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const v of xs) {
    if (v < x) below += 1;
    else if (v === x) equal += 1;
  }
  return (below + 0.5 * equal) / xs.length;
}

/** Clip to [lo,hi] */
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Cosine similarity of two equal-length numeric vectors. Returns [-1,1]. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Euclidean distance between two vectors */
export function euclid(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Year-over-year percent change from monthly series indexed by date string */
export function yoyPct(values: { date: string; value: number }[], iso: string): number | null {
  const idx = values.findIndex((v) => v.date === iso);
  if (idx < 12) return null;
  const cur = values[idx].value;
  const prev = values[idx - 12]?.value;
  if (prev == null || prev === 0) return null;
  return (cur - prev) / prev;
}

/** N-day % change ending on iso */
export function pctChangeDays(
  values: { date: string; value: number }[],
  iso: string,
  lookbackDays: number,
): number | null {
  const target = new Date(iso).getTime();
  const cutoff = target - lookbackDays * 86_400_000;
  const cur = values.find((v) => v.date === iso);
  if (!cur) return null;
  // walk back for the most recent value at or before cutoff
  let prev: { date: string; value: number } | null = null;
  for (const v of values) {
    if (new Date(v.date).getTime() <= cutoff) prev = v;
    else break;
  }
  if (!prev || prev.value === 0) return null;
  return (cur.value - prev.value) / prev.value;
}

/** Last value on or before iso */
export function valueAt(
  values: { date: string; value: number }[],
  iso: string,
): { date: string; value: number } | null {
  let last: { date: string; value: number } | null = null;
  const t = new Date(iso).getTime();
  for (const v of values) {
    if (new Date(v.date).getTime() <= t) last = v;
    else break;
  }
  return last;
}

/** Rolling window slice: values in [iso - windowDays, iso] */
export function rollingWindow(
  values: { date: string; value: number }[],
  iso: string,
  windowDays: number,
): number[] {
  const t = new Date(iso).getTime();
  const lo = t - windowDays * 86_400_000;
  const out: number[] = [];
  for (const v of values) {
    const vt = new Date(v.date).getTime();
    if (vt >= lo && vt <= t) out.push(v.value);
  }
  return out;
}

/** All values whose date is on or before iso (expanding window) */
export function historyUpTo(
  values: { date: string; value: number }[],
  iso: string,
): number[] {
  const t = new Date(iso).getTime();
  const out: number[] = [];
  for (const v of values) {
    if (new Date(v.date).getTime() <= t) out.push(v.value);
    else break;
  }
  return out;
}
