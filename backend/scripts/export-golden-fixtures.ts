/**
 * Export the scheduler-core golden fixtures (issue #62 / #60).
 *
 *   pnpm --filter backend golden:export          # (re)write the JSON
 *   pnpm --filter backend golden:export -- --check   # exit 1 on drift (CI)
 *
 * The TypeScript core is the source of truth; the Python port
 * (`services/bandit`) loads the same file and must reproduce every `output`.
 * `src/scheduler/golden/golden-fixtures.spec.ts` runs the same comparison in
 * the normal unit-test run, so a core change without regenerated fixtures
 * (and therefore without a Python update) fails CI.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import {
  buildGoldenFixtures,
  GOLDEN_FIXTURES_PATH,
  serializeGoldenFixtures,
} from "../src/scheduler/golden/golden-fixtures-io";

const target = resolve(__dirname, "..", GOLDEN_FIXTURES_PATH);
const fresh = serializeGoldenFixtures(buildGoldenFixtures());

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== fresh) {
    console.error(
      `Golden fixtures are out of date: ${target}\nRun: pnpm --filter backend golden:export`,
    );
    process.exit(1);
  }
  console.log("Golden fixtures are up to date.");
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, fresh, "utf8");
  console.log(`Wrote ${target}`);
}
