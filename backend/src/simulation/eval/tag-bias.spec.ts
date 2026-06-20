import { aggregateTagBias, type BiasEvent } from "./tag-bias";

/**
 * Per-tag duration-bias aggregation from telemetry (ADR-0001 §2). Each task
 * contributes ONE final ratio (`actual ÷ estimated`, or 1.0 if the estimate was
 * accepted) to every tag it carried.
 */

const create = (taskId: string, dur: number, tags: string[]): BiasEvent => ({
  eventType: "CREATE",
  taskId,
  newSnapshot: { durationMinutes: dur, tags },
});
const resize = (taskId: string, dur: number, tags: string[]): BiasEvent => ({
  eventType: "RESIZE",
  taskId,
  newSnapshot: { durationMinutes: dur, tags },
});
const keep = (taskId: string, tags: string[]): BiasEvent => ({
  eventType: "KEEP",
  taskId,
  newSnapshot: { tags },
});

describe("aggregateTagBias", () => {
  it("derives actual÷estimated from a CREATE→RESIZE pair", () => {
    // 60 est → 90 actual = ratio 1.5 for #backend.
    const table = aggregateTagBias([
      create("t1", 60, ["backend"]),
      resize("t1", 90, ["backend"]),
    ]);
    expect(table.get("backend")).toEqual({ n: 1, b: 1.5 });
  });

  it("treats a kept (un-resized) task as an accepted estimate (ratio 1.0)", () => {
    const table = aggregateTagBias([
      create("t1", 60, ["admin"]),
      keep("t1", ["admin"]),
    ]);
    expect(table.get("admin")).toEqual({ n: 1, b: 1.0 });
  });

  it("attributes a multi-tag task's ratio to every tag", () => {
    const table = aggregateTagBias([
      create("t1", 60, ["backend", "ops"]),
      resize("t1", 120, ["backend", "ops"]),
    ]);
    expect(table.get("backend")).toEqual({ n: 1, b: 2 });
    expect(table.get("ops")).toEqual({ n: 1, b: 2 });
  });

  it("averages multiple observations per tag", () => {
    const table = aggregateTagBias([
      create("t1", 60, ["x"]),
      resize("t1", 90, ["x"]), // 1.5
      create("t2", 60, ["x"]),
      resize("t2", 30, ["x"]), // 0.5
    ]);
    expect(table.get("x")).toEqual({ n: 2, b: 1.0 });
  });

  it("ignores tasks with no estimate, no tags, or no outcome", () => {
    const table = aggregateTagBias([
      create("t1", 60, []), // no tags
      resize("t2", 90, ["y"]), // no CREATE estimate
      create("t3", 60, ["z"]), // created but never settled/resized
    ]);
    expect(table.size).toBe(0);
  });
});
