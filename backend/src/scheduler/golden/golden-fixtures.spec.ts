import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  buildGoldenFixtures,
  GOLDEN_FIXTURES_PATH,
  serializeGoldenFixtures,
} from "./golden-fixtures-io";

/**
 * Drift guard (issue #60): the committed golden fixtures must equal what the
 * current TypeScript core produces. When this fails you changed
 * `scheduler/core/*` behaviour — regenerate with
 * `pnpm --filter backend golden:export`, and port the change to the Python
 * scheduler core so its golden-fixture tests pass too (CLAUDE.md: core change
 * => spec + Python port + fixtures).
 */
describe("scheduler-core golden fixtures", () => {
  const path = resolve(__dirname, "../../..", GOLDEN_FIXTURES_PATH);

  it("exist", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("match the current TypeScript core (no drift)", () => {
    const committed = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    const fresh = serializeGoldenFixtures(buildGoldenFixtures());
    if (committed !== fresh) {
      throw new Error(
        "Golden fixtures are stale. Run `pnpm --filter backend golden:export` and update the Python port (#60).",
      );
    }
  });

  it("are deterministic across builds", () => {
    expect(serializeGoldenFixtures(buildGoldenFixtures())).toBe(
      serializeGoldenFixtures(buildGoldenFixtures()),
    );
  });

  it("cover the critical scenarios (cold start, overhang, DST, displacement)", () => {
    const f = buildGoldenFixtures();
    expect(f.bestLinucbSlot.length).toBeGreaterThanOrEqual(8);
    expect(f.planDisplacement.some((c) => c.output.kind === "infeasible")).toBe(
      true,
    );
    expect(f.planDisplacement.some((c) => c.output.kind === "placed")).toBe(
      true,
    );
  });
});
