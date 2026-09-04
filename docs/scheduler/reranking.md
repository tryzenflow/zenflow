# LinUCB-to-Timestamp Scheduling Strategy

How Zenflow turns LinUCB's coarse `(day, time-of-day)` scores into one concrete calendar
timestamp — simply and deterministically, without moving any existing session.

LinUCB (see [`../adr/0001-linucb-model-design.md`](../adr/0001-linucb-model-design.md))
learns **which day × time-of-day regions a student prefers**. This document is the
mapping layer that sits between LinUCB's scores and a real start time. It is used by both
scheduling policies in the A/B test (the preference heuristic and LinUCB) so neither gets
an advantage from a different realization mechanism.

This intentionally does **not** attempt global schedule optimization. Global rescheduling
and combinatorial optimization are out of scope — the research question is whether
contextual online learning improves *temporal preference selection*, not whether a global
optimizer can produce the theoretically optimal calendar.

## Where it runs

The live scheduler today is the deterministic heuristic —
[`backend/src/scheduler/heuristic.ts`](../../backend/src/scheduler/heuristic.ts) (pure
core) + [`heuristic-schedule.service.ts`](../../backend/src/scheduler/heuristic-schedule.service.ts)
(the only Prisma layer — `scheduleTask` / `scheduleSeries`, single-session, no repack).
See [`heuristic.md`](./heuristic.md). LinUCB scheduling adds a
sibling path: a per-day call to the bandit service
(`BANDIT_SERVICE_URL`, see `services/bandit/README.md`), then the mapping below. The
`optimize()` slot-scoring and overlap-rate helpers are pure functions in
`backend/src/scheduler/utils/` with `*.spec.ts` coverage (CLAUDE.md invariant 2).

## Input / output

```text
input:  a TASK s with deadline dl_s and duration dur_s
        the day's occupied intervals (fixed sessions, DND occurrences, other placed TASKs)
output: one concrete scheduled start timestamp t_s
```

Only `TASK` sessions reach this path — fixed types and `DND` are user-pinned (ADR-0002).

---

## Algorithm

### 1. Score candidate day × time-of-day arms

For every candidate day `d` from the next 15-minute boundary through the deadline:

```text
d ∈ [next_15min(now), dl_s]
```

build the LinUCB context vector for `(s, d)` (ADR-0001 §5, `d = 46`) and call `/predict`
to score all five arms:

```text
EARLY_MORNING = [00:00, 06:00)
MORNING       = [06:00, 11:00)
AFTERNOON     = [11:00, 17:00)
EVENING       = [17:00, 20:00)
NIGHT         = [20:00, 24:00)
```

Boundaries are half-open, lower-inclusive (a session starting at 17:00 is `EVENING`).
This produces a grid:

```text
(day, arm) → LinUCB score

(Tue, MORNING) → 0.42
(Tue, NIGHT)   → 0.81
(Wed, EVENING) → 0.76
...
```

### 2. Generate concrete candidate slots

Generate 15-minute-aligned start times from `next_15min(now)` through the deadline. A
candidate `c` survives only if `[c, c + dur_s)` satisfies every **hard constraint**:

1. `c ≥ next_15min(now)`
2. `c + dur_s ≤ dl_s`
3. `c` is on the 15-minute grid
4. `[c, c + dur_s)` does not overlap any `occupied` interval — fixed sessions
   (`ASSIGNMENT` / `EXAM` / `LECTURE`), standalone `DND`, recurring `DND` occurrences
   (`expandRrule`), other already-placed `TASK`s
5. the slot is **fully empty** — partial-overlap placement is not allowed

Steps 1 and 4 mean `DND` is a hard block even though LinUCB scored its bucket in step 1;
the filter removes it here.

> **Update (scheduler reorg).** The old constraint 3 ("`c + dur_s ≤ the candidate day's
> local midnight`") is gone: a slot may now start before local midnight and run into the
> next morning up to the deadline, matching the heuristic path. `overlapRate` splits a
> straddling slot at midnight and scores each side against its own day's arm scores.

### 3. Derive a preference score for each concrete slot

A concrete interval does not map to exactly one arm, so score it by how much it overlaps
each arm on its day, in a **single pass**:

```text
slot_score(c) = Σ_arm  overlap_rate(c, arm) × score(day(c), arm)
              + slotPreferenceScore(c)            ← cold-start blend (scheduler reorg)
```

`overlap_rate(c, arm)` is the fraction of `[c, c + dur_s)` that falls inside that arm's
band. `slotPreferenceScore(c)` is the identical overlap-weighted preference score Policy A
uses (`core/slot-score.ts`): the bandit service returns `0` for an arm with no accumulated
reward, so without this addend a cold model would rank every slot equally. Example — a
2-hour session starting 19:00:

```text
19:00–20:00 → EVENING   (overlap_rate 0.5)
20:00–21:00 → NIGHT     (overlap_rate 0.5)
slot_score = 0.5 · score(day, EVENING) + 0.5 · score(day, NIGHT)
```

One pass, one ranking. (An earlier draft sorted by overlap and then re-sorted by score;
that produces a different, slower, and less meaningful ordering — dropped.)

### 4. Rank and pick

Rank the surviving (empty, feasible) slots by `slot_score` descending. Choose the
highest. **Earliest start breaks ties** — deterministic, and no extra randomness after
LinUCB has already made the learned decision.

Because step 2 already filtered to empty slots, there is no "prefer empty among
comparable" trade-off and no tolerance parameter: an occupied slot is simply not a
candidate. Existing sessions are never displaced to realize a higher score.

### 5. Fallback

If the top-scored slot is unavailable (it will not be, post-filter, but the ranked list is
walked defensively), continue down the ranked list to the next feasible empty slot. If a
whole day's preferred region is occupied, a later day's slot wins:

```text
1. Tue 20:00  ← highest score, occupied  → filtered out in step 2
2. Tue 20:15  ← occupied                 → filtered out
3. Wed 19:00  ← next-best, empty          → selected
```

### 6. Record the proposal

Write a `SlotProposal` with `proposedStartTime = t_s`, `selectedArm` (the arm with the
largest overlap contribution to `t_s`), and `featureVector` (the length-`d` context for
`day(t_s)`) so the delayed `MOVE` / `RETAINED` reward can update the right arm later
(ADR-0001 §9).

---

## Design trade-off

**Advantages**

- Very simple, fully deterministic, easy to explain and test within the thesis timeline.
- LinUCB owns the entire learned personalization signal; no second optimizer.
- Schedules stay stable — no existing session is ever moved.
- The same mapping serves both A/B policies.

**Disadvantages**

- No global optimization of the day.
- A highly preferred region can be unavailable even when rearranging other sessions could
  have fit the task there.
- Final-timestamp quality depends partly on the deterministic ranking + fallback.

```text
LinUCB → (day, time-of-day) scores → single-pass overlap-weighted slot scoring
       → hard-constraint + empty-slot filter → earliest highest-scored slot → SlotProposal
```
