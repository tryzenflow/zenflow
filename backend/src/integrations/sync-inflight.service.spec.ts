import { ConflictException } from "@nestjs/common";
import type { Redis } from "ioredis";
import { SyncInflightGuard, syncInflightKey } from "./sync-inflight.service";

function fakeRedis() {
  const strings = new Map<string, string>();
  const redis = {
    set: jest.fn(
      (key: string, value: string, _ex: string, _ttl: number, nx: string) => {
        if (nx === "NX" && strings.has(key)) return Promise.resolve(null);
        strings.set(key, value);
        return Promise.resolve("OK");
      },
    ),
    del: jest.fn((key: string) => {
      strings.delete(key);
      return Promise.resolve(1);
    }),
  };
  return { redis, strings };
}

describe("SyncInflightGuard", () => {
  it("holds the lock with a TTL while running and releases it after", async () => {
    const { redis, strings } = fakeRedis();
    const guard = new SyncInflightGuard(redis as unknown as Redis);
    await guard.run("u1", "LMS", () => {
      expect(strings.has(syncInflightKey("u1", "LMS"))).toBe(true);
      return Promise.resolve();
    });
    expect(redis.set).toHaveBeenCalledWith(
      "sync:inflight:u1:LMS",
      "1",
      "EX",
      120,
      "NX",
    );
    expect(strings.size).toBe(0);
  });

  it("409s a concurrent duplicate without running it or releasing the holder's lock", async () => {
    const { redis, strings } = fakeRedis();
    const guard = new SyncInflightGuard(redis as unknown as Redis);
    let release!: () => void;
    const first = guard.run(
      "u1",
      "LMS",
      () => new Promise<void>((r) => (release = r)),
    );
    const fn = jest.fn();
    await expect(guard.run("u1", "LMS", fn)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fn).not.toHaveBeenCalled();
    expect(strings.size).toBe(1);
    release();
    await first;
    expect(strings.size).toBe(0);
  });

  it("locks per provider and per user independently", async () => {
    const { redis } = fakeRedis();
    const guard = new SyncInflightGuard(redis as unknown as Redis);
    let release!: () => void;
    const first = guard.run(
      "u1",
      "LMS",
      () => new Promise<void>((r) => (release = r)),
    );
    await expect(
      guard.run("u1", "PORTAL", () => Promise.resolve("ok")),
    ).resolves.toBe("ok");
    await expect(
      guard.run("u2", "LMS", () => Promise.resolve("ok")),
    ).resolves.toBe("ok");
    release();
    await first;
  });

  it("releases the lock when the run throws", async () => {
    const { redis, strings } = fakeRedis();
    const guard = new SyncInflightGuard(redis as unknown as Redis);
    await expect(
      guard.run("u1", "LMS", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(strings.size).toBe(0);
  });

  it("fails open when Redis is unreachable", async () => {
    const redis = { set: jest.fn().mockRejectedValue(new Error("down")) };
    const guard = new SyncInflightGuard(redis as unknown as Redis);
    await expect(
      guard.run("u1", "LMS", () => Promise.resolve(1)),
    ).resolves.toBe(1);
  });
});
