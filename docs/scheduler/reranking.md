# LinUCB-to-Timestamp Scheduling Strategy

How Zenflow turns LinUCB's coarse `(day, time-of-day)` scores into one concrete calendar
timestamp — deterministically, without moving any existing session. LinUCB
([ADR-0001](../adr/0001-linucb-model-design.md)) learns **which day × time-of-day regions a
student prefers**; this is the mapping layer between those scores and a real start time,
shared by both A/B policies so neither gets an advantage from a different realization
mechanism. Out of scope: global schedule optimization — the question is whether contextual
learning improves *temporal preference selection*, not whether a global optimizer could do
better.

**Where it runs:** `services/bandit/src/core/` (authoritative, [ADR-0003](../adr/0003-python-authoritative-placement.md));
`backend/src/scheduler/core/` keeps only the frozen TS heuristic fallback used when the
bandit service is unreachable. See [`services/bandit/README.md`](../../services/bandit/README.md).

```text
input:  a TASK s with deadline dl_s and duration dur_s, the day's occupied intervals
output: one concrete scheduled start timestamp t_s
```

Only `TASK` sessions reach this path — fixed types and `DND` are user-pinned ([ADR-0002](../adr/0002-scheduling-simplification.md)).

## Algorithm

1. **Score candidate day × arm.** For every day from the next 15-min boundary through the
   deadline, build the `d=7` LinUCB context vector and score all six half-open time-of-day
   arms (`EARLY_MORNING [00:00,06:00)` … `NIGHT [20:00,24:00)`, lower-inclusive).

2. **Generate concrete candidate slots.** 15-min-aligned starts survive only if: on/after
   now, ending by the deadline, on-grid, and **fully empty** (no overlap with any fixed
   session, `DND`, or other placed `TASK` — partial overlap is never allowed). A slot may
   straddle local midnight; each side scores against its own day's arms via `overlap_rate`.

3. **Score each slot** in one pass:

   ```text
   slot_score(c) = Σ_arm overlap_rate(c, arm) × score(day(c), arm) + slotPreferenceScore(c)
   ```

   The `slotPreferenceScore` addend is Policy A's overlap-weighted preference score — the
   cold-start blend, since a cold arm scores its exploration bonus rather than a flat 0 but
   still needs a tie-breaker signal early on.

4. **Rank and pick** the highest `slot_score`; earliest start breaks ties. Because step 2
   already filtered to empty slots, there's no "prefer empty" trade-off to make.

5. **Fallback.** If the top slot is somehow unavailable, walk down the ranked list — e.g. a
   fully-booked preferred day loses to the next day's best slot.

6. **Record the proposal** — `SlotProposal.proposedStartTime`, `selectedArm` (largest
   overlap contribution), `featureVector` — so the delayed `MOVE`/`RETAINED` reward can
   credit the right arm later.

## Trade-offs

**Good:** simple, deterministic, easy to test; LinUCB owns the whole learned signal with no
second optimizer; schedules stay stable; one mapping serves both A/B policies.

**Costs:** no global optimization of the day — a preferred region can be unavailable even
when rearranging other sessions could fit the task there; quality depends on the
deterministic ranking + fallback rather than a search over rearrangements.
