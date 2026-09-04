/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { BanditService } from "./bandit.service";

function make(url: string | undefined) {
  const config = { get: jest.fn().mockReturnValue(url) };
  return new BanditService(config as never);
}

const COLD = {
  EARLY_MORNING: { A: [], b: [] },
  MORNING: { A: [], b: [] },
  AFTERNOON: { A: [], b: [] },
  EVENING: { A: [], b: [] },
  NIGHT: { A: [], b: [] },
} as never;

describe("BanditService", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("is disabled and returns null without calling fetch when no URL is set", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    const svc = make(undefined);

    expect(svc.enabled).toBe(false);
    expect(await svc.predict([{ day: "2026-06-15", x: [1] }], COLD)).toBeNull();
    expect(await svc.update("MORNING", [1], 1, { A: [], b: [] })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("predict returns the scores map on a 200", async () => {
    const scores = { "2026-06-15": { MORNING: 0.3, NIGHT: 0.8 } };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scores }),
    }) as never;
    const svc = make("http://bandit:8100/");

    const out = await svc.predict([{ day: "2026-06-15", x: [1, 2] }], COLD);
    expect(out).toEqual(scores);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("http://bandit:8100/predict");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.alpha).toBeCloseTo(0.15);
    expect(body.ridge).toBeCloseTo(1);
  });

  it("update returns the new (A, b) on a 200", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ A: [1, 0, 0, 1], b: [2, 3] }),
    }) as never;
    const svc = make("http://bandit:8100");

    const out = await svc.update("NIGHT", [0.1], -0.5, { A: [], b: [] });
    expect(out).toEqual({ A: [1, 0, 0, 1], b: [2, 3] });
  });

  it("returns null on a non-200", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503 }) as never;
    const svc = make("http://bandit:8100");
    expect(await svc.predict([{ day: "2026-06-15", x: [1] }], COLD)).toBeNull();
  });

  it("returns null when fetch throws (timeout / network)", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("The operation was aborted")) as never;
    const svc = make("http://bandit:8100");
    expect(await svc.update("MORNING", [1], 1, { A: [], b: [] })).toBeNull();
  });
});
