#!/usr/bin/env node
// Stop hook for the Zenflow monorepo — runs once when Claude finishes a turn (AFTER all
// edits). It does the heavy, batch work that we deliberately keep off the per-edit path:
//   1. eslint --fix on the frontend  (lint autofixes, incl. rewriting deep relative imports
//      to the "@/…" alias via eslint-plugin-no-relative-import-paths)
//   2. pnpm shared:build             (so consumers typecheck against fresh .d.ts)
//   3. pnpm -r typecheck             (workspace-wide; surfaced to Claude on failure)
// Backend formatting is handled per-edit (prettier) in on-edit.mjs, so we don't run a
// backend-wide lint here and churn files that weren't touched this turn.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  /* no stdin */
}
if (raw) {
  try {
    const data = JSON.parse(raw);
    // Avoid infinite loops: if we already blocked once this stop, don't block again.
    if (data.stop_hook_active === true) process.exit(0);
  } catch {
    /* ignore */
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const tryRun = (cmd, cwd) => {
  try {
    execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch {
    /* lint --fix is best-effort; unfixable lint errors don't block the turn */
  }
};

// 1. Frontend lint autofixes (alias rewriting happens here, after all edits).
tryRun("pnpm exec eslint . --fix", path.join(root, "frontend"));

// 2. Build shared so FE/BE typecheck against fresh types.
try {
  execSync("pnpm shared:build", { cwd: root, stdio: "ignore" });
} catch {
  /* non-fatal */
}

// 3. Workspace typecheck — the one gate that blocks the turn on failure.
try {
  execSync("pnpm -r typecheck", {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
} catch (e) {
  const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
  process.stderr.write(
    `Workspace typecheck (pnpm -r typecheck) failed:\n${out}\n`,
  );
  process.exit(2);
}

process.exit(0);
