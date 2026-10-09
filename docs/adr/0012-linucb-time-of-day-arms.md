# ADR-0012: Eight time-of-day arms and an arm-aligned default preference matrix

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #135
**Supersedes:** the arm table in [ADR-0001](0001-linucb-model-design.md) (including the MIDDAY split)

## Context
- Today there are six arms (`EARLY_MORNING 0-6`, `MORNING 6-11`, `MIDDAY 11-14`, `AFTERNOON 14-17`, `EVENING 17-20`, `NIGHT 20-24`). A slot's LinUCB score is the overlap-weighted sum of arm scores, so it is constant inside an arm: a 5-hour MORNING arm cannot tell 06:00 from 10:00, and the warm suggestion can land at 06:00, which students dislike.
- Students wake late (9 AM is ideal) and meals are a predictable dip.
- No real learned state exists yet, so changing arms now is free; after launch it needs a migration.

## Decision
Eight arms (`ARM_BANDS` in `services/bandit/src/core/arms.py`, half-open, local time):

| Arm | Hours | Default weight |
| --- | --- | --- |
| `MIDNIGHT` (renamed from `EARLY_MORNING`) | 0-6 | 0 |
| `DAWN` (new) | 6-9 | 0 |
| `MORNING` | 9-12 | 1.0 |
| `MIDDAY` | 12-14 | 0 |
| `AFTERNOON` | 14-17 | 0.5 |
| `DINNER` (new) | 17-19 | 0 |
| `EVENING` | 19-22 | 0.3 |
| `NIGHT` | 22-24 | 0.1 |

- The default preference matrix (`defaultPreferenceMatrix()` in `backend/src/scheduler/core/preference.ts` and its Python mirror) uses the same boundaries and weights, so each arm's warm prior is uniform. 0 is neutral: the matrix stays non-negative by default and learned signal overrides it. Weights are initial values, tuned in the simulator.
- Contract deltas: `ArmId`/`ARM_IDS` in `schemas.py`, `SCHEDULING_ARMS` in `packages/shared/src/bandit.ts`, Prisma `SchedulingArm` (rename `EARLY_MORNING` to `MIDNIGHT`, add `DAWN` and `DINNER`; the hours of the other values change), tie-break order (`MIDNIGHT`, `DAWN`, `DINNER` last), place contract fixtures, golden fixtures, `BANDIT_MODEL_VERSION`, `PLACEMENT_CONTRACT_VERSION`.
- Wipe `BanditArmState`; delayed rewards from the old model version are ignored.
- Validate over 20 seeds against the `services/bandit/sim_out/` baselines first; the simulator must penalise early-morning starts, or it cannot show the fix. Fallbacks if cold start suffers: stronger low prior for `MIDDAY`/`DINNER`, or meals as a scheduler constraint with six arms.

## Consequences
- 06:00-09:00 is isolated and learnable; `MORNING` stops absorbing it.
- Eight models per user, two only 2 hours wide: slower per-arm learning, more total prior mass (`LINUCB_PRIOR_N0` is per arm).
- API and bandit must deploy together (contract bump); see [ADR-0013](0013-blue-green-deploy.md).
- Update `docs/bandit/core.md`, `docs/scheduler/reranking.md` and the ADR-0001 table.
