import type { Algorithm, LimitRule, SlidingWindowConfig } from "@limitkit/core";
import { slidingWindow as redisSlidingWindow } from "@limitkit/redis";
import { slidingWindow as memorySlidingWindow } from "@limitkit/memory";
import type { Request } from "express";
import {
  getRateLimitRuntimeConfig,
  type RateLimitStoreKind,
  type RateLimitWindow,
} from "./rate-limit.constants";

/**
 * `@limitkit/redis`'s and `@limitkit/memory`'s sliding-window algorithm
 * objects are store-specific (`RedisSlidingWindow` implements the Lua-script
 * surface the Redis store needs; `InMemorySlidingWindow` implements the
 * `process()` surface the memory store needs) — a rule's policy must be
 * built from whichever package matches the active store.
 */
function slidingWindowFor(
  storeKind: RateLimitStoreKind,
  opts: RateLimitWindow,
): Algorithm<SlidingWindowConfig> {
  return storeKind === "redis"
    ? redisSlidingWindow(opts)
    : memorySlidingWindow(opts);
}

/**
 * LimitKit's storage key is derived from `{algorithm name, algorithm config}`
 * hash + this key string alone — NOT the rule `name` (that's only used for
 * merge resolution). Two rules with the same policy shape (e.g. otp-request's
 * and otp-verify's per-IP sliding windows, which can easily end up with
 * identical window/limit) and the same raw key would silently share one
 * counter. Every key here is namespaced by rule so `/auth/otp/request` and
 * `/auth/otp/verify` never bleed quota into each other.
 */
function ipKey(namespace: string) {
  return (req: Request) => `${namespace}:ip:${req.ip}`;
}

/** Lower-cased so `Foo@Bar.com` and `foo@bar.com` share one bucket. */
function emailKey(namespace: string) {
  return (req: Request) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    const normalized =
      typeof email === "string" ? email.toLowerCase() : "unknown";
    return `${namespace}:email:${normalized}`;
  };
}

/**
 * `POST /auth/otp/request` — a per-IP sliding window (the documented LimitKit
 * login example) plus a tighter per-email window, so an attacker spraying
 * requests for one victim's inbox from many IPs is still capped.
 */
export const otpRequestRateLimitRules: LimitRule<Request>[] = [
  {
    name: "otp-request-ip",
    key: ipKey("otp-request"),
    policy: () =>
      slidingWindowFor(
        getRateLimitRuntimeConfig().storeKind,
        getRateLimitRuntimeConfig().otpRequestIp,
      ),
  },
  {
    name: "otp-request-email",
    key: emailKey("otp-request"),
    policy: () =>
      slidingWindowFor(
        getRateLimitRuntimeConfig().storeKind,
        getRateLimitRuntimeConfig().otpRequestEmail,
      ),
  },
];

/**
 * `POST /auth/otp/verify` — a looser per-IP + per-email cap to blunt 6-digit
 * code brute-forcing without blocking a legitimate user retyping a typo'd
 * code a few times.
 */
export const otpVerifyRateLimitRules: LimitRule<Request>[] = [
  {
    name: "otp-verify-ip",
    key: ipKey("otp-verify"),
    policy: () =>
      slidingWindowFor(
        getRateLimitRuntimeConfig().storeKind,
        getRateLimitRuntimeConfig().otpVerifyIp,
      ),
  },
  {
    name: "otp-verify-email",
    key: emailKey("otp-verify"),
    policy: () =>
      slidingWindowFor(
        getRateLimitRuntimeConfig().storeKind,
        getRateLimitRuntimeConfig().otpVerifyEmail,
      ),
  },
];
