import type { ConfigService } from "@nestjs/config";
import {
  PLACEMENT_CONTRACT_VERSION,
  type PlaceRequest,
  type PlaceResponse,
} from "@zenflow/shared";
import { PlacementClient } from "./placement-client.service";

const req = {
  contractVersion: 1,
  requestId: "r1",
  members: [{ id: "a" }],
} as unknown as PlaceRequest;

const okBody: PlaceResponse = {
  contractVersion: PLACEMENT_CONTRACT_VERSION,
  requestId: "r1",
  paramsVersion: "p",
  results: [{ id: "a" } as never],
  timingsMs: {
    decode: 0,
    context: 0,
    predict: 0,
    scan: 0,
    displace: 0,
    total: 0,
  },
};

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

function make(
  fetchImpl: jest.Mock,
  cfg: Record<string, unknown> = { BANDIT_SERVICE_URL: "http://py:8100/" },
) {
  let t = 0;
  const sleep = jest.fn().mockResolvedValue(undefined);
  const config = { get: (k: string) => cfg[k] } as unknown as ConfigService;
  const client = new PlacementClient(config, {
    fetch: fetchImpl as never,
    now: () => t,
    sleep,
    random: () => 0.5,
  });
  return { client, sleep, advance: (ms: number) => (t += ms) };
}

const timeoutErr = () => {
  const err = new Error("timed out");
  err.name = "TimeoutError";
  return err;
};

describe("PlacementClient", () => {
  it("reports `disabled` without a URL and never calls fetch", async () => {
    const f = jest.fn();
    const { client } = make(f, {});
    expect(client.enabled).toBe(false);
    expect(await client.place(req)).toEqual({ ok: false, reason: "disabled" });
    expect(f).not.toHaveBeenCalled();
  });

  it("POSTs to /v1/place with the bearer token and returns the body", async () => {
    const f = jest.fn().mockImplementation(() => json(200, okBody));
    const { client } = make(f, {
      BANDIT_SERVICE_URL: "http://py:8100/",
      BANDIT_SERVICE_TOKEN: "s3cret",
    });
    const res = await client.place(req);
    expect(res).toEqual({ ok: true, response: okBody });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://py:8100/v1/place");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer s3cret",
    );
  });

  it("omits the authorization header when no token is configured", async () => {
    const f = jest.fn().mockImplementation(() => json(200, okBody));
    const { client } = make(f);
    await client.place(req);
    const init = (f.mock.calls[0] as [string, RequestInit])[1];
    expect(
      (init.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("retries ONCE on a fast connect failure, then succeeds", async () => {
    const f = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("ECONNREFUSED"))
      .mockImplementationOnce(() => json(200, okBody));
    const { client, sleep } = make(f);
    expect((await client.place(req)).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((sleep.mock.calls as number[][])[0][0]).toBeLessThanOrEqual(50);
  });

  it("retries a fast 503 once, and reports http_5xx if it fails again", async () => {
    const f = jest.fn().mockImplementation(() => json(503, {}));
    const { client } = make(f);
    expect(await client.place(req)).toEqual({ ok: false, reason: "http_5xx" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 500 (only 502-504)", async () => {
    const f = jest.fn().mockImplementation(() => json(500, {}));
    const { client } = make(f);
    expect(await client.place(req)).toEqual({ ok: false, reason: "http_5xx" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a failure that took longer than 300 ms", async () => {
    const holder: { advance?: (ms: number) => number } = {};
    const f = jest.fn().mockImplementation(() => {
      holder.advance?.(301);
      return json(503, {});
    });
    const made = make(f);
    holder.advance = made.advance;
    expect((await made.client.place(req)).ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("never retries a timeout", async () => {
    const f = jest.fn().mockRejectedValue(timeoutErr());
    const { client } = make(f);
    expect(await client.place(req)).toEqual({ ok: false, reason: "timeout" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("never retries a 4xx; 422 CONTRACT_VERSION maps to `version`", async () => {
    const f = jest
      .fn()
      .mockImplementation(() => json(422, { code: "CONTRACT_VERSION" }));
    const { client } = make(f);
    expect(await client.place(req)).toEqual({ ok: false, reason: "version" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("maps 401 to http_4xx and does not trip the breaker", async () => {
    const f = jest.fn().mockImplementation(() => json(401, {}));
    const { client } = make(f);
    for (let i = 0; i < 8; i++) {
      expect(await client.place(req)).toEqual({
        ok: false,
        reason: "http_4xx",
      });
    }
    expect(client.breaker.state).toBe("closed");
  });

  it("rejects a wrong contractVersion as invalid_response", async () => {
    const f = jest
      .fn()
      .mockImplementation(() => json(200, { ...okBody, contractVersion: 9 }));
    const { client } = make(f);
    expect(await client.place(req)).toEqual({
      ok: false,
      reason: "invalid_response",
    });
  });

  it("opens the breaker after 5 failed calls, then fails fast without fetch", async () => {
    const f = jest.fn().mockRejectedValue(timeoutErr());
    const { client } = make(f);
    for (let i = 0; i < 5; i++) await client.place(req);
    expect(client.breaker.state).toBe("open");
    f.mockClear();
    expect(await client.place(req)).toEqual({
      ok: false,
      reason: "breaker_open",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("recovers: after the open window a successful probe closes the breaker", async () => {
    const f = jest.fn().mockRejectedValue(timeoutErr());
    const { client, advance } = make(f);
    for (let i = 0; i < 5; i++) await client.place(req);
    advance(15_000);
    f.mockImplementation(() => json(200, okBody));
    expect((await client.place(req)).ok).toBe(true);
    expect(client.breaker.state).toBe("closed");
  });
});
