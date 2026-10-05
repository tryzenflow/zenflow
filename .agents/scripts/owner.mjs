#!/usr/bin/env node
// Who owns this? Usage:
//   node .agents/scripts/owner.mjs <path...>   print "<path>\t<agent|->" per path
//   node .agents/scripts/owner.mjs --diff      same for every changed/untracked file
//   node .agents/scripts/owner.mjs --check     every owns glob matches a file; all source files are owned
//   node .agents/scripts/owner.mjs --table     AGENTS.md ownership table (markdown)
import { execSync } from "node:child_process";
import { globToRegExp, loadAgents, makeOwnerOf, repoRoot } from "../lib/manifest.mjs";

const agents = loadAgents();
const ownerOf = makeOwnerOf(agents);
const git = (args) => execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
const args = process.argv.slice(2);

if (args[0] === "--check") {
  const files = git("ls-files");
  let bad = 0;
  for (const a of agents)
    for (const g of a.owns)
      if (!files.some((f) => globToRegExp(g).test(f))) {
        console.warn(`warning: no file matches ${a.name}: ${g}`);
      }
  const source = /^(backend\/(src|test|prisma|scripts)|frontend\/(src|e2e)|mobile\/(app|api|components|hooks|lib|utils)|services\/|packages\/[^/]+\/(src|contract))\//;
  for (const f of files.filter((f) => source.test(f) && !ownerOf(f))) {
    console.error(`unowned: ${f}`);
    bad++;
  }
  process.exit(bad ? 1 : 0);
}

if (args[0] === "--table") {
  console.log("| Agent | Owns | Role |\n| --- | --- | --- |");
  for (const a of agents)
    console.log(`| \`${a.name}\` | ${a.readonly ? "read-only" : a.owns.map((g) => `\`${g}\``).join(", ")} | ${a.summary ?? ""} |`);
  process.exit(0);
}

const paths =
  args[0] === "--diff"
    ? git("status --porcelain -uall").map((l) => l.slice(3).replace(/^.* -> /, ""))
    : args;
for (const f of paths) console.log(`${f}\t${ownerOf(f) ?? "-"}`);
