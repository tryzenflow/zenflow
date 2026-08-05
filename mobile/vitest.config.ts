import { defineConfig } from "vitest/config";

/**
 * Minimal Vitest config for `mobile/`'s pure, RN-free logic modules only
 * (`lib/month-date-math.ts`, `lib/task-card.ts`, …) — mirrors backend's
 * `*.spec.ts`-next-to-code convention, just with Vitest instead of Jest since
 * neither `mobile/` nor `@zenflow/core` has a test runner configured yet
 * (see `mobile/README.md`'s "Local development" section). Deliberately
 * scoped to `lib/**` — component/screen files import React Native and
 * `@gorhom/bottom-sheet`, which need a real RN test renderer this config
 * doesn't set up; flagged as a gap rather than solved here.
 */
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
