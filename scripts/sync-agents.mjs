#!/usr/bin/env node
// Generates tool-specific config from the neutral source in .agents/.
//   node scripts/sync-agents.mjs            write generated files
//   node scripts/sync-agents.mjs --check    exit 1 if any generated file is stale
// Add a tool by dropping an adapter in scripts/agents/adapters/ that exports
//   { name, generate({ agents, skills, mcp }) -> { "<repo path>": "<content>" } }
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { agentsDir, loadAgents, parseFrontmatter, repoRoot } from "../.agents/lib/manifest.mjs";

const check = process.argv.includes("--check");

const skills = readdirSync(path.join(agentsDir, "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    const { meta, body } = parseFrontmatter(readFileSync(path.join(agentsDir, "skills", d.name, "SKILL.md"), "utf8"));
    return { name: d.name, ...meta, body };
  });
const ctx = {
  agents: loadAgents(),
  skills,
  mcp: JSON.parse(readFileSync(path.join(agentsDir, "mcp.json"), "utf8")),
};

const adapterDir = path.join(repoRoot, "scripts/agents/adapters");
let stale = 0;
for (const f of readdirSync(adapterDir).filter((f) => f.endsWith(".mjs")).sort()) {
  const adapter = (await import(pathToFileURL(path.join(adapterDir, f)))).default;
  const files = adapter.generate(ctx);
  // Each adapter fully owns these roots; files no longer generated are removed.
  for (const root of adapter.roots) {
    const abs = path.join(repoRoot, root);
    if (!existsSync(abs)) continue;
    const walk = (p) =>
      statSync(p).isDirectory() ? readdirSync(p).flatMap((c) => walk(path.join(p, c))) : [p];
    for (const file of walk(abs)) {
      const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
      if (adapter.keep?.includes(rel) || rel in files) continue;
      stale++;
      if (check) console.error(`stale (remove): ${rel}`);
      else rmSync(file);
    }
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repoRoot, rel);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (current === content) continue;
    stale++;
    if (check) console.error(`stale: ${rel}`);
    else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }
}
if (check && stale) {
  console.error("Run `pnpm sync:agents` and commit the result.");
  process.exit(1);
}
console.log(check ? "agents in sync" : `synced (${stale} files changed)`);
