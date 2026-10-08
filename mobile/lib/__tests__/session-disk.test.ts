import type { Session } from "@zenflow/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DISK_VERSION,
  type KV,
  MAX_DISK_AGE_MS,
  MAX_DISK_ENTRIES,
  createSessionDisk,
} from "../session-disk";
import {
  attachSessionDisk,
  clearDaySessionCache,
  getCachedDaySessions,
  getCachedSavedAt,
  hydrateSessionCache,
  isDayCacheFresh,
  setCachedDaySessions,
} from "../session-cache";

function memoryKv(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getString: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    getAllKeys: () => [...map.keys()],
  };
}

const sessions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}` }) as Session);

describe("session disk", () => {
  let kv: ReturnType<typeof memoryKv>;
  let now = 1_000_000;
  beforeEach(() => {
    kv = memoryKv();
    now = 1_000_000;
  });
  const make = () => createSessionDisk(kv, () => now);

  it("round-trips entries per user and ignores saves before a user is set", () => {
    const disk = make();
    disk.save("2026-10-08", sessions(1), now);
    expect(kv.map.size).toBe(0);

    disk.load("u1");
    disk.save("2026-10-08", sessions(2), now);
    const again = make().load("u1");
    expect(again.get("2026-10-08")?.sessions).toHaveLength(2);
    expect(again.get("2026-10-08")?.savedAt).toBe(now);
  });

  it("wipes another user's data when switching accounts", () => {
    const disk = make();
    disk.load("u1");
    disk.save("2026-10-08", sessions(1), now);
    expect(make().load("u2").size).toBe(0);
    expect(kv.map.size).toBe(0);
  });

  it("drops old schema versions, corrupt rows and expired rows", () => {
    kv.map.set(`zf.sessions.v${DISK_VERSION - 1}.u1.2026-10-01`, "{}");
    kv.map.set(`zf.sessions.v${DISK_VERSION}.u1.bad`, "not json");
    kv.map.set(
      `zf.sessions.v${DISK_VERSION}.u1.old`,
      JSON.stringify({ sessions: [], savedAt: now - MAX_DISK_AGE_MS - 1 }),
    );
    kv.map.set(
      `zf.sessions.v${DISK_VERSION}.u1.ok`,
      JSON.stringify({ sessions: [], savedAt: now }),
    );
    const loaded = make().load("u1");
    expect([...loaded.keys()]).toEqual(["ok"]);
    expect(kv.map.size).toBe(1);
  });

  it("prunes the oldest entries past the cap", () => {
    const disk = make();
    disk.load("u1");
    for (let i = 0; i < MAX_DISK_ENTRIES + 5; i++) {
      disk.save(`d${i}`, [], now + i);
    }
    const loaded = make().load("u1");
    expect(loaded.size).toBe(MAX_DISK_ENTRIES);
    expect(loaded.has("d0")).toBe(false);
    expect(loaded.has(`d${MAX_DISK_ENTRIES + 4}`)).toBe(true);
  });

  it("clear() removes only the current user's entries", () => {
    const disk = make();
    disk.load("u1");
    disk.save("a", [], now);
    disk.clear();
    expect(kv.map.size).toBe(0);
  });

  it("a signed-out load wipes everything", () => {
    const disk = make();
    disk.load("u1");
    disk.save("a", [], now);
    disk.load(null);
    expect(kv.map.size).toBe(0);
  });
});

describe("session cache + disk", () => {
  it("writes through, hydrates as stale, and wipes on clear", () => {
    const kv = memoryKv();
    const disk = createSessionDisk(kv);
    attachSessionDisk(disk);
    clearDaySessionCache();
    hydrateSessionCache("u1");

    setCachedDaySessions("2026-10-08", sessions(2));
    const savedAt = getCachedSavedAt("2026-10-08");
    expect(savedAt).toBeTypeOf("number");

    // Simulate an app restart: memory gone, disk stays.
    attachSessionDisk(null);
    clearDaySessionCache();
    attachSessionDisk(createSessionDisk(kv));
    hydrateSessionCache("u1");

    expect(getCachedDaySessions("2026-10-08")).toHaveLength(2);
    expect(isDayCacheFresh("2026-10-08")).toBe(false); // revalidates
    expect(getCachedSavedAt("2026-10-08")).toBe(savedAt);

    clearDaySessionCache();
    expect(kv.map.size).toBe(0);
    attachSessionDisk(null);
  });
});
