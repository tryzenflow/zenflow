import type { Algorithm, AlgorithmConfig, LimitRule } from "@limitkit/core";
import type { Request } from "express";
import { RedisSlidingWindow } from "@limitkit/redis";
import { InMemorySlidingWindow } from "@limitkit/memory";
import {
  otpRequestRateLimitRules,
  otpVerifyRateLimitRules,
} from "./rate-limit.rules";
import {
  resetRateLimitRuntimeConfig,
  setRateLimitRuntimeConfig,
} from "./rate-limit.constants";

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: "203.0.113.7",
    body: {},
    ...overrides,
  } as Request;
}

/** `LimitRule.policy`/`.key` may be a static value or a resolver function. */
async function resolvePolicy(
  rule: LimitRule<Request>,
  req: Request,
): Promise<Algorithm<AlgorithmConfig>> {
  return typeof rule.policy === "function" ? rule.policy(req) : rule.policy;
}

function resolveKey(rule: LimitRule<Request>, req: Request) {
  return typeof rule.key === "function" ? rule.key(req) : rule.key;
}

describe("otpRequestRateLimitRules / otpVerifyRateLimitRules", () => {
  afterEach(() => resetRateLimitRuntimeConfig());

  it("throws if a rule's policy is resolved before RateLimitModule initializes", async () => {
    const [ipRule] = otpRequestRateLimitRules;
    await expect(resolvePolicy(ipRule, fakeRequest())).rejects.toThrow(
      /before RateLimitModule finished initializing/,
    );
  });

  describe("once the runtime config is set", () => {
    beforeEach(() => {
      setRateLimitRuntimeConfig({
        storeKind: "memory",
        otpRequestIp: { window: 60, limit: 5 },
        otpRequestEmail: { window: 900, limit: 3 },
        otpVerifyIp: { window: 60, limit: 20 },
        otpVerifyEmail: { window: 600, limit: 10 },
      });
    });

    it("keys the per-IP rule off req.ip, namespaced by route", () => {
      const [ipRule] = otpRequestRateLimitRules;
      const key = resolveKey(ipRule, fakeRequest({ ip: "198.51.100.9" }));
      expect(key).toBe("otp-request:ip:198.51.100.9");
    });

    it("keys the per-email rule off the lower-cased request body email, namespaced by route", () => {
      const [, emailRule] = otpRequestRateLimitRules;
      const key = resolveKey(
        emailRule,
        fakeRequest({ body: { email: "Foo@Bar.com" } }),
      );
      expect(key).toBe("otp-request:email:foo@bar.com");
    });

    it("falls back to a stable key when the body has no email (still consumes quota)", () => {
      const [, emailRule] = otpRequestRateLimitRules;
      const key = resolveKey(emailRule, fakeRequest({ body: {} }));
      expect(key).toBe("otp-request:email:unknown");
    });

    it("namespaces otp-request and otp-verify keys differently so they never share a counter", () => {
      const [requestIpRule] = otpRequestRateLimitRules;
      const [verifyIpRule] = otpVerifyRateLimitRules;
      const req = fakeRequest({ ip: "198.51.100.9" });
      expect(resolveKey(requestIpRule, req)).not.toBe(
        resolveKey(verifyIpRule, req),
      );
    });

    it("resolves memory-store algorithms when storeKind is memory", async () => {
      const [ipRule, emailRule] = otpRequestRateLimitRules;
      const ipPolicy = await resolvePolicy(ipRule, fakeRequest());
      const emailPolicy = await resolvePolicy(emailRule, fakeRequest());
      expect(ipPolicy).toBeInstanceOf(InMemorySlidingWindow);
      expect(emailPolicy).toBeInstanceOf(InMemorySlidingWindow);
    });

    it("uses the configured otpRequestIp window/limit", async () => {
      const [ipRule] = otpRequestRateLimitRules;
      const policy = await resolvePolicy(ipRule, fakeRequest());
      expect(policy.config).toMatchObject({ window: 60, limit: 5 });
    });

    it("uses the configured otpVerifyEmail window/limit for the verify rules", async () => {
      const [, emailRule] = otpVerifyRateLimitRules;
      const policy = await resolvePolicy(emailRule, fakeRequest());
      expect(policy.config).toMatchObject({ window: 600, limit: 10 });
    });
  });

  it("resolves Redis-store algorithms when storeKind is redis", async () => {
    setRateLimitRuntimeConfig({
      storeKind: "redis",
      otpRequestIp: { window: 60, limit: 5 },
      otpRequestEmail: { window: 900, limit: 3 },
      otpVerifyIp: { window: 60, limit: 20 },
      otpVerifyEmail: { window: 600, limit: 10 },
    });
    const [ipRule] = otpRequestRateLimitRules;
    const policy = await resolvePolicy(ipRule, fakeRequest());
    expect(policy).toBeInstanceOf(RedisSlidingWindow);
  });
});
