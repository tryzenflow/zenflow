#!/usr/bin/env node
// PreToolUse guard (Bash|PowerShell) for the Zenflow monorepo.
// Blocks BROAD git staging/commits that sweep unrelated working-tree changes into a
// commit (the monorepo often carries unrelated in-progress edits across areas):
//   - git add -A | --all | -u | --update | .        (stages everything / all tracked)
//   - git commit -a | -am | --all                   (stages & commits all tracked)
// Allows explicit, scoped operations:
//   - git add frontend/src/foo.tsx                  (specific pathspecs)
//   - git commit -m "..." / --amend                 (commit only what's already staged)
// Exit 2 blocks the tool call and surfaces the message to Claude.

import { readFileSync } from "node:fs";

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
  process.exit(0); // can't parse → don't block
}

const command = data?.tool_input?.command;
if (!command || typeof command !== "string") process.exit(0);

/** Split a shell line into individual command segments (best-effort). */
function segments(line) {
  return line.split(/&&|\|\||;|\||\n/);
}

/**
 * If a segment is a broad `git add`/`git commit`, return a human reason; else null.
 * Tokenization is naive (whitespace) — good enough for the flag/pathspec shapes we
 * care about; ambiguous cases fail open (allow) rather than over-block.
 */
function blockReason(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = tokens.indexOf("git");
  if (i === -1) return null;
  i++;
  // Skip git global options (-C <path>, -c <kv>, --git-dir=…, etc.).
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "-C" || t === "-c" || t === "--git-dir" || t === "--work-tree") {
      i += 2;
      continue;
    }
    if (t.startsWith("-")) {
      i++;
      continue;
    }
    break;
  }
  const sub = tokens[i];
  const args = tokens.slice(i + 1);

  if (sub === "add") {
    for (const a of args) {
      if (a === "-A" || a === "--all" || a === "-u" || a === "--update")
        return `\`git add ${a}\` stages unrelated changes across the whole tree`;
      if (a === "." || a === ":/" || a === "*")
        return `\`git add ${a}\` stages everything in the working tree`;
    }
    return null;
  }

  if (sub === "commit") {
    for (const a of args) {
      if (a === "--all")
        return "`git commit --all` stages & commits all tracked changes";
      // Short-flag cluster containing `a`, e.g. -a, -am, -av (but not --amend, -m).
      if (/^-[a-zA-Z]+$/.test(a) && a.includes("a"))
        return `\`git commit ${a}\` stages & commits all tracked changes`;
    }
    return null;
  }

  return null;
}

for (const seg of segments(command)) {
  const reason = blockReason(seg);
  if (reason) {
    process.stderr.write(
      `Blocked: ${reason}.\n` +
        "This repo often carries unrelated in-progress edits, so blanket staging bundles them into the commit.\n" +
        "Stage explicit paths instead, e.g. `git add backend/src/foo.ts path/two.ts`, then `git commit -m \"…\"`.\n" +
        "If you genuinely intend to commit everything, run the staging command yourself outside the agent.\n",
    );
    process.exit(2);
  }
}

process.exit(0);
