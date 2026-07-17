// TwelveData key pool for the Historical Analog Scanner.
//
// Dedicated analog keys are tried first. The general configured TwelveData keys
// are included as overflow capacity so deep-history scans do not fail just
// because one tiny pool hits a minute/credit limit during a full dashboard scan.

const EXHAUSTION_TTL_MS = 60 * 60 * 1000;
const exhaustedUntil = new Map<string, number>();

export function getAnalogKeys(): string[] {
  const raw = [
    process.env.TWELVEDATA_ANALOG_API_KEY_1,
    process.env.TWELVEDATA_ANALOG_API_KEY_2,
    process.env.TWELVEDATA_API_KEY,
    process.env.TWELVEDATA_API_KEY_2,
    process.env.TWELVEDATA_API_KEY_3,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    if (!k) continue;
    const key = k.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function hasAnalogKey(): boolean {
  return getAnalogKeys().length > 0;
}

function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const name = err instanceof Error ? err.name : "";
  return (
    name === "AbortError" ||
    msg === "RATE_LIMIT" ||
    msg.includes("429") ||
    /out of api credits/i.test(msg) ||
    /rate limit/i.test(msg) ||
    /timeout/i.test(msg) ||
    /aborted/i.test(msg)
  );
}

function liveKeys(): string[] {
  const now = Date.now();
  const all = getAnalogKeys();
  const live = all.filter((k) => {
    const exp = exhaustedUntil.get(k);
    return !exp || exp <= now;
  });
  return live.length > 0 ? live : all;
}

let rrCursor = 0;
function orderedLiveKeys(): string[] {
  const live = liveKeys();
  if (live.length <= 1) return live;
  const start = rrCursor % live.length;
  rrCursor = (rrCursor + 1) % live.length;
  return [...live.slice(start), ...live.slice(0, start)];
}

export async function withAnalogKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
  const keys = orderedLiveKeys();
  if (keys.length === 0) {
    throw new Error("Server is missing TwelveData keys for the Historical Analog Scanner.");
  }
  let lastErr: unknown = null;
  for (const key of keys) {
    try {
      return await fn(key);
    } catch (e) {
      lastErr = e;
      if (isRateLimit(e)) {
        exhaustedUntil.set(key, Date.now() + EXHAUSTION_TTL_MS);
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("RATE_LIMIT");
}
