/**
 * Sampling policy for the auto request-completion log line only. Domain / event
 * logs (`logger.warn("bandit fallback …")`, cron summaries) follow the level,
 * never this. Errors are never sampled out; successful writes are always kept;
 * high-volume noise (401 expired sessions, 404 scanners, GET 200s) is thinned.
 *
 * The roll is deterministic per trace so every line of one request survives or
 * drops together; a request slower than `slowMs` is always kept regardless.
 */
const SAMPLE_RATES: Record<string, number> = {
  "2xx-get": 0.01,
  "2xx-write": 1, // POST/PATCH/PUT/DELETE success — cheap + valuable
  "3xx": 0.01,
  "400": 0.1,
  "401": 0.08,
  "403": 1,
  "404": 0.05,
  "429": 0.08,
  "4xx": 0.1,
};

export const DEFAULT_SLOW_MS = 1000;

function rateFor(method: string, status: number): number {
  if (status >= 500) return 1;
  if (status >= 400) {
    return SAMPLE_RATES[String(status)] ?? SAMPLE_RATES["4xx"] ?? 1;
  }
  if (status >= 300) return SAMPLE_RATES["3xx"] ?? 1;
  if (status >= 200) {
    return method === "GET"
      ? (SAMPLE_RATES["2xx-get"] ?? 1)
      : (SAMPLE_RATES["2xx-write"] ?? 1);
  }
  return 1;
}

/** 0..1, stable for a given trace; falls back to random when untraced. */
function roll(traceId?: string): number {
  if (traceId && traceId.length >= 8) {
    return parseInt(traceId.slice(0, 8), 16) / 0xffffffff;
  }
  return Math.random();
}

export function shouldLogRequest(args: {
  method: string;
  status: number;
  durationMs: number;
  traceId?: string;
  slowMs?: number;
}): boolean {
  if (args.status >= 500) return true;
  if (args.durationMs >= (args.slowMs ?? DEFAULT_SLOW_MS)) return true;
  const rate = rateFor(args.method, args.status);
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return roll(args.traceId) < rate;
}
