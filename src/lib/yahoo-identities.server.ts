// Shared Yahoo Finance fingerprint pool.
//
// Both `yahoo.server.ts` (analog / deep-history) and `market.server.ts`
// (live scan path) import from here so the pool never drifts between the
// two hot paths. Yahoo only serves 2 chart hosts, so the fan-out has to
// come from User-Agent × Accept-Language variety.
//
// ─── Design (combinatorial synthesizer) ──────────────────────────────────
// Older revisions hardcoded ~120 User-Agent strings × 50 languages × 2
// hosts = ~12k static identities. That's plenty for a single scan burst,
// but the hardcoded UAs go stale (Chrome ships a new major every ~4 weeks),
// so the pool needed manual refreshes forever.
//
// This revision replaces the static list with a *synthesizer*. Identities
// are generated on demand from small orthogonal component pools:
//
//   OS families        × browser families × version buckets ×
//   Accept-Language    × Yahoo host
//
// Multiplying it out yields well over one million unique fingerprints, and
// the version buckets scale with the calendar (see `chromeVersion(seed)`
// below) so the pool doesn't need code changes as Chrome/Safari/Firefox
// keep incrementing.
//
// Consumers still use it as an array — `YAHOO_IDENTITIES[i]` and
// `YAHOO_IDENTITIES.length` — via a lazy Proxy, so we never allocate a
// million objects at startup.

export const YAHOO_HOSTS = [
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
] as const;

export type YahooIdentity = {
  host: (typeof YAHOO_HOSTS)[number];
  ua: string;
  lang: string;
};

// ─── Accept-Language pool ────────────────────────────────────────────────
const LANG_BASES = [
  "en-US", "en-GB", "en-CA", "en-AU", "en-IN", "en-NZ", "en-IE", "en-ZA",
  "en-SG", "en-PH", "en-HK", "en-MY",
] as const;
const LANG_SECONDARIES = [
  null, "fr", "es", "de", "pt", "ja", "it", "nl", "ko", "zh-CN", "zh-TW",
  "sv", "da", "fi", "no", "pl", "cs", "tr", "ar", "hi", "th", "vi", "id",
  "ru", "uk", "he", "ro", "hu", "el", "bg",
] as const;
const LANG_TERTIARIES = [
  null, "fr", "es", "de", "pt", "it", "ja", "ko", "zh-CN",
] as const;

// (12 * 30 * 9) = 3,240 unique Accept-Language strings.
const LANG_COUNT = LANG_BASES.length * LANG_SECONDARIES.length * LANG_TERTIARIES.length;

function langAt(idx: number): string {
  const t = idx % LANG_TERTIARIES.length;
  const s = Math.floor(idx / LANG_TERTIARIES.length) % LANG_SECONDARIES.length;
  const b = Math.floor(idx / (LANG_TERTIARIES.length * LANG_SECONDARIES.length)) % LANG_BASES.length;
  const parts: string[] = [`${LANG_BASES[b]},en;q=0.9`];
  const sec = LANG_SECONDARIES[s];
  const ter = LANG_TERTIARIES[t];
  if (sec) parts.push(`${sec};q=0.7`);
  if (ter && ter !== sec) parts.push(`${ter};q=0.5`);
  return parts.join(",");
}

// ─── OS pool ─────────────────────────────────────────────────────────────
// Each entry is (osToken, appleWebKitOverride?, mobile?)
type OsTemplate = {
  name: string;
  token: string;
  platform: "desktop" | "mobile-ios" | "mobile-android";
};

