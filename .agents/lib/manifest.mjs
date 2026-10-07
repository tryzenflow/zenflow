// Reads .agents/agents/*.md frontmatter into the ownership manifest.
// Frontmatter is a tiny YAML subset: `key: value`, and `key:` followed by `  - item` lines.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const agentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(agentsDir, "..");

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let list = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && list) {
      list.push(item[1].trim());
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw === "") {
      list = meta[key] = [];
    } else {
      list = null;
      meta[key] = raw === "true" ? true : raw === "false" ? false : raw.replace(/^"(.*)"$/, "$1");
    }
  }
  return { meta, body: m[2] };
}

export function loadAgents(dir = path.join(agentsDir, "agents")) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const { meta, body } = parseFrontmatter(readFileSync(path.join(dir, f), "utf8"));
      return { ...meta, owns: meta.owns ?? [], readonly: meta.readonly === true, body };
    });
}

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

// Specificity = literal characters before the first wildcard; longest wins.
const specificity = (glob) => glob.search(/\*/) === -1 ? glob.length + 1 : glob.search(/\*/);

export function makeOwnerOf(agents) {
  const rules = agents.flatMap((a) =>
    a.owns.map((g) => ({ agent: a.name, glob: g, re: globToRegExp(g), score: specificity(g) })),
  );
  return (relPath) => {
    const p = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
    let best = null;
    for (const r of rules) {
      if (r.re.test(p) && (!best || r.score > best.score)) best = r;
    }
    return best ? best.agent : null;
  };
}

export const toRel = (file) => path.relative(repoRoot, path.resolve(repoRoot, file)).replace(/\\/g, "/");
