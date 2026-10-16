import { describe, expect, it } from "vitest";
import {
  ANCHOR_LABEL_KEYS,
  FULL_SNAP_INDEX,
  PEEK_SNAP_INDEX,
  SESSION_DETAIL_SNAP_POINTS,
  sessionEditHref,
} from "../session-detail";

describe("session detail snap points", () => {
  it("peeks first and reaches full second", () => {
    expect(SESSION_DETAIL_SNAP_POINTS).toHaveLength(2);
    expect(PEEK_SNAP_INDEX).toBe(0);
    expect(FULL_SNAP_INDEX).toBe(1);
  });
});

describe("sessionEditHref", () => {
  it("builds the composer route for a plain id", () => {
    expect(sessionEditHref("abc")).toBe("/task/abc/edit");
  });

  it("encodes a recurring occurrence id", () => {
    expect(sessionEditHref("series1::2026-10-15T03:00:00.000Z")).toBe(
      "/task/series1%3A%3A2026-10-15T03%3A00%3A00.000Z/edit",
    );
  });
});

describe("ANCHOR_LABEL_KEYS", () => {
  it("has a copy key for every anchor state", () => {
    expect(Object.keys(ANCHOR_LABEL_KEYS).sort()).toEqual(["AUTO", "CHOSEN", "PINNED"]);
  });
});
