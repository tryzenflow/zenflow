import { describe, expect, it } from "vitest";
import { markResponseHandled } from "../push-response";

describe("markResponseHandled", () => {
  it("accepts a response once and rejects the replay", () => {
    expect(markResponseHandled("n1:reschedule")).toBe(true);
    expect(markResponseHandled("n1:reschedule")).toBe(false);
    expect(markResponseHandled("n1:default")).toBe(true);
  });
});
