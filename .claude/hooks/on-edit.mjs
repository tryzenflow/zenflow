#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit) for the Zenflow monorepo.
// Fast, per-file FORMATTING only — nothing that rewrites broadly or blocks the flow:
//   - schema.prisma  -> regenerate the Prisma client (+ remind to migrate)
//   - backend *.ts   -> prettier --write
// Lint autofixes (incl. relative->@/ alias rewriting) and typechecking run once per turn in
// the Stop hook (on-stop.mjs), i.e. AFTER all edits — not on every edit.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const raw = readStdin();
if (!raw) process.exit(0);

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

let fp = data?.tool_input?.file_path;
if (!fp) process.exit(0);
fp = fp.replace(/\\/g, "/");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", ".."); // .claude/hooks -> repo root

const tryRun = (cmd, cwd) => {
  try {
    execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch {
    /* non-fatal: formatting/generate steps never block an edit */
  }
};

// --- Prisma schema -> regenerate client ---
if (/\/backend\/prisma\/schema\.prisma$/.test(fp)) {
  tryRun("pnpm prisma:gen:dev", path.join(root, "backend"));
  process.stderr.write(
    "Prisma client regenerated. If the schema changed, create a migration: pnpm --filter backend prisma:dev:migrate\n",
  );
  process.exit(2);
}

// Format backend TS immediately (frontend has no prettier; it's handled on Stop by eslint).
if (/\.ts$/.test(fp) && fp.includes("/backend/")) {
  tryRun(`pnpm exec prettier --write "${fp}"`, path.join(root, "backend"));
}

process.exit(0);
