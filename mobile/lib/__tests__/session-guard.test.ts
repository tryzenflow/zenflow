import { describe, expect, it } from "vitest";
import { sessionIsDead } from "../session-guard";

describe("sessionIsDead", () => {
  it("signs out only when the server is healthy and refused the session", () => {
    expect(sessionIsDead(401, true)).toBe(true);
    expect(sessionIsDead(403, true)).toBe(true);
  });

  it("keeps the session while the server is unwell or the error is something else", () => {
    expect(sessionIsDead(401, false)).toBe(false);
    expect(sessionIsDead(403, false)).toBe(false);
    expect(sessionIsDead(500, true)).toBe(false);
    expect(sessionIsDead(undefined, true)).toBe(false);
  });
});
