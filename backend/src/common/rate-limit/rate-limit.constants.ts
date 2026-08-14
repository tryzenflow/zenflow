/** Window/limit pair for one sliding-window rule. */
export interface RateLimitWindow {
  /** Window size, in seconds. */
  window: number;
  /** Max requests allowed within the window. */
  limit: number;
}

export type RateLimitStoreKind = "redis" | "memory";

export interface RateLimitRuntimeConfig {
  storeKind: RateLimitStoreKind;
  otpRequestIp: RateLimitWindow;
  otpRequestEmail: RateLimitWindow;
  otpVerifyIp: RateLimitWindow;
  otpVerifyEmail: RateLimitWindow;
}

/**
 * `RateLimitModule` populates this once at boot (it has access to
 * `ConfigService` inside its `LimitModule.forRootAsync` factory). The
 * `@RateLimit()` decorators on `AuthController` are evaluated at
 * module-import time — long before Nest finishes bootstrapping and reads
 * `.env.*` — so their policy resolvers read this singleton lazily, per
 * request, instead of capturing static values at decoration time.
 */
let runtimeConfig: RateLimitRuntimeConfig | null = null;

export function setRateLimitRuntimeConfig(config: RateLimitRuntimeConfig) {
  runtimeConfig = config;
}

export function getRateLimitRuntimeConfig(): RateLimitRuntimeConfig {
  if (!runtimeConfig) {
    throw new Error(
      "Rate limit runtime config was read before RateLimitModule finished initializing",
    );
  }
  return runtimeConfig;
}

/** Test-only: reset the singleton between test cases. */
export function resetRateLimitRuntimeConfig() {
  runtimeConfig = null;
}