const OS_POOL: OsTemplate[] = [
  { name: "win10",    token: "Windows NT 10.0; Win64; x64",                            platform: "desktop" },
  { name: "win11",    token: "Windows NT 11.0; Win64; x64",                            platform: "desktop" },
  { name: "mac13",    token: "Macintosh; Intel Mac OS X 13_6_5",                       platform: "desktop" },
  { name: "mac14a",   token: "Macintosh; Intel Mac OS X 14_2_1",                       platform: "desktop" },
  { name: "mac14b",   token: "Macintosh; Intel Mac OS X 14_5",                         platform: "desktop" },
  { name: "mac14c",   token: "Macintosh; Intel Mac OS X 14_6_1",                       platform: "desktop" },
  { name: "mac15a",   token: "Macintosh; Intel Mac OS X 15_0",                         platform: "desktop" },
  { name: "mac15b",   token: "Macintosh; Intel Mac OS X 15_1",                         platform: "desktop" },
  { name: "mac15c",   token: "Macintosh; Intel Mac OS X 15_2",                         platform: "desktop" },
  { name: "mac15d",   token: "Macintosh; Intel Mac OS X 15_3",                         platform: "desktop" },
  { name: "mac10",    token: "Macintosh; Intel Mac OS X 10_15_7",                      platform: "desktop" },
  { name: "linux",    token: "X11; Linux x86_64",                                       platform: "desktop" },
  { name: "ubuntu",   token: "X11; Ubuntu; Linux x86_64",                               platform: "desktop" },
  { name: "fedora",   token: "X11; Fedora; Linux x86_64",                               platform: "desktop" },
  { name: "chromeos", token: "X11; CrOS x86_64 15786.62.0",                             platform: "desktop" },
  { name: "iphone16", token: "iPhone; CPU iPhone OS 16_7 like Mac OS X",                platform: "mobile-ios" },
  { name: "iphone17", token: "iPhone; CPU iPhone OS 17_4 like Mac OS X",                platform: "mobile-ios" },
  { name: "iphone17b",token: "iPhone; CPU iPhone OS 17_6 like Mac OS X",                platform: "mobile-ios" },
  { name: "iphone18", token: "iPhone; CPU iPhone OS 18_1 like Mac OS X",                platform: "mobile-ios" },
  { name: "iphone18b",token: "iPhone; CPU iPhone OS 18_2 like Mac OS X",                platform: "mobile-ios" },
  { name: "ipad17",   token: "iPad; CPU OS 17_4 like Mac OS X",                         platform: "mobile-ios" },
  { name: "ipad18",   token: "iPad; CPU OS 18_1 like Mac OS X",                         platform: "mobile-ios" },
  { name: "androidPixel8", token: "Linux; Android 14; Pixel 8",                         platform: "mobile-android" },
  { name: "androidPixel9", token: "Linux; Android 14; Pixel 9",                         platform: "mobile-android" },
  { name: "androidPixel9p",token: "Linux; Android 15; Pixel 9 Pro",                     platform: "mobile-android" },
  { name: "androidS24",    token: "Linux; Android 14; SM-S928B",                        platform: "mobile-android" },
  { name: "androidS25",    token: "Linux; Android 15; SM-S931B",                        platform: "mobile-android" },
  { name: "androidS23",    token: "Linux; Android 14; SM-S918B",                        platform: "mobile-android" },
  { name: "androidA54",    token: "Linux; Android 13; SM-A546B",                        platform: "mobile-android" },
];

// ─── Version buckets (calendar-scaling) ──────────────────────────────────
// Chrome releases roughly one major every 4 weeks. Anchor a floor at
// v120 (Dec 2023) and add ~13 majors per calendar year past 2024. Combined
// with the ±10 spread below, this keeps the version pool aligned with
// whatever's live when the worker restarts — no code changes required.
function currentChromeMajor(): number {
  const now = new Date();
  const monthsSinceAnchor =
    (now.getUTCFullYear() - 2023) * 12 + (now.getUTCMonth() - 11); // Dec 2023 = 0
  const est = 120 + Math.floor(monthsSinceAnchor); // ~1 major per month
  return Math.max(120, Math.min(est, 260));        // hard cap so we don't drift absurdly
}
const CHROME_MAJOR_NOW = currentChromeMajor();
// 24 majors of variety (~2 years wide) — plenty of fingerprint spread.
const CHROME_MAJORS = Array.from({ length: 24 }, (_, i) => CHROME_MAJOR_NOW - 20 + i);

const FIREFOX_MAJORS = Array.from({ length: 20 }, (_, i) => 121 + i);
const SAFARI_VERSIONS = [
  "16.6", "17.2", "17.3", "17.4", "17.4.1", "17.5", "17.6", "18.0", "18.1", "18.2",
] as const;

// ─── Browser families ────────────────────────────────────────────────────
type BrowserFamily = "chrome" | "edge" | "opera" | "firefox" | "safari" | "samsung";
const DESKTOP_BROWSERS: BrowserFamily[] = ["chrome", "edge", "opera", "firefox", "safari"];
const IOS_BROWSERS: BrowserFamily[] = ["safari", "chrome"];
const ANDROID_BROWSERS: BrowserFamily[] = ["chrome", "samsung", "firefox"];

