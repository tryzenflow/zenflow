# .agents

Tool-neutral source for Zenflow's coding-agent setup. Edit here, then run `pnpm sync:agents`.

| Path | What |
| --- | --- |
| `agents/*.md` | Domain subagents. Frontmatter: `name`, `description`, `summary`, `owns` (globs), `readonly`, `tools` |
| `skills/<name>/SKILL.md` | Small composable skills; no required order |
| `hooks/*.mjs` | `enforce-owner`, `format-on-edit`, `guard-git-staging` (+ `hooks.test.mjs`) |
| `lib/` | Manifest loader and hook payload normalizer shared by hooks and scripts |
| `scripts/owner.mjs` | `<path...>` / `--diff` / `--check` / `--table`: who owns what |
| `mcp.json` | MCP servers (Playwright) |

Generated, do not edit: `.claude/` (agents, skills, `settings.json`), `.mcp.json`, `.codex/`. Codex reads `.agents/skills` and root `AGENTS.md` directly.

## Ownership
The most specific `owns` glob wins. Unowned paths (root config, `AGENTS.md`, `.agents/`) are open to everyone.
- In a subagent, `enforce-owner` denies edits to files another agent owns, and all edits for `readonly` agents.
- On the main thread it nudges once per owner per session; `ZENFLOW_ENFORCE=strict` makes it a deny.
- Codex payloads may not name the active subagent; there only the nudge applies.

## Add another tool
Add `scripts/agents/adapters/<tool>.mjs` exporting `{ name, roots, generate({ agents, skills, mcp }) -> { path: content } }`.

## Checks
`pnpm test:agents` runs the hook tests, `owner.mjs --check`, and `sync-agents.mjs --check`.
