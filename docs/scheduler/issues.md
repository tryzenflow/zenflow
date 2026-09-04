Part G — LinUCB readiness assessment (deliverable)

RESOLVED 2026-08-31. Every blocker below has been folded into the design docs:
docs/adr/0001-linucb-model-design.md is now the single source of truth for the feature
vector (d = 46, §5), normalization (§5.2), reward (§7), delayed feedback (§9), persistence
(§6.1), and parameters (α = 0.15, λ = 1.0, §10). docs/scheduler/reranking.md,
services/bandit/linucb.md, docs/scheduler/ab-testing.md, and services/bandit/README.md
were rewritten against the current heuristic.ts / day-reschedule.service.ts. Decisions
taken: TASK-only scheduling (drop the type one-hot); extend the Python PoC into a stateless
FastAPI service; persist (A, b) in a dedicated Postgres table (no pgvector); 👍/👎 is an
evaluation metric only. This section is kept for historical context.

--- original assessment below ---

Verdict: the LinUCB design docs (docs/adr/0001-linucb-model-design.md,
docs/scheduler/reranking.md, services/bandit/linucb.md, services/bandit/README.md) are
NOT yet unambiguous enough to start implementation. The model core
(services/bandit/src/models/linucb.py) and the offline replay evaluator are implemented and
tested; everything between "a scheduling event happens" and "the model learns from it" is
under-specified or contradictory. Blockers, grouped:

G1. Contradictions to resolve (docs disagree with each other)

1. Feature vector — three incompatible definitions: ADR §5 (time-to-deadline, task type,
   grade-risk weight, day-of-week, candidate time-of-day, workload), ADR §7.5 (day_preference_profile[24],
   duration, multi-hot tags, deadline_from_now, day_of_week[7], candidate_days_from_now,
   workload-by-type ×~9, month/semester, weekday flag), and services/bandit/README.md
   ([day_of_week, hours_to_deadline, t₁…tₙ, current_day_load]). Pick one; the model
   dimension d is unknowable until then.

feature vector:

- session: deadline, remaining_days_until_deadline, duration, type (ASSIGNMENT/LECTURE/EXAM/TASK) (omit tags, title, note)
- user: day_preference_profile[24] (row vector)
- candidate day: day_of_week[7], workload_by_type (hour + count), semester

2. Tags vs task-type in the context — ADR §7.2 says task-type one-hot with tags "later";
   §7.5 puts multi-hot tags in the initial set with no task-type; §7.4's worked example uses
   task-type. Decide. -> no tags in the feature vector, include session-type (renamed from task)
3. Reward rule — the entire reward section was deleted from the ADR by the uncommitted
   edit. The only surviving definition is README.md's 1.0 accepted / 0.0 moved / 0.5 resized, which contradicts the deleted "drag is a graded signal" language and this
   redesign's RETAINED +1 / MOVE −1 (no "resized", no "accepted" event). Re-state it against
   the new SessionEventType. -> resize: 0.0, move: how distant from the proposed slot, unbounded from 0 to -inf (but scaled down with lerp)
4. Deviation weighting — ab-testing.md §7 requires the shared ranking to apply a
   "deviation weight"; the uncommitted reranking.md rewrite deleted the whole
   λ_t = λ₀·e^(−γt) section; linucb.md never had it. Decide whether it exists; if so,
   λ₀ / γ (or half-life h) need values. -> no need to actually, since we leave other sessions untouched, only schedule the current one with available remaining slots
5. Slot-score combination — linucb.md step 3–4 (sort by overlap, then re-sort by
   score) vs reranking.md step 3 (Σ overlap_rate × score in one pass) produce different
   orderings. -> I'd probably sort once based on the overlap rate x score in one pass, the two-sort in linucb.md may be slower
6. ab-testing.md §1.A describes a heuristic that does not exist — "preference matrix
   over time-of-day categories" + "deviation penalty". The real heuristic.ts is 24 hourly
   buckets, EDF order, earliest-tie, no deviation penalty. The A/B "Policy A" baseline must be
   re-specified to match the code. -> just pref matrix heuristic finding best **available** slot, no reschedule or anything; similar to the (4)
