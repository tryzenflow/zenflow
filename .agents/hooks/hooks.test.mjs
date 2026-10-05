import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const run = (script, payload) =>
  spawnSync("node", [path.join(dir, script)], { input: JSON.stringify(payload), encoding: "utf8" });
const edit = (file, extra = {}) => ({
  tool_name: "Edit",
  tool_input: { file_path: file },
  session_id: `t-${Math.random()}`,
  ...extra,
});

test("subagent may edit inside its owns globs", () => {
  const r = run("enforce-owner.mjs", edit("backend/src/scheduler/io/x.ts", { agent_type: "scheduler" }));
  assert.equal(r.status, 0);
});

test("subagent is denied outside its owns globs and told who owns it", () => {
  const r = run("enforce-owner.mjs", edit("frontend/src/App.tsx", { agent_type: "scheduler" }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /calendar-web/);
});

test("subagent may edit unowned paths", () => {
  assert.equal(run("enforce-owner.mjs", edit("README.md", { agent_type: "scheduler" })).status, 0);
});

test("readonly agent cannot edit", () => {
  assert.equal(run("enforce-owner.mjs", edit("README.md", { agent_type: "zenflow-reviewer" })).status, 2);
});

test("main thread gets one nudge per owner per session", () => {
  const p = edit("backend/src/scheduler/io/x.ts");
  const first = run("enforce-owner.mjs", p);
  assert.equal(first.status, 0);
  assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /scheduler/);
  assert.equal(run("enforce-owner.mjs", p).stdout, "");
});

test("main thread is silent on unowned paths", () => {
  assert.equal(run("enforce-owner.mjs", edit("AGENTS.md")).stdout, "");
});

test("codex apply_patch paths are extracted", () => {
  const patch = "*** Begin Patch\n*** Update File: mobile/app/index.tsx\n*** End Patch";
  const r = run("enforce-owner.mjs", {
    tool_name: "apply_patch",
    tool_input: { command: patch },
    agent_type: "scheduler",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /calendar-mobile/);
});

test("git guard blocks blanket staging and allows explicit paths", () => {
  const bash = (command) => run("guard-git-staging.mjs", { tool_name: "Bash", tool_input: { command } });
  assert.equal(bash("git add -A").status, 2);
  assert.equal(bash("git commit -am x").status, 2);
  assert.equal(bash("git add backend/src/a.ts").status, 0);
});

test("format hook never runs edited filenames through a shell", () => {
  const marker = path.join(dir, "pwned");
  const r = run("format-on-edit.mjs", {
    tool_name: "Edit",
    tool_input: { file_path: `backend/src/$(touch ${marker}).ts` },
  });
  assert.equal(r.status, 0);
  assert.equal(existsSync(marker), false);
});
