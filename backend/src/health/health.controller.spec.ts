import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Redis } from "ioredis";
import type { PrismaService } from "../prisma/prisma.service";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

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
    expect(build({ pg: false }).live()).toEqual({ status: "ok" });
  });

  it("ready is ok with postgres and redis up", async () => {
    const res = await build().ready();
    expect(res.status).toBe("ok");
    expect(Object.keys(res.checks)).toEqual(["postgres", "redis"]);
  });

  it("ready is 503 when postgres is down", async () => {
    await expect(build({ pg: false }).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("ready ignores the rate-limit redis; /health does not", async () => {
    const c = build({ rl: false });
    await expect(c.ready()).resolves.toMatchObject({ status: "ok" });
    await expect(c.all()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
