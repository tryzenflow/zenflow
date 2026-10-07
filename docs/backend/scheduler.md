# Backend scheduler

For: developers changing placement, sessions or reminders in Nest. Decisions: [ADR-0003](../adr/0003-python-authoritative-placement.md), [ADR-0002](../adr/0002-scheduling-simplification.md), [ADR-0001](../adr/0001-linucb-model-design.md). Diagrams: [scheduler-components.svg](../architecture/scheduler-components.svg), sequence flows in [scheduler-flows.md](../architecture/scheduler-flows.md). A/B and reranking: [ab-testing](../scheduler/ab-testing.md), [reranking](../scheduler/reranking.md).

The scheduler places one `TASK` (or one series) into an empty slot and never moves anything else.

## Layering

- `scheduler/core/*` is pure and deterministic: no database, no `new Date()`, no `Math.random()`; `now` is passed in.
- `scheduler/io/*` is the only Prisma and bandit-HTTP layer: placers, the one occupancy query, the delayed-reward writer, two crons.
- Same split for `ingestion/core` vs services. Why it is a hard invariant: [AGENTS.md](../../AGENTS.md).

## Python-authoritative placement

- `services/bandit` (`POST /v1/place`) is the sole ranking path: heuristic, LinUCB, series spreading, displacement and the two infeasible fallbacks.
- Nest gathers inputs, calls, applies, persists (`scheduler/io/python-placer.service.ts` and friends). The legacy TS ranking path is deleted.
- **Degraded mode** (Python down, unreachable or contract-mismatched):
  - A free slot is placed by the frozen TS heuristic (`FallbackPlacer`).
  - The A/B policy is still rolled and recorded.
  - The response carries `schedulingDegraded: true` and a `degradedReason`. Never a 503.
  - A pre-flight miss still answers `409 SCHEDULE_INFEASIBLE`.
- **Never unplaced.** A `TASK` row is inserted before placement, so a ranking miss becomes `ACCEPTED_LAST_RESORT`, not an error:
  1. Least-conflict start before the deadline.
  2. First free start up to 30 days late.
  3. Latest on-grid start ending by the deadline (pinned past already-pinned siblings).
- Backfill rows from before this guarantee: `pnpm --filter backend backfill:unplaced [--dry-run]`.
- **Golden fixtures** cover only the frozen fallback: `pnpm --filter backend golden:export` writes `test/golden/scheduler-core.golden.json`, asserted by `services/bandit/tests/test_golden_ts.py`.
  - A fallback bug fix updates both sides. Behaviour changes go in `services/bandit` only.

## Notes

- **Slot scoring** (`core/slot-score.ts`, fallback only): overlap-weighted sum of the per-hour preference matrix; `bestFreeSlot` picks the top free slot in a window. LinUCB scoring is Python's (`services/bandit/src/core/linucb_best_slot.py`) and not golden-tested against TS.
- **Displacement and sync conflicts:** EDF repack and the infeasible fallbacks are Python's. Nest applies the response (`scheduler/io/displacement.service.ts`) and raises per-source conflict notifications (`ingestion/sync-conflicts.service.ts`).
- **Series bounded window** (`core/series-spread.ts`, frozen, ported to Python): splits a series' day span into N non-overlapping buckets; tail buckets absorb the remainder days.

## Session reminders

`reminders/`: one-shot `SchedulerRegistry` timers.

- Re-armed on every create/update/delete via `syncUser()`.
- A 5-min sweep re-arms anything firing within 24 h (the `setTimeout` overflow guard) and claims fired occurrences via `firedForStart`, so restarts do not double-send.
- `replace()` skips a new reminder whose time is past or under 60 s away; responses list those leads in `skippedReminders`.
- A reminder missed by 2 min or less still fires after a restart.
- `arm()` adds 5-10 s jitter (`REMINDER_RANDOM`, injectable).

## Where things live

| Concept | File |
| --- | --- |
| Preference matrix, decay, reinforcement | `scheduler/core/preference.ts`, `matrix-decay.ts` |
| Fallback slot score, series spread | `scheduler/core/slot-score.ts`, `series-spread.ts` |
| rrule expansion, occurrence ids | `scheduler/core/recurrence.ts` |
| Delayed-reward math, conflict detection | `scheduler/core/reward.ts`, `sync-conflicts.ts` |
| One day's occupancy and workload (only occupancy query) | `scheduler/io/day-load.ts` |
| Fallback driver (`placeSingle` / `placeSeries`) | `scheduler/io/heuristic-placer.service.ts`, `fallback-placer.service.ts` |
| Pass-through from `sessions/` (arithmetic guard, persist) | `scheduler/io/task-placement.service.ts` |
| Gather, `POST /v1/place`, apply, persist, `SlotProposal`, degraded fallback | `scheduler/io/python-placer.service.ts` |
| `PlaceRequest` builder, two-phase infeasible call | `scheduler/io/placement-gateway.service.ts` |
| Timeout/retry/breaker HTTP client | `scheduler/io/placement-client.service.ts`, `common/circuit-breaker.ts` |
| `TASK` series lifecycle | `sessions/series.service.ts` |
| Delayed reward (first `MOVE` + `RETAINED`) | `scheduler/io/scheduling-feedback.service.ts`, `retained-sessions.service.ts` |
| `primaryPolicy` 50/50, pairwise draw, `SlotProposal` write | `experiments/experiment.service.ts` |
| Fallback tuning constants | `scheduler/constants.ts` |
| Python's ranking core | `services/bandit/src/core/*` |
