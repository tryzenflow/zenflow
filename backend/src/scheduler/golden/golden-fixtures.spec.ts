import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  buildGoldenFixtures,
  GOLDEN_FIXTURES_PATH,
  serializeGoldenFixtures,
} from "./golden-fixtures-io";

/**
 * Drift guard (ADR-0003 phase 6): the committed golden fixtures must equal
 * what the current TypeScript frozen fallback (`slot-score.ts`,
 * `sync-conflicts.ts`) produces. When this fails you changed one of those
 * files' behaviour — regenerate with `pnpm --filter backend golden:export`
 * and update `services/bandit/tests/test_golden_ts.py`'s assertions (a fix
 * to the frozen fallback must keep the golden test green; the fallback
 * otherwise never changes behaviour, per CLAUDE.md invariant 2).
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

  it("cover the critical scenarios (preference, stability, occupied, deadline)", () => {
    const f = buildGoldenFixtures();
    expect(f.bestFreeSlot.length).toBeGreaterThanOrEqual(3);
    expect(f.slotPreferenceScore.length).toBeGreaterThanOrEqual(3);
    expect(f.stabilityScore.length).toBeGreaterThanOrEqual(3);
    expect(f.findConflictingTaskIds.length).toBeGreaterThanOrEqual(1);
  });
});
