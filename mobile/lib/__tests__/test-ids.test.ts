import { describe, expect, it } from "vitest";
import { slugifyTitle, taskCardTestID } from "../test-ids";

describe("slugifyTitle", () => {
  it("lowercases and hyphenates title runs", () => {
    expect(slugifyTitle("E2E Focus Block abc-1")).toBe(
      "e2e-focus-block-abc-1",
    );
  });

  it("collapses non-alphanumeric runs into one hyphen", () => {
    expect(slugifyTitle("E2E  Seeded___Task!!")).toBe("e2e-seeded-task");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugifyTitle("  E2E This Week ")).toBe("e2e-this-week");
  });
});

describe("taskCardTestID", () => {
  it("prefixes the slug with the calendar namespace", () => {
    expect(taskCardTestID("E2E Next Week")).toBe(
      "calendar.taskCard.e2e-next-week",
    );
  });
});
