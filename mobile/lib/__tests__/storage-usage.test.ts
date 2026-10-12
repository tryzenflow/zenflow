import { describe, expect, it } from "vitest";
import { storageUsage } from "../storage-usage";

const MB = 1024 * 1024;

describe("storageUsage", () => {
  it("is ok below 80%", () => {
    expect(storageUsage(0, 150 * MB)).toEqual({ percent: 0, level: "ok" });
    expect(storageUsage(119 * MB, 150 * MB).level).toBe("ok");
  });
  it("warns from 80% up to the quota", () => {
    expect(storageUsage(120 * MB, 150 * MB)).toEqual({
      percent: 80,
      level: "warn",
    });
    expect(storageUsage(149 * MB, 150 * MB).level).toBe("warn");
  });
  it("is full at or over the quota and caps the bar at 100", () => {
    expect(storageUsage(150 * MB, 150 * MB)).toEqual({
      percent: 100,
      level: "full",
    });
    expect(storageUsage(200 * MB, 150 * MB)).toEqual({
      percent: 100,
      level: "full",
    });
  });
  it("ignores a missing quota or negative usage", () => {
    expect(storageUsage(5, 0)).toEqual({ percent: 0, level: "ok" });
    expect(storageUsage(-5, 100)).toEqual({ percent: 0, level: "ok" });
  });
});
