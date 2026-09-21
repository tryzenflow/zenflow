import { buildGoldenFixtures } from "./build-golden-fixtures";

export { buildGoldenFixtures };

/** Committed location of the fixtures, relative to `backend/`. */
export const GOLDEN_FIXTURES_PATH = "test/golden/scheduler-core.golden.json";

/** Stable serialization (2-space JSON, trailing newline, LF). */
export function serializeGoldenFixtures(
  fixtures: ReturnType<typeof buildGoldenFixtures>,
): string {
  return JSON.stringify(fixtures, null, 2) + "\n";
}
