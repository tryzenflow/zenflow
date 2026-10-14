# ADR-0022: Anchor levels and cost-based displacement

**Status:** accepted
**Date:** 2026-10-14
**Issue:** #250 (Nest side: #251)

## Context
- EDF displacement (ADR-0003, #62) treated every flexible task alike: the earliest start whose cascade succeeded won, whatever it moved.
- A task the user placed by hand, or one about to start, could be moved without asking.
- Placement stays Python-only and pure (`now` is a parameter); detail in [docs/bandit/placement.md](../bandit/placement.md).

## Decision
- **Anchors** on each `infeasible.flexible` entry: `AUTO` (default), `CHOSEN`, `PINNED`.
  - Never move: `fixed`, `PINNED`, and frozen sessions (completed, started, or starting before `nowMs + 2h`).
  - Python derives started and starting-soon from `startMs`; Nest sends `completed`.
- **Cost per move:** `AUTO` 1, `CHOSEN` 10, plus hours moved, plus 10 when the session's local day changes (user timezone).
- **Search:** every start before the deadline, clear of immovable blocks, on the deadline day then +/-1 day. Each runs a cascade; the lowest total cost wins.
  - Cascade: colliding tasks settle in EDF order at their cheapest free start up to their own deadline, max 6 moves.
  - Run twice when a `CHOSEN` task takes part: Chosen settled first and never bumped, and plain EDF (lets a chain run through a Chosen task).
  - Ties: earlier window, earlier start, then the Chosen-protected cascade. Relocation ties go earlier.
  - A moved sitting never lands on a local day holding another sitting of its series (`seriesId`).
- **Confirmation:** `infeasible.chosenMoves` = `ASK` (default) | `ALLOW` | `FORBID`.
  - `ASK` and the plan moves a `CHOSEN` task: outcome `NEEDS_CONFIRMATION`, `startMs` and `moves` carry the full plan, nothing applied.
  - `ALLOW`: same plan as `DISPLACED`. `FORBID`: Chosen counts as pinned; the cheapest remaining plan or the user's fallback policy.
  - No feasible plan never asks; it falls through to `ACCEPT_*` or the last resort.
- **Contract deltas** (`packages/shared/src/placement.ts`, `services/bandit/src/schemas_place.py`):
  - `PLACEMENT_CONTRACT_VERSION` 1 to 2. Python refuses other versions (`422 CONTRACT_VERSION`), so Nest and bandit deploy together.
  - New `PlacementAnchor`, `ChosenMovePolicy`, `PlacementFlexible` (`anchor?`, `completed?`, `seriesId?`), `InfeasibleContext.chosenMoves?`.
  - `PlacementOutcome` gains `NEEDS_CONFIRMATION`; `moves[]` is `PlacementMove` with `anchor` (`AUTO` | `CHOSEN`) and `cost`.
  - Constants: `FROZEN_WINDOW_HOURS`, `DISPLACE_COST_AUTO`, `DISPLACE_COST_CHOSEN`, `DISPLACE_COST_CROSS_DAY` (part of `paramsVersion`).
  - No `/api/v1` route, Prisma or env change.

## Edge cases (tested in `services/bandit/tests/test_anchors.py`)
- No feasible plan, with Auto or Chosen in the way: fallback policy, never `NEEDS_CONFIRMATION`.
- Cascade chains through Auto tasks, through a Chosen task (asks), stopped by a Pinned task; move cap.
- Cross-day penalty, using the local day (`Asia/Ho_Chi_Minh`); a farther same-day slot beats a closer other-day one.
- Deadlines: a task never moves past its own deadline; an overdue task is stuck; the new task ends by its deadline.
- Frozen by time: within 2 h frozen, exactly 2 h movable, started and completed frozen.
- Multi-sitting series: a sitting skips its sibling's day; a series request is never displaced.
- Ties and determinism: equal-cost plans take the earliest start; input order does not change the plan.
- Pinned blocking: Pinned never moves, and alone in the way gives no plan.
- Chosen: cheaper Auto plan leaves Chosen alone; cheaper Chosen plan asks; `ALLOW` and `FORBID`.
- Generated calendars: Pinned, frozen and fixed never move; Chosen moves only under confirmation; no overlaps; costs match.

## Consequences
- A Chosen session never moves without confirmation; a Pinned or frozen one never moves.
- Placements may differ from the old earliest-start rule (`single-displaced.json` now shifts the cheaper task).
- Search tries every candidate (pruned by a cost lower bound), not the first success: more work on the second call only.
- Nest (#251) must send anchors and `completed`, include every sitting of a series with a sitting in the window, and apply moves only on `DISPLACED`; today it applies `moves` for any outcome, safe only while it sends no `CHOSEN`.
- Fixtures: `single-needs-confirmation.json`, `single-displaced-chosen-allowed.json`; all fixtures carry contract version 2.
