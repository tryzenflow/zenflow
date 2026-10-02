# ADR-0003: Python-Authoritative Placement (thin Nest API, frozen TS heuristic fallback)

**Status:** Accepted — fully rolled out; the legacy/shadow TS ranking code and its mode flag
have since been deleted.
**Date:** 2026-09-21
**Issue:** none; builds on #60 (numpy core port) and #62 (slot-first LinUCB, displacement).
Supersedes #60's "TS core is the source of truth" stance.

Endpoint contract, degraded-mode behavior, and rollout mechanics now live in
[`backend/README.md`](../../backend/README.md) ("Python-authoritative placement" and
"Scheduler architecture") and [`services/bandit/README.md`](../../services/bandit/README.md) —
this record captures the decision and why, not the current implementation detail.

## Context

- The same ranking math existed twice: `backend/src/scheduler/core/*` (TypeScript) and
  `services/bandit/src/core/*` (numpy, kept in golden-fixture parity with it).
- After issue #62 the TS scan became the slow path (up to 30-60 days of 15-minute starts,
  EDF displacement) while Python already scanned the same space with prefix-sums and
  `argmax`.
- Nest's pre-ADR flow: load day loads, run the heuristic scan in TS, call Python only for
  arm scores, run slot-selection and displacement in TS, then persist.
- Problems this caused: every core change had to be written twice; the hot loop blocked the
  Node event loop; it was unclear which implementation was authoritative.

## Decision

- **Python (`services/bandit`, `POST /v1/place`) becomes the sole ranking implementation** —
  heuristic best-free-slot, LinUCB slot-first scoring, series spreading, and displacement all
  move there, pure numpy (no I/O, clock, or randomness; `now` is a parameter).
- **Nest becomes thin**: it gathers inputs (day loads, preference matrix, observation count,
  bandit `(A, b)`), calls `/v1/place` through `PlacementClient`, applies and persists the
  result, and owns the only RNG (`ExperimentService.assignPolicy`).
- **A small frozen copy of the pre-#62 TS heuristic stays as a degraded-mode fallback**
  (`FallbackPlacer`, built on `HeuristicPlacer`) for when Python is unreachable — it changes
  only for bug fixes, never for behavior, and is checked against Python by a narrowed golden
  fixture set.
- **Rollout was staged behind a mode flag** (contract → Python endpoint → Nest client/gateway
  → cut-over → prod hardening → delete the dead TS code) so the app stayed releasable at every
  commit; the final deletion phase shipped without a production shadow-mode soak having ever
  run, an explicit, accepted product decision (see Consequences).
- **Alternatives rejected**: keeping both implementations authoritative (dual maintenance, TS
  scan still on the event loop); Python-only with no fallback (a Python restart would break
  task creation); keeping the full TS core as the fallback (keeps the parity burden); having
  Python own policy assignment (needs randomness and persistence, which Nest already owns).

## API / data model changes

- New internal contract `packages/shared/src/placement.ts` (`PlaceRequest`/`PlaceResponse` and
  friends) for the Nest ↔ Python wire shape — see `backend/README.md` for the endpoint
  contract and outcome enum.
- No new client-facing `/api/v1` endpoints. Additive fields only: `schedulingDegraded?: boolean`
  on create/update/reschedule responses, and a `SCHEDULER_DEGRADED_CODE` 503 body alongside the
  existing `SCHEDULE_INFEASIBLE`.
- Prisma: `SlotProposal` gains `placementSource` (`PYTHON | TS_FALLBACK`, default `PYTHON`) and
  a nullable `degradedReason`. `modelVersion` now carries Python's constants-hash
  `paramsVersion`. One additive migration; existing rows backfilled to whichever source they
  actually used.

## Consequences

- **Good:** one ranking implementation instead of two; the hot loop is off the Node event
  loop; Nest is smaller; one versioned model (`paramsVersion`) for the A/B experiment.
- **Costs:** full-quality scheduling now has a hard dependency on Python being reachable —
  displacement and the infeasible policies are unavailable in degraded mode; one extra network
  hop per placement; contract-drift risk (mitigated by shared fixtures and strict schema
  validation on both sides).
- **Accepted risk:** the dead TS ranking code was deleted without ever running the Python mode
  in a deployed environment or completing a shadow-mode soak. There is no longer a parallel
  full TS ranking implementation to fall back to if the Python placer has an undiscovered bug —
  only git history has the deleted code, not a live rollback flag. `FallbackPlacer` plus
  `PlacementClient`'s breaker/retry/timeout remain the degraded-mode safety net; contract
  fixtures and the narrowed golden-parity test remain the drift guards on the surfaces that
  still have two implementations or a documented wire contract. A production regression in the
  LinUCB/displacement math now has no TS-side test to catch it — only Python's own test suite.
- **Follow-ups:** move preference-matrix reinforcement/decay to Python if the matrix ever
  becomes learned rather than hand-tuned; the circuit breaker's state is per-process (fine at
  current scale, would need sharing across replicas at larger scale); a latency/throughput
  benchmark comparing pre-#62 TS, slot-first TS, and Python-authoritative placement was planned
  but never built — dropped as speculative rather than migrated here.
