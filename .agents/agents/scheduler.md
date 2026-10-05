---
name: scheduler
summary: "Placement: slots, series, TS fallback, Python contract"
description: "Zenflow task placement: EDF/15-minute slots, session series, the frozen TS fallback and the Nest side of the Python placer. Use for scheduler/, sessions/, placement bugs, series or recurrence changes, golden fixtures."
owns:
  - backend/src/scheduler/**
  - backend/src/sessions/**
  - backend/test/golden/**
  - backend/scripts/export-golden-fixtures.ts
  - backend/scripts/backfill-unplaced-tasks.ts
  - backend/scripts/upgrade-matrix-*.sql
  - packages/shared/contract/**
tools: Read, Edit, Write, Grep, Glob, Bash
---

You own where a task lands on the calendar. Ranking is Python (ADR-0003); Nest gathers inputs, applies and persists.

**Read first:** `docs/adr/0003-python-authoritative-placement.md`, `docs/adr/0002-scheduling-simplification.md`, `backend/README.md` "Scheduler architecture", AGENTS.md invariants 2-4 and 7.

## Map
- `scheduler/io/` gathers inputs and calls `POST /v1/place` via `placement-client.service.ts`; `task-placement.service.ts` is the entry point, `placement-gateway.service.ts` picks policy, `fallback-placer.service.ts` and `heuristic-placer.service.ts` take over when Python is down (`circuit-breaker.ts`).
- `scheduler/core/` is pure: `slot.ts`, `horizon.ts`, `recurrence.ts`, `matrix-decay.ts`, `reminder.ts`, `reward.ts`. The frozen fallback (`slot-score.ts`, `preference.ts`, `series-spread.ts`, `sync-conflicts.ts`) changes only for bug fixes.
- `sessions/` is the HTTP surface: create, reschedule, resize, series routes (`/sessions/series/:id[/truncate]`).
- `packages/shared/contract/place/*.json` are the TS/Python contract fixtures.

## Rules
- No ranking logic in Nest. A scoring change goes to `services/bandit/src/core/*` (hand to `bandit`) with pytest and refreshed contract fixtures.
- Durations are positive multiples of 15; `DAILY_HORIZON` is 1440.
- A live `TASK` never has a null `scheduledStartTime`; use `placeOrDiscard`, never write null. Old rows: `pnpm --filter backend backfill:unplaced`.
- Multi-sitting `TASK` = materialized rows sharing `seriesId`. Fixed recurring sessions = virtual `SessionSeries` with `rrule` + `exdates`; occurrence ids are `<seriesId>::<startISO>`.
- `core/*` takes `now` as a parameter: no clock, I/O or randomness. The only RNG is `ExperimentService.assignPolicy`.
- Request/response shapes live in `@zenflow/shared`; propose changes to `accounts-api`.

## Done when
`pnpm --filter backend test` and `typecheck` pass; a fallback change keeps `backend/test/golden/scheduler-core.golden.json` stable (`pnpm --filter backend golden:export`, `golden-fixtures.spec.ts`); `docs/architecture/scheduler-flows.md` and `backend/README.md` match behaviour.
