# LinUCB scheduling loop (notes)

Terse companion to [`../../docs/scheduler/reranking.md`](../../docs/scheduler/reranking.md)
— that document is authoritative; this is the one-screen version.

Input: a `TASK` `s` with deadline `dl_s`, duration `dur_s`, and the day's `occupied`
intervals.

Output: one ISO start timestamp `t_s`.

Arms (half-open, lower-inclusive):

```text
EARLY_MORNING [00:00,06:00)  MORNING [06:00,11:00)  AFTERNOON [11:00,17:00)
EVENING [17:00,20:00)        NIGHT [20:00,24:00)
```

Algorithm:

1. For each day `d ∈ [next_15min(now), dl_s]`, build the context vector (ADR-0001 §5,
   `d = 46`) and score all 5 arms → `score(d, arm)`.
2. Generate 15-minute-aligned starts from `next_15min(now)` to `dl_s`; keep only slots
   that are fully empty and pass the hard constraints (reranking.md step 2).
3. Score each surviving slot in **one pass**:
   `slot_score(c) = Σ_arm overlap_rate(c, arm) × score(day(c), arm)`.
4. Pick the highest `slot_score`; earliest start breaks ties.
5. Walk the ranked list as a defensive fallback if the top slot is unavailable.

Pro: simple, stable, fast, deterministic.
Con: no global day optimization; a preferred region can be fully occupied.

Note: `services/bandit/` is a from-scratch LinUCB PoC. The production integration
(FastAPI surface, 5 arms, stateless `(A,b)` in the payload) is tracked in this service's
`README.md`; the model core itself is arm-agnostic.