7. 👍/👎 semantics — ab-testing.md §4 says like/dislike is explicitly not a model
   reward; §10 says it "can be used to update LinUCB weights". Pick one. -> like/dislike + two choices shown like in chatgpt are useful signals. but for like/dislike, I intend to only use two choices for higher signals, assess for me?

G2. Unspecified values / rules an implementer needs

8. alpha (exploration width) — never given anywhere except the throwaway demo (1.0). -> yeah, try different values of alpha, but I think we should prioritize stability (we don't want to explore EARLY_MORNING arm as best)
9. ridge / λ — only symbolic (A = λI); no number. -> okay, just follow the code
10. Per-student LinUCB state persistence — the ADR mandates "persisted across requests and
    restarts" but names no store, table, or serialization format for (A, b) per arm per user.
    services/bandit state is in-process only. This needs a schema (Postgres table? Redis?)
    before anything ships. -> right now, there's no db yet, I don't know if we should use a separate db instance with pgvector for this, or shared with prisma in the User table?
11. 7×24 preferenceMatrix → 5-arm mapping — required for A/B parity
    (ab-testing.md §7 "shared final ranking") and for the day_preference_profile feature;
    specified nowhere (mean? sum? max over each band?). -> we use the preferenceMatrix[day_of_week] (a column slice) and feed it to the model. while also use the matrix for computation of the ideal time
12. Is LinUCB queried once per candidate day or once per concrete 15-min slot?
    Day-level features (remaining_free_time, current_day_load) imply per-day;
    reranking.md's surviving "candidate context x" language implies per-slot. -> we run linucb per day from `now` to `deadline`, then generate candidate slots then filter those satisfying constraints
13. Multi-hot tag width — tags are per-user (Tag @@unique([userId, name])). A per-user
    vector breaks a shared d; a global vocabulary does not exist. Decide the encoding.
14. exam / grade-risk weight (ADR §5) — no such field in the data model; source undefined. -> again, omit tags from feature vector
15. Normalization — "all continuous features are normalized" with no method or ranges;
    deadline_from_now has three names across the ADR and no divisor; decayed
    preferenceMatrix values are unbounded. -> we should have days_until_deadline, and perhaps std them from -1 to 1
16. Arm boundaries — half-open? A session starting exactly at 17:00 is AFTERNOON or
    EVENING? overlap_rate needs this pinned. -> 17:00 EVENING
17. Day-scan lower bound — now vs next_15min(now), used interchangeably in both
    reranking.md and linucb.md. -> `next_15min(now)` of course
18. "comparable/high preference" (reranking.md step 4) — the tolerance that lets an empty
    lower-scored slot beat an occupied higher-scored one is never quantified. -> no, for simplicity, we'll only schedule on empty slots
19. Hard-constraint list is never enumerated (unavailable periods, "protected near-term
    sessions", and now DND). Confirm the bandit sees DND as a hard block (it does, per Part C3). -> DND is a hard block, the bandit can schedule any bucket, but we'll filter out in the mapping to valid candidate slots phase
20. Delayed-feedback bookkeeping — where the pending (arm, context, recommendation timestamp) lives between /predict and the eventual /update was deleted from the ADR.
    SlotProposal is the natural home but has no armContext / featureVector column
    (Part A5 deliberately did not add one — add it when this is decided). -> perhaps we should add featureVector as a pgvector col in case we need to look up

G3. Integration seam that the docs assume but does not exist

21. services/bandit/README.md describes plugging in at edf.ts / reranker.ts /
    SlotReRanker / feasibleSlots() / backend/src/simulation/ / pnpm sim:\* — none of
    these exist (deleted in 6d3f42b). The re-ranker seam, the BANDIT_SERVICE_URL config,
    the scoreSlot() call with EDF fallback, and the compose service entry all have to be
    built first. linucb.md and reranking.md should be rewritten against the current
    heuristic.ts / day-reschedule.service.ts shape. -> btw, EDF is dropped because it's inferior. we would use pref matrix to schedule empty + hot slots
22. services/bandit uses 3 arms (morning/afternoon/evening); the ADR/docs use 5.
    Canonical arm identifiers for the API contract are undefined. -> 5 arms please, the services/bandit is just a PoC of linucb from scratch (no integration or anything)
23. Phase-4 archetypes / POST /seed depend on User.roleArchetypeId and an archetype
    weight store — neither is in the schema. -> drop Phase 4 entirely
