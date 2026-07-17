// Multi-key rotation for the TwelveData API.
//
// Reads TWELVEDATA_API_KEY plus TWELVEDATA_API_KEY_2..TWELVEDATA_API_KEY_5
// plus TWELVEDATA_API_KEY_6 (also accepts TWELVEDATA_API_KEY_1 as an alias
// for the primary). Any key
// that returns a 429 / "RATE_LIMIT" / "out of API credits" response is
// marked exhausted in-memory and skipped for `EXHAUSTION_TTL_MS` before we
// probe it again. `withRotatingKey` runs the caller's fetch closure against
// each live key in turn, so a single call transparently fails over.

// Free-tier 429s are usually the rolling per-minute bucket, not a broken key.
// Parking for an hour made healthy keys look dead long after the minute reset.
const EXHAUSTION_TTL_MS = 90 * 1000;

const exhaustedUntil = new Map<string, number>();

export function getTwelveDataKeys(): string[] {
  const raw = [
    process.env.TWELVEDATA_API_KEY,
    process.env.TWELVEDATA_API_KEY_1,
    process.env.TWELVEDATA_API_KEY_2,
    process.env.TWELVEDATA_API_KEY_3,
    process.env.TWELVEDATA_API_KEY_4,
    process.env.TWELVEDATA_API_KEY_5,
    process.env.TWELVEDATA_API_KEY_6,
    process.env.TWELVEDATA_API_KEY_7,
    process.env.TWELVEDATA_API_KEY_8,
    process.env.TWELVEDATA_API_KEY_9,
    process.env.TWELVEDATA_API_KEY_10,
    process.env.TWELVEDATA_API_KEY_11,
    process.env.TWELVEDATA_API_KEY_12,
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

function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg === "RATE_LIMIT" ||
    msg.includes("429") ||
    /out of api credits/i.test(msg) ||
    /rate limit/i.test(msg)
  );
}

// A key that TwelveData rejects with 401/403 (invalid, revoked, or
// unauthorized for the requested resource) should be skipped just like a
// rate-limited one — otherwise a single bad key kills every scan.
function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /HTTP 401/.test(msg) ||
    /HTTP 403/.test(msg) ||
    /\bcode\s*401\b/i.test(msg) ||
    /\bcode\s*403\b/i.test(msg) ||
    /invalid api key/i.test(msg) ||
    /unauthori[sz]ed/i.test(msg)
  );
}

function liveKeys(): string[] {
  const now = Date.now();
  const all = getTwelveDataKeys();
  const live = all.filter((k) => {
    const exp = exhaustedUntil.get(k);
    return !exp || exp <= now;
  });
  // Always re-probe one parked key. The free-tier minute bucket often recovers
  // long before the in-memory TTL, and worker/dev processes can keep old
  // exhaustion state around after secrets are fixed.
  if (live.length === all.length) return live;
  const parked = all.filter((k) => !live.includes(k));
  const probe = parked.length ? parked[rrCursor % parked.length] : null;
  return probe ? [...live, probe] : live.length > 0 ? live : all;
}

export function markKeyExhausted(key: string): void {
  exhaustedUntil.set(key, Date.now() + EXHAUSTION_TTL_MS);
}

// Round-robin cursor so successive callers spread load across every live key
// instead of hammering key #0 until it 429s. Combined with the failover loop
// below, N keys behave like one pool with ~N× the per-minute budget.
let rrCursor = 0;

function orderedLiveKeys(): string[] {
  const live = liveKeys();
  if (live.length <= 1) return live;
  const start = rrCursor % live.length;
  rrCursor = (rrCursor + 1) % live.length;
  return [...live.slice(start), ...live.slice(0, start)];
}

export async function withRotatingKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
  const keys = orderedLiveKeys();
  if (keys.length === 0) {
    throw new Error("Server is missing TWELVEDATA_API_KEY.");
  }
  let lastErr: unknown = null;
  for (const key of keys) {
    try {
      return await fn(key);
    } catch (e) {
      lastErr = e;
      if (isRateLimit(e) || isAuthFailure(e)) {
        markKeyExhausted(key);
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("RATE_LIMIT");
}

export function hasAnyKey(): boolean {
  return getTwelveDataKeys().length > 0;
}
