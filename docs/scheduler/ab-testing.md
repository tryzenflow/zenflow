# Zenflow Scheduling A/B Testing Strategy

**Goal:** does personalized Disjoint LinUCB produce better scheduling recommendations than
the existing preference-heuristic, measured on real user behavior rather than offline
metrics? Both policies schedule only the current `TASK` into an empty feasible slot and
never move or displace another session.

## 1. Compared policies

Both share the same downstream mapping in [`reranking.md`](./reranking.md) (candidate-day
scan, hard-constraint + empty-slot filter, single-pass slot scoring, earliest-start
tie-break) and differ only in how a slot's temporal-preference score is computed.

| Policy | Slot score |
| ------ | ---------- |
| **A — Preference heuristic** | overlap-weighted sum of `User.preferenceMatrix[weekday, hour]` over the interval — `slotPreferenceScore`/`bestFreeSlot` (`services/bandit/src/core/slot_score.py`, frozen TS port in `backend/src/scheduler/core/slot-score.ts`) |
| **B — Disjoint LinUCB** | `Σ_arm overlap_rate(slot, arm) × linucbScore(day, arm) + slotPreferenceScore(slot)` — the preference term is a cold-start blend so a slot ranks sensibly before any arm has reward ([ADR-0001](../adr/0001-linucb-model-design.md)) |

Neither policy has a deviation/move-cost term — the empty-slot-only guarantee is shared by
both.

## 2. Randomization

50/50 primary-policy assignment on every scheduling-triggering event: task creation (a
series records one proposal per member), deadline change, deletion requiring reschedule, or
explicit reschedule. Logged per event: `SlotProposal.experimentId`, `primaryPolicy`,
`randomizationSeed`, `userId`, `sessionId`, `timestamp`. Never conditioned on the student or
the task.

## 3. Optional pairwise comparison

A sampled subset shows both policies' proposed slots side by side, policy identity hidden,
presentation position randomized 50/50. Recorded (`SlotProposal.pairwiseShown`,
`pairwisePositions`, `chosenByUser`) for the win-rate metric only — **not** a LinUCB weight
update (§4).

## 4. Like/dislike feedback

An optional 👍/👎 after a generated schedule is an **evaluation signal only** — a
schedule-level judgement, not a per-`(arm, context)` reward, and kept separate from the
LinUCB reward to avoid misattributing credit and mixing signal scales.

## 5. Reward — the only thing that updates learned state

`preferenceMatrix` and LinUCB `(A, b)` are updated **only** by the move-or-keep signal
(`MOVE` graded by drag distance, `RETAINED = +1`; [ADR-0001](../adr/0001-linucb-model-design.md)
§7, [`services/bandit/README.md`](../../services/bandit/README.md)). Pairwise choices and
👍/👎 are offline-analysis data, nothing more.

## 6. Metrics

**Primary:** schedule acceptance rate (`SlotProposal.acceptedWithoutModification`).

**Secondary:** retention rate (`RETAINED` vs `MOVE`), drag frequency/distance, deletion
rate, like/dislike rate, pairwise win rate, time to first modification, policy divergence.

## 7. Cold-start / adaptation

Bucket observations by per-user interaction count (`0–5, 6–10, 11–20, 21–40, 40+`) and
compare policies within each bucket. Hypothesis: heuristic wins cold, LinUCB wins once
enough feedback has accumulated — a null result is also valid.
