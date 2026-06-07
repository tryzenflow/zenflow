---
name: ui-ux
description: >-
  UI/UX design phase. Spawns the ui-ux-designer subagent to produce a design concept grounded
  in the existing frontend + "Warm Sunrise" design system, sketch it in Figma (Figma MCP),
  design the missing screens, and adjust existing ones. Use when asked to "design the UI/UX",
  "make mockups", or as phase 2 of /feature.
---

# /ui-ux — design the screens

Spawn the **`ui-ux-designer`** subagent (Agent tool, `subagent_type: ui-ux-designer`).

## Provide the subagent
- The GitHub issue number + acceptance criteria (if available) and the feature request.
- Instruction to ground designs in `frontend/README.md`, the design tokens in
  `frontend/src/index.css` / `App.css`, the `frontend/src/components/` primitives, and the
  existing `frontend/src/pages/` screens.
- The ask: inventory existing screens, identify and design the **missing** screens, adjust
  existing ones, sketch all frames in Figma, and produce a **component-level spec** mapping
  each frame to React components/props for the frontend engineer.

## Prerequisite
The **Figma MCP** (`figma`) must be configured (`.mcp.json`, `FIGMA_API_KEY`). If it isn't,
stop and tell the user.

## Constraints to pass through
Desktop-only (no mobile breakpoints), "Warm Sunrise" Taupe + Amber tokens, dark mode,
glassmorphism, reuse `components/ui` primitives.

## Return to the caller
The list of new/adjusted screens, Figma links, the component spec, and any new `ui/`
primitives required. Skip this phase entirely for features with no UI surface.
