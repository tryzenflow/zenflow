import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { LimitModule } from "@limitkit/nest";
import { CircuitBreaker } from "../common/circuit-breaker";
import { InMemoryStore, fixedWindow } from "@limitkit/memory";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import {
  resetRateLimitRuntimeConfig,
  setRateLimitRuntimeConfig,
  ResilientStore,
  TooManyRequestsFilter,
} from "../common/rate-limit";

/**
 * Real Nest app: LimitKit's global guard (APP_GUARD from `LimitModule`), the
 * real `CookieAuthGuard` and `@RateLimit` on the real controller. Only
 * `passport.session()` is stubbed (header -> `req.user`), which is exactly the
 * Express-middleware position the real one has in `main.ts`.
 */
describe("POST /integrations/:provider/sync rate limit (global LimitKit guard)", () => {
  let app: INestApplication;
  let sync: jest.Mock;

  beforeEach(async () => {
    setRateLimitRuntimeConfig({
      storeKind: "memory",
      otpRequestIp: { window: 60, limit: 5 },
      otpRequestIpHourly: { window: 3600, limit: 20 },
      otpRequestEmail: { window: 900, limit: 3 },
      otpVerifyIp: { window: 60, limit: 20 },
      otpVerifyEmail: { window: 600, limit: 10 },
      syncManual: { window: 21600, limit: 3 },
    });
    sync = jest.fn().mockResolvedValue({ provider: "LMS" });
    const moduleRef = await Test.createTestingModule({
      imports: [
        LimitModule.forRoot({
          store: new InMemoryStore(),
          rules: [
            {
              name: "global-noop",
              key: "global",
              policy: fixedWindow({ window: 1, limit: 1_000_000 }),
            },
          ],
        }),
      ],
      controllers: [IntegrationsController],
      providers: [
        { provide: IntegrationsService, useValue: { sync } },
        { provide: APP_FILTER, useClass: TooManyRequestsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const id = req.header("x-test-user");
      if (id) {
        (req as unknown as { user: unknown }).user = { id };
      }
      req.isAuthenticated = (() => !!id) as Request["isAuthenticated"];
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    resetRateLimitRuntimeConfig();
  });

  const post = (path: string, user?: string) => {
    const r = request(app.getHttpServer() as App).post(path);
    return user ? r.set("x-test-user", user) : r;
  };

  it("allows 3 per user + provider, then 429s with Retry-After and the app envelope", async () => {
    for (let i = 0; i < 3; i++) {
      await post("/integrations/LMS/sync", "u1").expect(201);
    }
    const res = await post("/integrations/LMS/sync", "u1").expect(429);
    expect(res.body).toEqual({
      success: false,
      message: "Too many requests. Please wait a moment and try again.",
    });
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(21600);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("keys on req.user.id and req.params.provider (other user / provider unaffected)", async () => {
    for (let i = 0; i < 3; i++) {
      await post("/integrations/LMS/sync", "u1").expect(201);
    }
    await post("/integrations/LMS/sync", "u1").expect(429);
    await post("/integrations/PORTAL/sync", "u1").expect(201);
    await post("/integrations/LMS/sync", "u2").expect(201);
  });

  it("anonymous requests get an IP bucket and a 401, never a user's bucket", async () => {
    await post("/integrations/LMS/sync").expect(401);
    for (let i = 0; i < 3; i++) {
      await post("/integrations/LMS/sync", "u1").expect(201);
    }
    await post("/integrations/LMS/sync", "u1").expect(429);
    await post("/integrations/LMS/sync").expect(401);
  });
});

describe("global LimitKit guard with a failing store", () => {
  it("still serves requests (fail-open) when the inner store throws", async () => {
    const failing = {
      consume: jest.fn().mockRejectedValue(new Error("redis down")),
    };
    const sync = jest.fn().mockResolvedValue({ provider: "LMS" });
    const moduleRef = await Test.createTestingModule({
      imports: [
        LimitModule.forRoot({
          store: new ResilientStore(failing, new CircuitBreaker(Date.now), {
            timeoutMs: 50,
            logger: { warn: jest.fn() },
          }),
          rules: [
            {
              name: "global-noop",
              key: "global",
              policy: fixedWindow({ window: 1, limit: 1_000_000 }),
            },
          ],
        }),
      ],
      controllers: [IntegrationsController],
      providers: [{ provide: IntegrationsService, useValue: { sync } }],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: unknown }).user = { id: "u1" };
      req.isAuthenticated = (() => true) as Request["isAuthenticated"];
      next();
    });
    await app.init();
    setRateLimitRuntimeConfig({
      storeKind: "memory",
      otpRequestIp: { window: 60, limit: 5 },
      otpRequestIpHourly: { window: 3600, limit: 20 },
      otpRequestEmail: { window: 900, limit: 3 },
      otpVerifyIp: { window: 60, limit: 20 },
      otpVerifyEmail: { window: 600, limit: 10 },
      syncManual: { window: 21600, limit: 3 },
    });
    try {
      for (let i = 0; i < 6; i++) {
        await request(app.getHttpServer() as App)
          .post("/integrations/LMS/sync")
          .expect(201);
      }
      expect(sync).toHaveBeenCalledTimes(6);
    } finally {
      await app.close();
      resetRateLimitRuntimeConfig();
    }
  });
});
