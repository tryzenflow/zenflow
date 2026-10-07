---
name: diagram
description: "Update a Zenflow architecture diagram in docs/architecture (C4 container, scheduler components, ingestion components, flows). Use after a structural change."
---

# diagram

## Input
The structural change (new service, module, flow or dependency).

## Steps
1. Pick the diagram: `docs/architecture/c4-container.svg`, `scheduler-components.svg`, `ingestion-components.svg`, or the Mermaid flows in `scheduler-flows.md`.
2. Edit the SVG in place (keep its fonts, colours and layout grid), or the Mermaid block.
3. Keep labels equal to real module/service names (`backend/src/<dir>`, `services/bandit`).
4. Open the SVG in a browser to check nothing overlaps; confirm Mermaid renders on GitHub syntax.
5. Reference the diagram from `ARCHITECTURE.md` if it is new.

## Rules
Diagrams live in `docs/architecture/`; READMEs link them, never embed or redraw them (AGENTS.md → Docs).

## Output
Changed files and one line on what moved.
