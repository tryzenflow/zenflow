#!/usr/bin/env node
// PostToolUse (edit tools): fast per-file formatting only. Never blocks an edit.
//  - backend/prisma/schema.prisma -> regenerate the Prisma client, remind to migrate
//  - backend *.ts                 -> prettier --write
import { execFileSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "../lib/manifest.mjs";
import { readPayload } from "../lib/payload.mjs";

const p = readPayload();
if (!p) process.exit(0);

// No shell: edited paths are untrusted input (e.g. `backend/$(cmd).ts`).
const run = (cmd, args, cwd) => {
  try {
    execFileSync(cmd, args, { cwd, stdio: "ignore" });
  } catch {
    /* formatting never blocks */
  }
};

for (const f of p.files) {
  if (f === "backend/prisma/schema.prisma") {
    run("pnpm", ["prisma:gen:dev"], path.join(repoRoot, "backend"));
    process.stderr.write(
      "Prisma client regenerated. If the schema changed: pnpm --filter backend prisma:dev:migrate\n",
    );
    process.exit(2);
  }
  if (f.startsWith("backend/") && f.endsWith(".ts")) {
    run("pnpm", ["exec", "prettier", "--write", path.join(repoRoot, f)], path.join(repoRoot, "backend"));
  }
}
