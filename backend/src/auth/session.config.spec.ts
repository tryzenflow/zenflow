import type { Store } from "express-session";
import { buildSessionOptions } from "./session.config";

describe("buildSessionOptions", () => {
  const store = {} as Store;
  const ttlMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  const build = (
    overrides: Partial<Parameters<typeof buildSessionOptions>[0]> = {},
  ) =>
    buildSessionOptions({
      secret: "s3cr3t",
      store,
      ttlMs,
      isProduction: false,
      ...overrides,
    });

  it("enables rolling sessions so active use refreshes the expiry", () => {
    expect(build().rolling).toBe(true);
  });

  it("syncs the cookie maxAge with the configured TTL (keeps Redis TTL in sync)", () => {
    expect(build().cookie?.maxAge).toBe(ttlMs);
  });

  it("uses a secure, httpOnly, lax cookie", () => {
    const { cookie } = build({ isProduction: true });
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.secure).toBe(true);
  });

  it("does not mark the cookie secure outside production", () => {
    expect(build({ isProduction: false }).cookie?.secure).toBe(false);
  });

  it("keeps resave and saveUninitialized disabled", () => {
    const options = build();
    expect(options.resave).toBe(false);
    expect(options.saveUninitialized).toBe(false);
  });

  it("passes through the provided secret and store", () => {
    const options = build();
    expect(options.secret).toBe("s3cr3t");
    expect(options.store).toBe(store);
  });
});
