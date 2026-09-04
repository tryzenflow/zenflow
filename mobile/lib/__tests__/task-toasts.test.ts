import { describe, expect, it } from "vitest";
import { shouldSurfaceRescheduleHint } from "../task-toasts";

describe("shouldSurfaceRescheduleHint", () => {
  it("fires on the first save, then every 5th", () => {
    // 1st: yes. 2nd–4th: no. 5th: yes. 6th–9th: no. 10th: yes.
    const results = Array.from({ length: 12 }, () =>
      shouldSurfaceRescheduleHint(),
    );
    expect(results).toEqual([
      true, // 1
      false, // 2
      false, // 3
      false, // 4
      true, // 5
      false, // 6
      false, // 7
      false, // 8
      false, // 9
      true, // 10
      false, // 11
      false, // 12
    ]);
  });
});
