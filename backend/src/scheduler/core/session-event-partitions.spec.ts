import {
  countMonthsAhead,
  parsePartitionName,
  partitionName,
  planPartitions,
} from "./session-event-partitions";

const NOW = new Date("2026-10-09T12:00:00Z");

describe("session-event-partitions", () => {
  it("round-trips partition names", () => {
    const month = new Date("2026-03-01T00:00:00Z");
    expect(partitionName(month)).toBe("SessionEvent_2026_03");
    expect(parsePartitionName("SessionEvent_2026_03")).toEqual(month);
  });

  it("ignores names that are not monthly partitions", () => {
    expect(parsePartitionName("SessionEvent_old")).toBeNull();
    expect(parsePartitionName("SessionEvent_2026_13")).toBeNull();
    expect(parsePartitionName("SessionEvent_2026_10_pkey")).toBeNull();
  });

  it("creates the current and next two months when none exist", () => {
    const { create, drop } = planPartitions(NOW, []);
    expect(create.map(partitionName)).toEqual([
      "SessionEvent_2026_10",
      "SessionEvent_2026_11",
      "SessionEvent_2026_12",
    ]);
    expect(drop).toEqual([]);
  });

  it("creates across a year boundary and only what is missing", () => {
    const { create } = planPartitions(new Date("2026-11-30T23:59:59Z"), [
      "SessionEvent_2026_11",
      "SessionEvent_2027_01",
    ]);
    expect(create.map(partitionName)).toEqual(["SessionEvent_2026_12"]);
  });

  it("keeps 12 months back and drops the month before that", () => {
    const { drop } = planPartitions(NOW, [
      "SessionEvent_2025_09",
      "SessionEvent_2025_10",
      "SessionEvent_2025_11",
      "SessionEvent_2026_10",
    ]);
    expect(drop).toEqual(["SessionEvent_2025_09"]);
  });

  it("never drops names it does not own", () => {
    expect(
      planPartitions(NOW, ["SessionEvent_old", "Other_2020_01"]).drop,
    ).toEqual([]);
  });

  it("counts consecutive future months", () => {
    const all = ["SessionEvent_2026_11", "SessionEvent_2026_12"];
    expect(countMonthsAhead(NOW, all)).toBe(2);
    expect(countMonthsAhead(NOW, ["SessionEvent_2026_12"])).toBe(0);
    expect(countMonthsAhead(NOW, [])).toBe(0);
  });
});