// ─── UA synthesizer ──────────────────────────────────────────────────────
function chromeUA(osToken: string, major: number, mobile: boolean): string {
  const suffix = mobile ? "Mobile Safari/537.36" : "Safari/537.36";
  return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 ${suffix}`;
}
function edgeUA(osToken: string, major: number): string {
  const build = 2000 + ((major * 37) % 999); // deterministic pseudo-build
  return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.${build}.51`;
}
function operaUA(osToken: string, major: number): string {
  const opr = 105 + (major - 120); // rough Opera↔Chrome mapping
  return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 OPR/${opr}.0.5000.34`;
}
function firefoxUA(osToken: string, major: number, mobile: boolean): string {
  if (mobile) {
    return `Mozilla/5.0 (Android 14; Mobile; rv:${major}.0) Gecko/${major}.0 Firefox/${major}.0`;
  }
  return `Mozilla/5.0 (${osToken}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
}
function safariMacUA(osToken: string, version: string): string {
  return `Mozilla/5.0 (${osToken}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`;
}
function safariIosUA(osToken: string, version: string): string {
  return `Mozilla/5.0 (${osToken}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`;
}
function samsungUA(osToken: string, major: number): string {
  const sbrowser = 20 + (major % 8);
  return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/${sbrowser}.0 Chrome/${major}.0.0.0 Mobile Safari/537.36`;
}

function buildUA(osIdx: number, browserIdx: number, versionIdx: number): string {
  const os = OS_POOL[osIdx % OS_POOL.length];
  const families =
    os.platform === "mobile-ios"     ? IOS_BROWSERS :
    os.platform === "mobile-android" ? ANDROID_BROWSERS :
                                       DESKTOP_BROWSERS;
  const family = families[browserIdx % families.length];
  const mobile = os.platform !== "desktop";

  switch (family) {
    case "chrome":  return chromeUA(os.token, CHROME_MAJORS[versionIdx % CHROME_MAJORS.length], mobile);
    case "edge":    return edgeUA(os.token,   CHROME_MAJORS[versionIdx % CHROME_MAJORS.length]);
    case "opera":   return operaUA(os.token,  CHROME_MAJORS[versionIdx % CHROME_MAJORS.length]);
    case "firefox": return firefoxUA(os.token, FIREFOX_MAJORS[versionIdx % FIREFOX_MAJORS.length], mobile);
    case "safari":  return os.platform === "mobile-ios"
                      ? safariIosUA(os.token, SAFARI_VERSIONS[versionIdx % SAFARI_VERSIONS.length])
                      : safariMacUA(os.token, SAFARI_VERSIONS[versionIdx % SAFARI_VERSIONS.length]);
    case "samsung": return samsungUA(os.token, CHROME_MAJORS[versionIdx % CHROME_MAJORS.length]);
  }
}

// ─── Pool sizing ─────────────────────────────────────────────────────────
// 29 OSes × 5 browser slots × 24 versions × 3,240 languages × 2 hosts
// = ~22.5 million unique fingerprints. We cap the virtual pool at 1M —
// that's already >> any single-day request volume and keeps index math
// cheap. Bumping this ceiling is a one-line change if we ever need more.
const OS_COUNT = OS_POOL.length;
const BROWSER_SLOTS = 5;          // max family count per OS platform
const VERSION_COUNT = CHROME_MAJORS.length;
const HOST_COUNT = YAHOO_HOSTS.length;

const RAW_POOL_SIZE = OS_COUNT * BROWSER_SLOTS * VERSION_COUNT * LANG_COUNT * HOST_COUNT;
const SYNTHETIC_POOL_SIZE = Math.min(1_000_000, RAW_POOL_SIZE);

function identityAt(index: number): YahooIdentity {
  const i = ((index % SYNTHETIC_POOL_SIZE) + SYNTHETIC_POOL_SIZE) % SYNTHETIC_POOL_SIZE;

  // Host is the innermost dimension so adjacent attempts alternate
  // query1 ↔ query2 (matches the invariant the two hot paths rely on).
  const host = YAHOO_HOSTS[i % HOST_COUNT];
  let rest = Math.floor(i / HOST_COUNT);

  const langIdx = rest % LANG_COUNT;
  rest = Math.floor(rest / LANG_COUNT);

  const versionIdx = rest % VERSION_COUNT;
  rest = Math.floor(rest / VERSION_COUNT);

  const browserIdx = rest % BROWSER_SLOTS;
  rest = Math.floor(rest / BROWSER_SLOTS);

  const osIdx = rest % OS_COUNT;

  return { host, ua: buildUA(osIdx, browserIdx, versionIdx), lang: langAt(langIdx) };
}

// ─── Pacing ──────────────────────────────────────────────────────────────
let yahooQueue: Promise<void> = Promise.resolve();
let lastYahooRequestAt = 0;
const YAHOO_MIN_GAP_MS = 250;

export async function withYahooPace<T>(task: () => Promise<T>): Promise<T> {
  const previous = yahooQueue;
  let release!: () => void;
  yahooQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const waitMs = Math.max(0, YAHOO_MIN_GAP_MS - (Date.now() - lastYahooRequestAt));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastYahooRequestAt = Date.now();
  try {
    return await task();
  } finally {
    release();
  }
}

// ─── Circuit breaker ─────────────────────────────────────────────────────
// Yahoo's chart endpoint hits rate-limit windows in bursts. When it does,
// every one of our 64 rotated attempts still burns latency before we fail
// over to Finnhub/TwelveData. Track a rolling window of recent results and
// short-circuit further Yahoo calls when the failure ratio blows past the
// threshold, until a cooldown elapses.
const CB_WINDOW = 40;              // most recent N results considered
const CB_MIN_SAMPLES = 12;         // don't trip on tiny samples
const CB_FAIL_RATIO_TRIP = 0.75;   // trip when 75%+ of window failed
const CB_COOLDOWN_MS = 30_000;     // skip Yahoo for 30s once tripped

const recentResults: boolean[] = []; // true=ok, false=fail
let breakerOpenUntil = 0;
let breakerTrips = 0;

export function recordYahooResult(ok: boolean) {
  recentResults.push(ok);
  if (recentResults.length > CB_WINDOW) recentResults.shift();
  if (recentResults.length >= CB_MIN_SAMPLES) {
    const fails = recentResults.reduce((n, v) => n + (v ? 0 : 1), 0);
    if (fails / recentResults.length >= CB_FAIL_RATIO_TRIP && Date.now() >= breakerOpenUntil) {
      breakerOpenUntil = Date.now() + CB_COOLDOWN_MS;
      breakerTrips++;
      recentResults.length = 0; // reset window so we don't immediately re-trip
      // Fire-and-forget system alert; dedup handled inside notifySystemEvent.
      import("@/lib/telegram-notify.server")
        .then((m) => m.notifySystemEvent("warn", "yahoo_circuit_open",
          `Yahoo circuit tripped (fails=${fails}/${CB_WINDOW}). Skipping Yahoo for ${CB_COOLDOWN_MS / 1000}s.`))
        .catch(() => {});
    }
  }
}

export function isYahooCircuitOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}

export function yahooBreakerSnapshot() {
  const fails = recentResults.reduce((n, v) => n + (v ? 0 : 1), 0);
  return {
    open: isYahooCircuitOpen(),
    openUntil: breakerOpenUntil ? new Date(breakerOpenUntil).toISOString() : null,
    trips: breakerTrips,
    windowSize: recentResults.length,
    windowFails: fails,
    windowFailRatio: recentResults.length ? +(fails / recentResults.length).toFixed(3) : null,
  };
}



// ─── Public array-shaped facade ──────────────────────────────────────────
// Callers use YAHOO_IDENTITIES[i] and YAHOO_IDENTITIES.length. A Proxy over
// an empty array preserves that contract while materializing identities on
// demand — zero startup allocation, million-entry virtual pool.
export const YAHOO_IDENTITIES: readonly YahooIdentity[] = new Proxy([] as YahooIdentity[], {
  get(target, prop, receiver) {
    if (prop === "length") return SYNTHETIC_POOL_SIZE;
    if (typeof prop === "string") {
      const n = Number(prop);
      if (Number.isInteger(n) && n >= 0) return identityAt(n);
    }
    return Reflect.get(target, prop, receiver);
  },
  has(_target, prop) {
    if (prop === "length") return true;
    if (typeof prop === "string") {
      const n = Number(prop);
      return Number.isInteger(n) && n >= 0 && n < SYNTHETIC_POOL_SIZE;
    }
    return false;
  },
}) as readonly YahooIdentity[];

// Exported for diagnostics / logging.
export const YAHOO_POOL_SIZE = SYNTHETIC_POOL_SIZE;
