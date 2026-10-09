# ADR-0012: Six time-of-day arms re-cut around late-starting students, and a preference term in the slot score

**Status:** accepted (revised: the first draft proposed eight arms, which the simulator rejected)
**Date:** 2026-10-09
**Issue:** #135
**Supersedes:** the arm table in [ADR-0001](0001-linucb-model-design.md) and its "no preference matrix in LinUCB" rule

## Context
- A slot's LinUCB arm score is constant inside an arm, so a 5-hour `MORNING [06:00,11:00)` arm cannot tell 06:00 from 10:00 and the warm suggestion could land at 06:00.
- Vietnamese students wake late: they start studying around 09:00 and study until about 22:00.
- Eight arms (`MIDNIGHT 0-6`, `DAWN 6-9`, `MORNING 9-12`, `MIDDAY 12-14`, `AFTERNOON 14-17`, `DINNER 17-19`, `EVENING 19-22`, `NIGHT 22-24`) were tried in the simulator (`services/bandit/sim_out/arms8_*`) and the metrics regressed against six arms: more models per user, two only 2 hours wide, slower per-arm learning.
- Inside the winning arm the fixed "nearest the band centre" rule learns nothing: a user who keeps moving tasks to 10:00 still got 09:00.
- No real learned state exists yet, so changing arms now is free; after launch it needs a migration.

## Decision
**Six arms, boundaries moved** (`ARM_BANDS` in `services/bandit/src/core/arms.py`, half-open, local time). The names are unchanged, so the Prisma enum and `SCHEDULING_ARMS` need no change:

| Arm | Hours |
| --- | --- |
| `EARLY_MORNING` | 00-08 |
| `MORNING` | 08-12 |
| `MIDDAY` | 12-14 |
| `AFTERNOON` | 14-18 |
| `EVENING` | 18-22 |
| `NIGHT` | 22-24 |

No waking arm starts before 08:00, and `EARLY_MORNING` stays last in every seeded tie order.

**Default preference matrix** (`defaultPreferenceMatrix()` in `backend/src/scheduler/core/preference.ts` and its Python mirror, golden-tested): 09-12 → 1.0, 14-17 → 0.5, 19-22 → 0.2, else 0 (9 AM is the ideal).

**Preference term in the slot score:**

```text
score = Σ_arm overlap × armScore + wP × preference(slot) + wS × stability
```

- `preference` is the matrix averaged over the slot's hours; `wP = LINUCB_PREF_WEIGHT = 1.0` (`core/constants.py`). The arm models still never see the matrix.
- It decides the hour inside the chosen arm, and a learned matrix can move the pick across arms. The old centre-of-band rule remains only as a tie-break.
- `wP` was chosen from a sweep over 0, 0.25, 0.5, 1, 2 and 4 (3 seeds × 300 students): regret keeps falling with `wP`, while the kept rate and the time to reach 60% kept peak at low weights. 1.0 is the compromise.
- No warm start: the per-arm prior seeded from the default matrix is removed. With the preference term in place, cold arms tie and the default matrix alone puts the first picks in 09:00-12:00; seeding the arms as well was slower to learn in the simulator (kept rate, drag, and about 19 placements to find `MIDDAY` in the closed-loop test).
- The matrix learning rate `PREFERENCE_LEARNING_RATE` goes from 0.1 to 0.2 (backend and Python) so the matrix adapts fast enough to compete with LinUCB.

**Contract:** `BANDIT_MODEL_VERSION` is now `linucb-d7-v1`; `PLACEMENT_CONTRACT_VERSION` stays 1 because the request and response shapes do not change and nothing is deployed yet. Wipe `BanditArmState`. Delayed rewards from proposals made under another arm layout are dropped: the Python `paramsVersion` (stored as `SlotProposal.modelVersion`) is prefixed with `ARM_LAYOUT` (`arms6-v1`, mirrored in `backend/src/scheduler/constants.ts`), and Nest ignores a reward whose proposal does not carry the current layout. Bump `ARM_LAYOUT` whenever the arm hours change. The API and bandit deploy together ([ADR-0013](0013-blue-green-deploy.md)).

## Consequences
- The default user's first suggestion is never before 09:00 and never in 12-14 or 18-19.
- A band the default matrix scores 0 (`MIDDAY`, `NIGHT`) is reached only through a learned preference: in the closed-loop test a user who always wants `MIDDAY` is found after about 6 placements and one who wants `NIGHT` after 4. A mild, uniform nudge (reward -0.25 everywhere) no longer makes LinUCB try those bands.
- The A/B is no longer "pure LinUCB vs pure heuristic": both read the matrix. The comparison is in [heuristic-vs-linucb-report.md](../scheduler/heuristic-vs-linucb-report.md).
- Re-tune `wP` if the real user population differs from the simulated one.
