import type { Session } from "@zenflow/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAY_CACHE_TTL_MS,
  clearDaySessionCache,
  fetchDaySessions,
  getCachedDaySessions,
  isDayCacheFresh,
  setCachedDaySessions,
} from "../session-cache";

const sessions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}` }) as Session);

beforeEach(() => {
  clearDaySessionCache();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("day cache", () => {
  it("round-trips sessions by day key", () => {
    setCachedDaySessions("2026-09-01", sessions(2));
    expect(getCachedDaySessions("2026-09-01")).toHaveLength(2);
    expect(getCachedDaySessions("2026-09-02")).toBeUndefined();
  });

  it("is fresh right after a write, stale past the TTL", () => {
    setCachedDaySessions("2026-09-01", sessions(1));
    expect(isDayCacheFresh("2026-09-01")).toBe(true);
    vi.setSystemTime(DAY_CACHE_TTL_MS + 1);
    expect(isDayCacheFresh("2026-09-01")).toBe(false);
  });

  it("reports an unknown day as not fresh", () => {
    expect(isDayCacheFresh("2026-01-01")).toBe(false);
  });
});

describe("fetchDaySessions", () => {
  it("de-dupes concurrent calls for the same day", async () => {
    const loader = vi.fn(() => Promise.resolve(sessions(3)));
    const a = fetchDaySessions("2026-09-01", loader);
    const b = fetchDaySessions("2026-09-01", loader);
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(getCachedDaySessions("2026-09-01")).toHaveLength(3);
  });

  it("fetches again once the previous request has settled", async () => {
    const loader = vi.fn(() => Promise.resolve(sessions(1)));
    await fetchDaySessions("2026-09-01", loader);
    await fetchDaySessions("2026-09-01", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not cache or wedge on a rejected fetch", async () => {
    const loader = vi.fn(() => Promise.reject(new Error("offline")));
    await expect(fetchDaySessions("2026-09-01", loader)).rejects.toThrow(
      "offline",
    );
    expect(getCachedDaySessions("2026-09-01")).toBeUndefined();
    // in-flight entry cleared → a retry actually runs
    const ok = vi.fn(() => Promise.resolve(sessions(1)));
    await fetchDaySessions("2026-09-01", ok);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
