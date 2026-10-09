import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { KILLSWITCH_REDIS_CLIENT } from "../redis/redis.constants";
import {
  KILLSWITCH_FLAGS,
  KILLSWITCH_FLAG_NAMES,
  type KillSwitchFlag,
} from "./killswitch.flags";
import { KillSwitchService } from "./killswitch.service";

function fakeRedis() {
  return {
    status: "ready",
    defineCommand: jest.fn(),
    ksReadAll: jest.fn(),
    ksSet: jest.fn().mockResolvedValue("1-0"),
    xrevrange: jest.fn(),
    disconnect: jest.fn(),
  };
}

async function build(redis: ReturnType<typeof fakeRedis> | null, ttl = 5000) {
  const module = await Test.createTestingModule({
    providers: [
      KillSwitchService,
      { provide: KILLSWITCH_REDIS_CLIENT, useValue: redis },
      {
        provide: ConfigService,
        useValue: {
          get: (k: string) =>
            k === "KILLSWITCH_CACHE_TTL_MS" ? ttl : undefined,
        },
      },
    ],
  }).compile();
  return module.get(KillSwitchService);
}

describe("KillSwitchService", () => {
  it("reads every flag in one Redis round trip and caches it", async () => {
    const redis = fakeRedis();
    redis.ksReadAll.mockResolvedValue(["1", "0", null, null, null]);
    const ks = await build(redis);

    expect(await ks.isEnabled("ingestion")).toBe(true);
    expect(await ks.isEnabled("notifications")).toBe(false);
    expect(redis.ksReadAll).toHaveBeenCalledTimes(1);
  });

  it("re-reads after the TTL", async () => {
    const redis = fakeRedis();
    redis.ksReadAll.mockResolvedValue(["1", "1", "1", "1", "0"]);
    const ks = await build(redis, 0);
    await ks.isEnabled("signups");
    await ks.isEnabled("signups");
    expect(redis.ksReadAll).toHaveBeenCalledTimes(2);
  });

  it("set writes flag + audit in one call and drops the cache", async () => {
    const redis = fakeRedis();
    redis.ksReadAll.mockResolvedValue([null, null, null, null, null]);
    const ks = await build(redis);
    await ks.isEnabled("signups");

    await ks.set("signups", false, "alice", "abuse wave");
    expect(redis.ksSet).toHaveBeenCalledTimes(1);
    expect(redis.ksSet.mock.calls[0]).toEqual(
      expect.arrayContaining([
        "killswitch:signups",
        "0",
        "signups",
        "alice",
        "abuse wave",
      ]),
    );
    await ks.isEnabled("signups");
    expect(redis.ksReadAll).toHaveBeenCalledTimes(2);
  });

  it("set throws when Redis fails, so an operator sees it did not apply", async () => {
    const redis = fakeRedis();
    redis.ksSet.mockRejectedValue(new Error("down"));
    const ks = await build(redis);
    await expect(ks.set("bandit", false, "a", "r")).rejects.toThrow("down");
  });

  describe.each(KILLSWITCH_FLAG_NAMES)(
    "%s fail-safe default",
    (flag: KillSwitchFlag) => {
      it("applies when the instance is down", async () => {
        const redis = fakeRedis();
        redis.ksReadAll.mockRejectedValue(new Error("ECONNREFUSED"));
        const ks = await build(redis);
        expect(await ks.isEnabled(flag)).toBe(KILLSWITCH_FLAGS[flag].failSafe);
      });

      it("is not used when the URL is unset or the key was never set", async () => {
        expect(await (await build(null)).isEnabled(flag)).toBe(
          KILLSWITCH_FLAGS[flag].normal,
        );
        const redis = fakeRedis();
        redis.ksReadAll.mockResolvedValue([null, null, null, null, null]);
        expect(await (await build(redis)).isEnabled(flag)).toBe(
          KILLSWITCH_FLAGS[flag].normal,
        );
      });
    },
  );

  it("an outage costs one failed call per TTL, not one per check", async () => {
    const redis = fakeRedis();
    redis.ksReadAll.mockRejectedValue(new Error("down"));
    const ks = await build(redis);
    await ks.isEnabled("ingestion");
    await ks.isEnabled("bandit");
    expect(redis.ksReadAll).toHaveBeenCalledTimes(1);
  });

  describe("readStrict", () => {
    it("returns stored values and the normal state for never-set flags", async () => {
      const redis = fakeRedis();
      redis.ksReadAll.mockResolvedValue(["0", null, null, "0", null]);
      const flags = await (await build(redis)).readStrict();
      expect(flags).toEqual({
        ingestion: false,
        notifications: true,
        bandit: true,
        signups: false,
        maintenance: false,
      });
    });

    it("rejects instead of falling back when Redis cannot be read", async () => {
      const redis = fakeRedis();
      redis.ksReadAll.mockRejectedValue(new Error("timeout"));
      await expect((await build(redis)).readStrict()).rejects.toThrow(
        "timeout",
      );
    });

    it("rejects when REDIS_KILLSWITCH_URL is unset", async () => {
      await expect((await build(null)).readStrict()).rejects.toThrow(
        "REDIS_KILLSWITCH_URL",
      );
    });
  });
});
