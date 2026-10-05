// Normalizes hook stdin from different coding agents into one shape:
//   { tool, files: [repo-relative paths], agent: subagent name | null, session, command }
import { readFileSync } from "node:fs";
import { toRel } from "./manifest.mjs";

export function readPayload() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function normalize(data) {
  const input = data?.tool_input ?? {};
  const files = new Set();
  for (const k of ["file_path", "path", "notebook_path"]) {
    if (typeof input[k] === "string") files.add(input[k]);
  }
  // Codex apply_patch carries the patch text; collect the touched files.
  const patch = typeof input === "string" ? input : (input.command ?? input.input ?? input.patch);
  if (typeof patch === "string") {
    for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) files.add(m[1].trim());
  }
  return {
    tool: data?.tool_name ?? "",
    files: [...files].map(toRel),
    agent: data?.agent_type ?? data?.agent_name ?? null,
    session: data?.session_id ?? "default",
    command: typeof input.command === "string" ? input.command : "",
  };
}
