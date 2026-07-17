// In-memory per-provider counters. Reset on cold start. Read via
// /api/public/health/providers to spot degradation quickly.
export type ProviderName = "yahoo" | "finnhub" | "twelvedata" | "nasdaq" | "stooq" | "telegram";

type Bucket = {
  ok: number;
  fail: number;
  totalLatencyMs: number;
  lastOkAt: number | null;
  lastFailAt: number | null;
  lastError: string | null;
};

const buckets: Record<ProviderName, Bucket> = {
  yahoo: emptyBucket(),
  finnhub: emptyBucket(),
  twelvedata: emptyBucket(),
  nasdaq: emptyBucket(),
  stooq: emptyBucket(),
  telegram: emptyBucket(),
};

function emptyBucket(): Bucket {
  return { ok: 0, fail: 0, totalLatencyMs: 0, lastOkAt: null, lastFailAt: null, lastError: null };
}

export function recordProvider(
  name: ProviderName,
  ok: boolean,
  latencyMs: number,
  error?: string | null,
) {
  const b = buckets[name];
  if (!b) return;
  if (ok) {
    b.ok++;
    b.lastOkAt = Date.now();
  } else {
    b.fail++;
    b.lastFailAt = Date.now();
    if (error) b.lastError = error.slice(0, 200);
  }
  b.totalLatencyMs += Math.max(0, latencyMs);
}

export function snapshotProviderStats() {
  const out: Record<string, unknown> = {};
  for (const [name, b] of Object.entries(buckets)) {
    const total = b.ok + b.fail;
    out[name] = {
      ok: b.ok,
      fail: b.fail,
      total,
      successRate: total > 0 ? +(b.ok / total).toFixed(4) : null,
      avgLatencyMs: total > 0 ? Math.round(b.totalLatencyMs / total) : null,
      lastOkAt: b.lastOkAt ? new Date(b.lastOkAt).toISOString() : null,
      lastFailAt: b.lastFailAt ? new Date(b.lastFailAt).toISOString() : null,
      lastError: b.lastError,
    };
  }
  return out;
}
