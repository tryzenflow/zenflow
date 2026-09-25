import type { ClsService } from "nestjs-cls";

/**
 * Per-request phase timings for the `Server-Timing` header (ADR-0003 section
 * 9). Stored in the request's CLS context; a no-op outside a request. The
 * header is only emitted when `BENCH_TIMING=1` (test env) by
 * {@link HttpMetricsInterceptor}.
 */
const KEY = "serverTiming";

export function recordPhase(
  cls: ClsService | undefined,
  name: string,
  ms: number,
): void {
  try {
    if (!cls?.isActive()) return;
    const cur = cls.get<Record<string, number>>(KEY) ?? {};
    cur[name] = (cur[name] ?? 0) + ms;
    cls.set(KEY, cur);
  } catch {
    /* timing is best-effort */
  }
}

export function serverTimingHeader(cls: ClsService): string | null {
  try {
    const cur = cls.isActive() ? cls.get<Record<string, number>>(KEY) : null;
    if (!cur) return null;
    return Object.entries(cur)
      .map(([k, v]) => `${k};dur=${v.toFixed(1)}`)
      .join(", ");
  } catch {
    return null;
  }
}
