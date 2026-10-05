#!/usr/bin/env node
// PreToolUse (edit tools): keep subagents inside the paths they own.
//  - inside a subagent: edits outside its `owns` globs are denied (exit 2); readonly agents can't edit
//  - main thread: a one-line nudge naming the owner, once per owner per session
//    (ZENFLOW_ENFORCE=strict turns the nudge into a deny)
// Unowned paths (root config, AGENTS.md, .agents/) are always allowed.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAgents, makeOwnerOf } from "../lib/manifest.mjs";
import { readPayload } from "../lib/payload.mjs";

const p = readPayload();
if (!p || p.files.length === 0) process.exit(0);

const agents = loadAgents();
const ownerOf = makeOwnerOf(agents);
const me = p.agent ? agents.find((a) => a.name === p.agent) : null;

if (me) {
  if (me.readonly) {
    process.stderr.write(`${me.name} is read-only. Report findings instead of editing.\n`);
    process.exit(2);
  }
  const bad = p.files.map((f) => [f, ownerOf(f)]).filter(([, o]) => o && o !== me.name);
  if (bad.length) {
    const lines = bad.map(([f, o]) => `  ${f} -> ${o}`).join("\n");
    process.stderr.write(`${me.name} does not own:\n${lines}\nHand these off to the owning agent.\n`);
    process.exit(2);
  }
  process.exit(0);
}

const strict = process.env.ZENFLOW_ENFORCE === "strict";
const notes = [];
const stateDir = path.join(os.tmpdir(), "zenflow-owner-nudge");
for (const f of p.files) {
  const owner = ownerOf(f);
  if (!owner) continue;
  const mark = path.join(stateDir, `${p.session}-${owner}`);
  if (!strict && existsSync(mark)) continue;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(mark, "");
  notes.push(`${f} is owned by the \`${owner}\` agent`);
}
if (notes.length === 0) process.exit(0);
const msg = `${notes.join("; ")}. Delegate to it, or proceed if the change is small.`;
if (strict) {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
}
process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg } }),
);
