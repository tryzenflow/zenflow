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
      secure: false,
      sameSite: "lax",
      ...overrides,
    });

  it("enables rolling sessions so active use refreshes the expiry", () => {
    expect(build().rolling).toBe(true);
  });

  it("syncs the cookie maxAge with the configured TTL (keeps Redis TTL in sync)", () => {
    expect(build().cookie?.maxAge).toBe(ttlMs);
  });

  it("always marks the cookie httpOnly", () => {
    expect(build().cookie?.httpOnly).toBe(true);
  });

  it("maps the secure flag onto the cookie", () => {
    expect(build({ secure: true }).cookie?.secure).toBe(true);
    expect(build({ secure: false }).cookie?.secure).toBe(false);
  });

  it("passes the sameSite attribute through to the cookie", () => {
    expect(build({ sameSite: "lax" }).cookie?.sameSite).toBe("lax");
    expect(build({ sameSite: "strict" }).cookie?.sameSite).toBe("strict");
    expect(build({ sameSite: "none", secure: true }).cookie?.sameSite).toBe(
      "none",
    );
  });

  it("supports the cross-site production combo (SameSite=None + Secure)", () => {
    const { cookie } = build({ sameSite: "none", secure: true });
    expect(cookie?.sameSite).toBe("none");
    expect(cookie?.secure).toBe(true);
  });

  it("throws when SameSite=None is paired with an insecure cookie", () => {
    expect(() => build({ sameSite: "none", secure: false })).toThrow(
      /COOKIE_SAMESITE.*none.*COOKIE_SECURE/i,
    );
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
