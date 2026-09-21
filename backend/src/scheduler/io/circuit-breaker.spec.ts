import { CircuitBreaker } from "./circuit-breaker";

function make() {
  let t = 1_000_000;
  const br = new CircuitBreaker(() => t);
  return { br, advance: (ms: number) => (t += ms) };
}

describe("CircuitBreaker", () => {
  it("opens after 5 consecutive failures and short-circuits", () => {
    const { br } = make();
    for (let i = 0; i < 4; i++) {
      expect(br.tryAcquire()).toBe(true);
      br.onFailure();
    }
    expect(br.state).toBe("closed");
    br.onFailure();
    expect(br.state).toBe("open");
    expect(br.tryAcquire()).toBe(false);
  });

  it("a success resets the consecutive-failure count", () => {
    const { br } = make();
    for (let i = 0; i < 4; i++) br.onFailure();
    br.onSuccess();
    for (let i = 0; i < 4; i++) br.onFailure();
    expect(br.state).toBe("closed");
  });

  it("opens on >=50% failures over >=10 calls inside the window", () => {
    const { br, advance } = make();
    // Alternate so the consecutive rule never trips: 5 ok + 5 failed = 50%.
    for (let i = 0; i < 4; i++) {
      br.onSuccess();
      advance(100);
      br.onFailure();
      advance(100);
    }
    br.onSuccess(); // 9 calls: 4 failed
    expect(br.state).toBe("closed");
    br.onFailure(); // 10th call: 5/10 failed
    expect(br.state).toBe("open");
  });

  it("ignores old calls outside the 10 s window", () => {
    const { br, advance } = make();
    for (let i = 0; i < 4; i++) {
      br.onFailure();
      br.onSuccess();
    }
    advance(11_000);
    for (let i = 0; i < 3; i++) br.onFailure();
    expect(br.state).toBe("closed");
  });

  it("goes half-open after 15 s, admits ONE probe, closes on success", () => {
    const { br, advance } = make();
    for (let i = 0; i < 5; i++) br.onFailure();
    advance(14_999);
    expect(br.state).toBe("open");
    advance(1);
    expect(br.state).toBe("half_open");
    expect(br.tryAcquire()).toBe(true);
    expect(br.tryAcquire()).toBe(false); // probe in flight
    br.onSuccess();
    expect(br.state).toBe("closed");
    expect(br.tryAcquire()).toBe(true);
  });

  it("a failed probe re-opens with a doubled window, capped at 60 s", () => {
    const { br, advance } = make();
    for (let i = 0; i < 5; i++) br.onFailure();
    advance(15_000);
    br.tryAcquire();
    br.onFailure(); // open for 30 s now
    advance(29_999);
    expect(br.state).toBe("open");
    advance(1);
    expect(br.state).toBe("half_open");
    br.tryAcquire();
    br.onFailure(); // 60 s
    advance(60_000);
    br.tryAcquire();
    br.onFailure(); // stays capped at 60 s
    advance(59_999);
    expect(br.state).toBe("open");
    advance(1);
    expect(br.state).toBe("half_open");
  });

  it("onNeutral releases the half-open probe slot", () => {
    const { br, advance } = make();
    for (let i = 0; i < 5; i++) br.onFailure();
    advance(15_000);
    expect(br.tryAcquire()).toBe(true);
    br.onNeutral();
    expect(br.tryAcquire()).toBe(true);
  });
});
