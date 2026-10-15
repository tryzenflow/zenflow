# ADR-0022: Completion-based reward

**Status:** Accepted; supersedes the `RETAINED` reward of [ADR-0001](0001-linucb-model-design.md) §7 and the `RETAINED` sweep of [ADR-0002](0002-scheduling-simplification.md) §2
**Date:** 2026-10-15
**Issue:** #248 (builds on #247 done/skipped state)

## Context

- A placed session that elapsed without a move was rewarded `+1`, whether or not the student did it.
- #247 records what the student did: `COMPLETE` and `SKIP` events on the session or occurrence.
- The bandit should learn from the outcome of the placed slot, not from the absence of a move.

## Decision

| Outcome of an unmoved placement | Reward | Settles at |
| --- | --- | --- |
| Checked off, at or after the start | `+1` | `end + 15 min` |
| Skipped | `-1` | `end + 15 min` |
| No check-off by `end + 24 h` | `-1` (`MISSED`) | `end + 24 h` |
| Checked off before the start | not counted: treated as no check-off | `end + 24 h` |

- A moved session keeps the graded `MOVE` reward (ADR-0001 §7). It never gets a completion reward.
- Pure rule: `completionReward` in `backend/src/scheduler/core/reward.ts` and `services/bandit/src/core/reward.py`.
- Missed detection: `SessionOutcomeService` (renamed from `RetainedSessionsService`), the half-hourly sweep that already settled elapsed sessions. It is idempotent: `Session.retainedAt` is the settlement stamp, set once in a claim transaction.
- The sweep settles each outcome once. It sets the reward on the `COMPLETE` or `SKIP` event, or writes a `MISSED` event. Then it calls `SchedulingFeedbackService.applyDelayedReward`, which folds the reward into the placing LinUCB arm.
- Undoing a check-off after settlement does not reverse the bandit update.
- Preference matrix: a completion reinforces the kept hour with weight `0.25`, as the `RETAINED` rule did. Skip and miss leave the matrix unchanged.
- `observationCount` counts settled reward events (`rewardEventWhere`).
- Schema: `SessionEventType.MISSED` added (migration `20261015100000_completion_reward`). `RETAINED` stays in the enum for history and is no longer written.
- No `/v1/update` or `BANDIT_MODEL_VERSION` change. The wire carries a scalar reward, and the arm state keeps its layout.

### Simulator

`services/bandit/src/simulation` gained a completion draw (`completes`) on each placement the student keeps or lands. The chance is `clip(0.25 + 0.6 · utility, 0.05, 0.95)` of the slot's hidden utility. This is a modelled assumption, not a measurement. Both reward modes use the same draws, so the completion gap comes from the reward rule alone.

Seed 1, 75 students, 5 scenarios, 60 arrivals each (`SimConfig.reward`):

| Policy | Reward | Kept | Completed | Regret vs oracle |
| --- | --- | --- | --- | --- |
| heuristic | `retained` (before) | 0.617 | 0.635 | 0.390 |
| heuristic | `completion` (after) | 0.622 | 0.642 | 0.371 |
| LinUCB | `retained` (before) | 0.704 | 0.607 | 0.409 |
| LinUCB | `completion` (after) | 0.690 | 0.668 | 0.239 |

- The `retained` rows reproduce the pre-change report exactly.
- The heuristic changes only through the preference matrix, which now updates on completion.

## Consequences

- Good: the reward follows the student's outcome. In the simulator, LinUCB completion rises by 6 points and regret falls by 0.17.
- Good: a missed placement is a negative signal, so a slot the student ignores loses arm credit.
- Cost: a missed placement settles up to 24 hours after its end.
- Cost: kept rate for LinUCB falls by 1.4 points in the simulator. The bandit now trades some kept placements for completed ones.
- Existing arm state was trained on `+1` retained rewards. It is not reset, and new rewards apply on top of it.
- Sessions settled as `RETAINED` before this change keep their `+1` event. Nothing is rewritten.
