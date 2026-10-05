import { describe, expect, it } from "vitest";
import { createSerialGate } from "../serial-gate";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createSerialGate", () => {
  it("runs tasks one at a time in call order", async () => {
    const gate = createSerialGate();
    const log: string[] = [];
    const d = deferred();
    const a = gate.run(async () => {
      log.push("a:start");
      await d.promise;
      log.push("a:end");
      return 1;
    }, -1);
    const b = gate.run(async () => {
      log.push("b");
      return 2;
    }, -1);
    await Promise.resolve();
    expect(log).toEqual(["a:start"]);
    d.resolve();
    expect(await Promise.all([a, b])).toEqual([1, 2]);
    expect(log).toEqual(["a:start", "a:end", "b"]);
  });

  it("an unregister queued after an in-flight register runs after it", async () => {
    const gate = createSerialGate();
    const log: string[] = [];
    const d = deferred();
    const reg = gate.run(async () => {
      await d.promise;
      log.push("register");
    }, undefined);
    await Promise.resolve(); // register has started
    gate.invalidate();
    const unreg = gate.run(async () => {
      log.push("unregister");
    }, undefined);
    d.resolve();
    await Promise.all([reg, unreg]);
    expect(log).toEqual(["register", "unregister"]);
  });

  it("skips queued tasks invalidated before they start", async () => {
    const gate = createSerialGate();
    const d = deferred();
    const first = gate.run(
      async () => d.promise.then(() => "first"),
      "skipped",
    );
    const queued = gate.run(async () => "queued", "skipped");
    gate.invalidate();
    d.resolve();
    expect(await first).toBe("skipped");
    expect(await queued).toBe("skipped");
  });

  it("exposes isCurrent to a running task", async () => {
    const gate = createSerialGate();
    const d = deferred();
    const seen: boolean[] = [];
    const p = gate.run(async (isCurrent) => {
      seen.push(isCurrent());
      await d.promise;
      seen.push(isCurrent());
    }, undefined);
    await Promise.resolve();
    gate.invalidate();
    d.resolve();
    await p;
    expect(seen).toEqual([true, false]);
  });

  it("keeps going after a task throws", async () => {
    const gate = createSerialGate();
    const bad = gate.run(async () => {
      throw new Error("x");
    }, 0);
    await expect(bad).rejects.toThrow("x");
    expect(await gate.run(async () => 5, 0)).toBe(5);
  });
});
