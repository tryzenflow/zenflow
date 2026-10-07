# ADR-0003: Python-Authoritative Placement (thin Nest API, frozen TS heuristic fallback)

**Status:** Accepted. Fully rolled out; the legacy/shadow TS ranking code and its mode flag are deleted.
**Date:** 2026-09-21
**Issue:** none; builds on #60 (numpy core port) and #62 (slot-first LinUCB, displacement).
**Supersedes:** #60's "TS core is the source of truth" stance.

This record holds the decision and why. Endpoint contract, degraded mode and rollout live in [docs/backend/api.md](../backend/api.md), [docs/backend/scheduler.md](../backend/scheduler.md) and [services/bandit/README.md](../../services/bandit/README.md).

## Context

- The same ranking math existed twice: `backend/src/scheduler/core/*` (TypeScript) and `services/bandit/src/core/*` (numpy, in golden-fixture parity).
- After #62 the TS scan was the slow path (30-60 days of 15-minute starts, EDF displacement); Python scanned the same space with prefix-sums and `argmax`.
- Old Nest flow: load day loads, run the heuristic scan in TS, call Python only for arm scores, run slot selection and displacement in TS, persist.
- Problems:
  - every core change was written twice;
  - the hot loop blocked the Node event loop;
  - it was unclear which implementation was authoritative.

## Decision

- **Python (`services/bandit`, `POST /v1/place`) is the sole ranking implementation.**
  - Heuristic best-free-slot, LinUCB slot-first scoring, series spreading and displacement all move there.
  - Pure numpy: no I/O, clock or randomness (`now` is a parameter).
- **Nest is thin.**
  - It gathers inputs (day loads, preference matrix, observation count, bandit `(A, b)`).
  - It calls `/v1/place` via `PlacementClient`, applies and persists the result.
  - It owns the only RNG (`ExperimentService.assignPolicy`).
- **A small frozen copy of the pre-#62 TS heuristic is the degraded-mode fallback** (`FallbackPlacer`, built on `HeuristicPlacer`) when Python is unreachable.
  - It changes only for bug fixes, never behaviour.
  - A narrowed golden fixture set checks it against Python.
- **Rollout was staged behind a mode flag:** contract, Python endpoint, Nest client/gateway, cut-over, prod hardening, delete the dead TS code. The app stayed releasable at every commit.
  - The final deletion shipped without a production shadow-mode soak. This was an explicit, accepted product decision (see Consequences).
- **Rejected alternatives:**
  - both implementations authoritative: dual maintenance, TS scan stays on the event loop;
  - Python-only, no fallback: a Python restart would break task creation;
  - full TS core as fallback: keeps the parity burden;
  - Python owns policy assignment: needs randomness and persistence, which Nest owns.

## API / data model changes

- New internal contract `packages/shared/src/placement.ts` (`PlaceRequest` / `PlaceResponse` and friends) for the Nest to Python wire shape.
- No new client-facing `/api/v1` endpoints. Additive only:
  - `schedulingDegraded?: boolean` on create/update/reschedule responses;
  - a `SCHEDULER_DEGRADED_CODE` 503 body beside the existing `SCHEDULE_INFEASIBLE`.
- Prisma: `SlotProposal` gains `placementSource` (`PYTHON | TS_FALLBACK`, default `PYTHON`) and a nullable `degradedReason`.
- `modelVersion` now carries Python's constants-hash `paramsVersion`.
- One additive migration; existing rows backfilled to the source they used.

## Consequences

- **Good:**
  - one ranking implementation instead of two;
  - hot loop off the Node event loop;
  - Nest is smaller;
  - one versioned model (`paramsVersion`) for the A/B.
- **Costs:**
  - full-quality scheduling hard-depends on Python being reachable; displacement and the infeasible policies are unavailable in degraded mode;
  - one extra network hop per placement;
  - contract-drift risk, mitigated by shared fixtures and strict schema validation on both sides.
- **Accepted risk:**
  - the dead TS ranking code was deleted without running Python mode in a deployed environment or a shadow-mode soak;
  - there is no live rollback flag; only git history has the deleted code;
  - `FallbackPlacer` plus `PlacementClient`'s breaker, retry and timeout remain the degraded-mode safety net;
  - contract fixtures and the narrowed golden-parity test guard the surfaces that still have two implementations or a wire contract;
  - a production regression in the LinUCB/displacement math has no TS-side test, only Python's suite.
- **Follow-ups:**
  - move preference-matrix reinforcement/decay to Python if the matrix ever becomes learned rather than hand-tuned;
  - the circuit breaker's state is per-process (fine now; needs sharing across replicas at scale);
  - a latency benchmark comparing pre-#62 TS, slot-first TS and Python placement was planned, never built, and dropped as speculative.
