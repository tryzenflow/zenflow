describe("PAIRWISE_SAMPLE_RATE", () => {
  const original = process.env.PAIRWISE_SAMPLE_RATE;
  afterEach(() => {
    if (original === undefined) delete process.env.PAIRWISE_SAMPLE_RATE;
    else process.env.PAIRWISE_SAMPLE_RATE = original;
  });

  // The constant is read once at import, so each case loads a fresh copy of the module.
  const load = (value?: string): number => {
    if (value === undefined) delete process.env.PAIRWISE_SAMPLE_RATE;
    else process.env.PAIRWISE_SAMPLE_RATE = value;
    let rate = NaN;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      rate = (require("./constants") as { PAIRWISE_SAMPLE_RATE: number })
        .PAIRWISE_SAMPLE_RATE;
    });
    return rate;
  };

  it("defaults to 1 (every placement computes both policies)", () => {
    expect(load()).toBe(1);
  });

  it("can be lowered for the load test", () => {
    expect(load("0")).toBe(0);
    expect(load("0.25")).toBe(0.25);
  });

  it("clamps to 0..1", () => {
    expect(load("5")).toBe(1);
    expect(load("-1")).toBe(0);
  });

  it("falls back to 1 on a non-numeric value", () => {
    expect(load("abc")).toBe(1);
  });
});
