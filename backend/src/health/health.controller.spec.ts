import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Redis } from "ioredis";
import type { PrismaService } from "../prisma/prisma.service";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

const mockVerify = jest.fn();
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({ verify: mockVerify, close: jest.fn() })),
}));
const mockS3Send = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  HeadBucketCommand: jest.fn((input: unknown) => ({ input })),
}));

function build(over: { pg?: boolean; redis?: boolean; rl?: boolean } = {}) {
  const prisma = {
    $queryRaw: jest.fn(() =>
      over.pg === false
        ? Promise.reject(new Error("pg down"))
        : Promise.resolve([1]),
    ),
  } as unknown as PrismaService;
  const ping = (ok: boolean) =>
    ({
      ping: jest.fn(() =>
        ok ? Promise.resolve("PONG") : Promise.reject(new Error("redis down")),
      ),
    }) as unknown as Redis;
  const config = { get: jest.fn() } as unknown as ConfigService;
  const service = new HealthService(
    prisma,
    ping(over.redis !== false),
    ping(over.rl !== false),
    config,
  );
  return new HealthController(service);
}

describe("HealthController", () => {
  it("live never touches dependencies", () => {
    expect(build({ pg: false }).live()).toMatchObject({
      success: true,
      data: { status: "ok" },
    });
  });

  it("ready is ok with postgres and redis up", async () => {
    const res = await build().ready();
    expect(res.success).toBe(true);
    expect(res.data.status).toBe("ok");
    expect(Object.keys(res.data.checks)).toEqual(["postgres", "redis"]);
  });

  it("ready is 503 with the wrapper when postgres is down", async () => {
    const err = await build({ pg: false })
      .ready()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
      success: false,
      data: { status: "error" },
    });
  });

  it("ready ignores the rate-limit redis; /health does not", async () => {
    const c = build({ rl: false });
    await expect(c.ready()).resolves.toMatchObject({ success: true });
    await expect(c.all()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  describe("optional dependencies", () => {
    function withConfig(values: Record<string, string>, killswitch?: Redis) {
      const config = {
        get: jest.fn(
          (key: string, fallback?: string) => values[key] ?? fallback,
        ),
        getOrThrow: jest.fn((key: string) => values[key]),
      } as unknown as ConfigService;
      const prisma = {
        $queryRaw: jest.fn().mockResolvedValue([1]),
      } as unknown as PrismaService;
      const ok = {
        ping: jest.fn().mockResolvedValue("PONG"),
      } as unknown as Redis;
      return new HealthController(
        new HealthService(prisma, ok, ok, config, undefined, killswitch),
      );
    }
    const storage = {
      S3_ENDPOINT: "http://s3",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    };

    it("adds storage, mail and the kill-switch redis when configured", async () => {
      mockS3Send.mockResolvedValue({});
      mockVerify.mockResolvedValue(true);
      const ks = {
        ping: jest.fn().mockResolvedValue("PONG"),
      } as unknown as Redis;
      const res = await withConfig({ ...storage, MAIL_HOST: "smtp" }, ks).all();
      expect(Object.keys(res.data.checks)).toEqual([
        "postgres",
        "redis",
        "redisRateLimit",
        "redisKillswitch",
        "storage",
        "mail",
      ]);
    });

    it("is 503 when the bucket or the mail relay is unreachable", async () => {
      mockS3Send.mockRejectedValue(new Error("NoSuchBucket"));
      mockVerify.mockRejectedValue(new Error("ECONNREFUSED"));
      const err = await withConfig({ ...storage, MAIL_HOST: "smtp" })
        .all()
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
        data: {
          checks: {
            storage: { status: "down", error: "NoSuchBucket" },
            mail: { status: "down", error: "ECONNREFUSED" },
          },
        },
      });
    });

    it("leaves them out when not configured", async () => {
      const res = await withConfig({}).all();
      expect(Object.keys(res.data.checks)).toEqual([
        "postgres",
        "redis",
        "redisRateLimit",
      ]);
    });
  });
});
