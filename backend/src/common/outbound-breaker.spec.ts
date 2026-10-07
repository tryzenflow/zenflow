import { ConfigService } from "@nestjs/config";
import {
  classifyHttpResult,
  OutboundBreakers,
  parseRetryAfterMs,
  UpstreamUnavailableError,
} from "./outbound-breaker";

function make(env: Record<string, number> = {}) {
  const clock = { t: 1_000_000 };
  const breakers = new OutboundBreakers(
    { get: (k: string) => env[k] } as unknown as ConfigService,
    () => clock.t,
  );
  return { breakers, clock };
}

const boom = () => Promise.reject(new Error("boom"));

describe("OutboundBreakers", () => {
  it("keeps one independent breaker per name", async () => {
    const { breakers } = make({ INGESTION_BREAKER_FAILURES: 2 });
    for (let i = 0; i < 2; i++) {
      await breakers.run("a", boom).catch(() => undefined);
    }
    await expect(breakers.run("a", () => Promise.resolve(1))).rejects.toThrow(
      UpstreamUnavailableError,
    );
    await expect(breakers.run("b", () => Promise.resolve(1))).resolves.toBe(1);
  });

  it("does not run fn while open and reports a retry delay", async () => {
    const { breakers } = make({ INGESTION_BREAKER_FAILURES: 1 });
    await breakers.run("a", boom).catch(() => undefined);
    const fn = jest.fn();

    const err = await breakers.run("a", fn).catch((e: unknown) => e);

    expect(fn).not.toHaveBeenCalled();
    expect(err).toMatchObject({ upstream: "a", retryAfterMs: 60_000 });
  });

  it("lets the caller classify: neutral never counts", async () => {
    const { breakers } = make({ INGESTION_BREAKER_FAILURES: 1 });
    for (let i = 0; i < 5; i++) {
      await breakers
        .run("a", boom, { classify: () => "neutral" })
        .catch(() => undefined);
    }
    expect(breakers.unavailableFor("a")).toBeNull();
  });

  it("applies the configured defaults and caps doubling at the max", async () => {
    const { breakers, clock } = make({
      INGESTION_BREAKER_FAILURES: 1,
      INGESTION_BREAKER_OPEN_MS: 1000,
      INGESTION_BREAKER_MAX_OPEN_MS: 2500,
    });
    await breakers.run("a", boom).catch(() => undefined);
    clock.t += 1000;
    await breakers.run("a", boom).catch(() => undefined); // -> 2000
    clock.t += 2000;
    await breakers.run("a", boom).catch(() => undefined); // -> capped 2500
    expect(breakers.unavailableFor("a")).toBe(2500);
  });
});

describe("classifyHttpResult / parseRetryAfterMs", () => {
  const res = (status: number, retry?: string) =>
    ({
      ok: true,
      value: {
        status,
        headers: { get: () => retry ?? null },
      } as unknown as Response,
    }) as const;

  it("counts rejections, 5xx and 429; ignores other 4xx", () => {
    expect(classifyHttpResult({ ok: false, error: new Error("x") })).toBe(
      "failure",
    );
    expect(classifyHttpResult(res(500))).toBe("failure");
    expect(classifyHttpResult(res(404))).toBe("neutral");
    expect(classifyHttpResult(res(401))).toBe("neutral");
    expect(classifyHttpResult(res(200))).toBe("success");
    expect(classifyHttpResult(res(302))).toBe("success");
    expect(classifyHttpResult(res(429, "30"))).toEqual({
      verdict: "failure",
      retryAfterMs: 30_000,
    });
  });

  it("parses seconds and HTTP dates, and ignores junk", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
    expect(
      parseRetryAfterMs(
        "Wed, 21 Oct 2026 07:28:10 GMT",
        Date.UTC(2026, 9, 21, 7, 28, 0),
      ),
    ).toBe(10_000);
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});
