# Zenflow Heuristic Algorithm

> **What this doc is:** the design of Zenflow's task scheduler and the four-phase roadmap
> that turns it from a plain deadline-sorter into a personalized one.
> **Who should read it:** any engineer (especially a new ML engineer) who needs to understand
> how we place tasks on the calendar, what signals we log, and how each learning phase is
> built and validated. Read this before [`docs/simulation-strategy.md`](simulation-strategy.md),
> which describes how we test these phases on synthetic data.

---

## Concepts & terminology

Read this once; the rest of the doc assumes it. Terms are defined before their first use.

| Term | Plain definition | Why it matters here |
|------|------------------|---------------------|
| **EDF (Earliest-Deadline First)** | A scheduling rule: sort tasks by deadline, then drop each into the first free slot. | Our Phase-1 engine. It is *deterministic* (same inputs → same output) and never learned. |
| **Slot** | A 15-minute block of calendar time. The day is a grid of these. | All scheduling happens on this grid; durations are always multiples of 15 min. |
| **Feasible set** | The slots EDF says a task *could* legally occupy — ones that respect the deadline, work hours, and the 15-min grid. | The intelligence layer is only ever allowed to choose *within* this set. |
| **Re-ranker** | A function that reorders the feasible set so a more-preferred slot comes first, without removing any slot. | This is where every learned model plugs in. If the set has one slot, it does nothing. |
| **Telemetry / `task_events`** | An audit log: one row per user action (created, moved, resized, completed…), recording what was suggested vs. what the user chose. | This log is the *only* data the learners ever see; it makes offline evaluation possible. |
| **Tag** | A user-defined label on a task (`#backend`, `#writing`). A task can have several. | Used both for duration correction and, later, as a model feature. |
| **Duration bias** | A per-tag multiplier = (actual time taken) ÷ (estimated time). >1 means the user underestimates. | We use it to correct the user's estimate *before* scheduling, so blocks are the right size. |
| **Preference matrix** | A per-user 7×96 grid (7 weekdays × 96 fifteen-min blocks) of signed scores: + for liked time blocks, − for disliked. | Phase 2's memory of *when* a user likes to work. |
| **Contextual bandit** | An online learner that, given a *context* (features), picks one *arm* (action) to maximize *reward*, while balancing trying new arms vs. repeating known-good ones. | Phase 3's model. "Contextual" = the best arm depends on the situation. |
| **Arm** | One choosable action for the bandit. Here, a time-of-day block, not a raw 15-min slot. | Fewer arms → less data needed before the bandit learns. |
| **LinUCB** | A specific contextual-bandit algorithm that assumes reward is *linear* in the features and adds an *uncertainty bonus* (UCB) to under-tried arms. | Phase 3's chosen algorithm. "Hybrid" = it mixes shared weights with per-arm weights. |
| **UCB (Upper Confidence Bound)** | Pick the arm with the highest (estimated reward + uncertainty bonus). The bonus shrinks as an arm is tried more. | This is *how* the bandit explores: rarely-seen arms get a benefit-of-the-doubt boost. |
| **Multi-hot vector** | A fixed-width 0/1 vector marking which tags are present, e.g. 6 tags → `[1,0,1,0,0,0]`. | Linear models can't read text lists, so tags are encoded this way. |
| **Softmax / Boltzmann sampling** | Turn scores into probabilities (`p_i ∝ exp(score_i / T)`) and draw randomly. Temperature `T` controls randomness. | Phase 2 uses this so logging is *stochastic*, which off-policy evaluation requires. |
| **Gumbel-top trick** | A trick to draw one softmax sample by adding random "Gumbel" noise to each score and taking the max. | Lets us sample a slot while still returning a clean ordering of the feasible set. |
| **Propensity** | The probability the logging policy assigned to the action it actually took. | Recorded per decision so later off-policy estimators can reweight by it. |
| **Off-policy / counterfactual evaluation** | Estimating how a *new* policy would have performed, using logs collected under the *old* policy. | Lets us score a model on history with zero user exposure. |
| **IPS (Inverse-Propensity-Scoring)** | An off-policy estimator that reweights each logged outcome by 1 / (its logged propensity). | Our core replay estimator. It *requires* a stochastic logging policy with known propensities. |
| **SNIPS** | Self-Normalized IPS: IPS divided by the sum of the weights. Lower variance than raw IPS. | A more stable variant used in the replay gate. |
| **Matrix factorization** | Approximate a big (users × items) matrix as the product of two small ones, revealing latent factors. | Phase 4 uses it to discover user *archetypes* from the preference matrices. |
| **Archetype** | A cluster of users with a similar behavioral signature (e.g. "Night Owl"). | Phase 4 seeds a brand-new user from the nearest archetype to beat the cold-start. |
| **Cold start** | The problem of giving good suggestions to a user with no history yet. | Phase 4's whole job: borrow from the population instead of starting from zero. |
| **MAR (Manual Adjustment Rate)** | Our north-star metric: fraction of suggested placements the user changes. Lower = better. | Every phase must beat the previous one's MAR. Defined precisely in [Evaluation](#evaluation). |

---

## How Phase 1 EDF works (the starting point)

Zenflow uses **Earliest-Deadline First (EDF)** to schedule tasks: it prioritizes the tasks
whose deadlines are soonest.

The user provides:

- Task name
- Estimated duration (must be a multiple of 15 minutes)
- Earliest date to perform the task
- Deadline (latest date by which the task needs to be completed)
- Tags (optional)
- View (current day / week / month)

Underlying attributes:

- Work hours (default is 9–17, stored in minutes as 540–1020)

The view determines which slots are available. For example, in the week view:

- The options are 15-minute slots.
- The start `s` is 9am Monday, end `e` is 5pm Friday.
- Task earliest start is `ts = max(s, ts)`; end is `te = min(deadline, e)`.
- The task deadline must satisfy `s <= deadline <= e`.

EDF then:

- Schedules tasks with tight deadlines early, in deadline order — an O(1) drop into the first
  free slot.

# Intelligence Layer

The schedule EDF produces is basic and not personalized. Today the user manually adjusts it,
and we log every manual edit. Those edits are the raw material for personalizing future
schedules.

## Architecture invariant: hard constraint vs. soft re-ranker

This split holds across **every** phase below and is the spine of the whole roadmap. The
intuition: *deadlines are non-negotiable; preferences only break ties.*

- **EDF is a hard constraint, never learned.** EDF produces the set of *feasible* slots for a
  task — those that respect the deadline, work hours, and the 15-minute grid
  ([CLAUDE.md invariant #3](../CLAUDE.md)). Deadline feasibility is never traded away for
  preference.
- **The intelligence layer is a soft re-ranker.** Every phase from 2 onward only **re-ranks
  within the feasible set** EDF hands it. A learned model can prefer one feasible slot over
  another; it can never return an infeasible one. If the feasible set is a single slot, the
  re-ranker is a no-op.

Concretely, the pipeline is: `candidates = edf.feasibleSlots(task, now)` → `ranked =
reRanker.score(task, candidates)` → pick `ranked[0]`. Phase 1 ships an *identity* re-ranker
(returns the feasible set unchanged); later phases swap in smarter ones behind the same
interface.

## Persistent layers (on from day one, never removed)

Two threads run through all phases and must not be dropped when a later phase lands:

1. **Duration correction (preprocessing).** From Phase 2 on, the estimated duration is
   bias-corrected *before* it reaches EDF. This is orthogonal to slot selection (it fixes
   *how long*, not *where*) and stays a permanent preprocessing step feeding **every** later
   scheduler. Corrected durations are always rounded **up to the next 15-minute multiple** to
   preserve the grid invariant.
2. **Telemetry (the `task_events` audit log).** Recorded from Phase 1. This is what makes
   personalization *and its evaluation* possible — see [Evaluation](#evaluation).

## Signals tracked (from day one)

We log both **negative and positive** placement signals plus **outcome** — not just edits.
The intuition: an *untouched* slot and a *deliberately-kept* slot must be distinguishable.
If we only logged edits, the system could learn what to avoid but never what to prefer.

| Signal | Event | Interpretation |
|--------|-------|----------------|
| Resize | duration differs from suggestion | estimation bias for the task's tags |
| Move-away | dragged out of the suggested slot | dislikes interval X–Y |
| Move-toward / keep | dragged into a slot, or accepted unchanged | **prefers** that interval (positive reward) |
| Outcome | task marked `completed` / `rescheduled` / `abandoned` in its slot | did the placement actually *work* — the real reward proxy |

Placement (move/keep) is a noisy proxy for preference; **completion-in-slot is the ground
truth** a productivity scheduler ultimately optimizes (a user can keep a slot and then fail to
do the task there). Both are logged so later phases can weight them.

# Evolution

The roadmap has four phases. Each adds intelligence *on top of* EDF without ever weakening the
hard-constraint / soft-re-ranker split above. Phase 1 is shipped; Phases 2–4 are planned.

---

## Phase 1: The Deterministic MVP (Core Utility)

**Goal:** Build the foundational CRUD application and the core EDF scheduling engine with
elegant multi-tag structural rendering. No intelligence yet — just strict, deterministic logic,
and complete telemetry.

### Technical Focus

- **Frontend/Backend:** Set up the NestJS API and React PWA. Build the main calendar UI
  (day/week/month views).
- **Multi-Tag UI Layout:** To preserve hyper-constrained grid space on the timeline canvas,
  the UI implements an intelligent overflow pattern. Cards render the highest-priority tag
  fully (`#backend`), while wrapping additional tags into a compact counter chip (`+2`). The
  full tag drawer is exposed on card click or hover.
- **The Engine:** Implement a pure Earliest-Deadline First (EDF) algorithm. When a user adds
  a task, the system sorts it strictly by deadline and drops it into the first available
  15-minute slot within their working hours (e.g., $9 \rightarrow 17$). The engine exposes
  `feasibleSlots(task, now)` so later phases can re-rank its output.
- **Period-bounded placement (no-deadline tasks).** A flexible task with **no user deadline**
  is scheduled within the working hours of the calendar period (day / ISO-week / month) it was
  created in. The active `view` is persisted on the task; its create-day anchor and the end of
  that period together bound the EDF packer (floor = anchor, ceiling = period end, derived as
  `endOfPeriod(anchor, view, tz, work)` and carried into the pure core as the task's
  `schedulingDeadline`). This stops a task created late in a period (e.g. at 23:00 in day view,
  after the work window closes) from silently rolling forward into the next day/week/month —
  it stays **unplaced** and the user is prompted instead. **Night-owl windows:** when the
  user's work window wraps past midnight (`workEnd <= workStart`, e.g. 22:00→06:00), the period
  ceiling is extended to `workEnd` the following morning, so a single contiguous task can occupy
  the post-midnight tail of the window (one row, one start, duration spanning midnight — never
  split). A non-wrapping window is unchanged. A **user deadline** overrides this:
  such a task is packed from `now` by pure EDF urgency, exactly as before (the period ceiling
  does not apply). The bound lives **inside** the scheduling logic, so an overflowing task
  stays unplaced across every later cascade rather than being re-placed by an unrelated edit.
- **Overflow recovery:** When EDF can't place a task — no work-hours slot before its deadline,
  **or** no work-hours slot left inside its viewed period — it comes back unplaced
  (`scheduledStartTime: null`, `conflict: true`) and the API offers two pure-computed escape
  hatches alongside the create response (`overflow`), both computed relative to the task's
  **anchor period** (not `now`): **(1) schedule outside working hours** — the earliest grid
  slot **inside** the viewed period, ignoring the work window but still respecting occupied
  intervals and any deadline; and **(2) schedule the next available period** — the earliest
  work-hours slot in the **next** day/week/month (per the active view), this time ignoring the
  deadline. Both are recomputed server-side (period-aware, from the stored anchor + view) when
  the user accepts one, then the task is pinned as a fixed anchor
  (`PATCH /tasks/:id/resolve-overflow`). Each option is still deadline-aware telemetry: the
  override is recorded as a MOVE event.
- **Data Foundation:** Implement the `task_events` audit table in PostgreSQL. Multi-tag
  flexibility is modelled as a per-user `Tag` relation (implicit many-to-many, with
  `@@unique([userId, name])`) rather than a native `text[]` column — the relation dedupes tag
  names per user and is the better long-term shape for Phase 2's per-tag aggregation, at the
  cost of one join. Each event snapshot still records the task's tag **names at event time**
  (captured per-event, since a task's tags can change later). **Telemetry is complete from
  day one**: every event records the slot the engine *suggested*, the slot the user *chose*,
  the task's tags and estimated duration, and the eventual outcome
  (`completed`/`rescheduled`/`abandoned`). This counterfactual pair — *suggested* vs. *chosen*
  — is what makes offline evaluation possible later.

---

## Phase 2: Heuristic & Rule-Based Adaptation

**Goal:** Introduce immediate personalization using hardcoded statistical rules and rolling
averages to make the engine feel inherently "smart" with zero machine-learning overhead. All
of this re-ranks within EDF's feasible set; none of it overrides a deadline.

### Technical Focus

- **Multi-Tag Duration Correction (Bias Blending).**
  *Problem it solves:* users systematically mis-estimate how long tasks take, and a task can
  carry several tags with different biases. *Intuition:* learn a per-tag multiplier from
  history, then blend the multipliers, trusting the better-evidenced tag more.

  A daily background cron job in NestJS computes each user's historical "estimation bias"
  *per tag* (actual ÷ estimated, a rolling average). Because a task can carry multiple tags,
  the engine resolves conflicting multipliers with a **sample-weighted blend**, not a raw max:

    $\text{bias} = \dfrac{\sum_{t \in \text{tags}} n_t \cdot b_t}{\sum_{t \in \text{tags}} n_t}$

    where $b_t$ is tag $t$'s bias and $n_t$ its sample count — so a well-evidenced `#admin`
    bias outweighs a one-sample `#finance` bias instead of either blindly winning. The
    corrected duration is rounded **up to the next 15-minute multiple** before feeding EDF.
    (A "protective" Max-Bias mode — always take the largest multiplier — is available as an
    opt-in for users who would rather over-reserve than run over; it is **not** the default,
    because applied to every multi-tagged task it systematically inflates the schedule and
    wastes reserved time.)

- **Signed Preference Matrix.**
  *Problem it solves:* we want to route tasks toward the time blocks a user actually likes.
  *Intuition:* keep a running tally per (weekday, time-block) — reward blocks the user keeps
  tasks in, penalize ones they drag tasks out of.

  Build one **7×96 matrix per user** (7 days × ninety-six 15-minute blocks — aligned to the
  slot grid, *not* downsampled to 30 minutes). Each cell accumulates a **signed** score:
  dragging a task *out* of a block decrements it; keeping or dragging *into* a block increments
  it. EDF's feasible slots are then re-ranked by cell score, routing tasks toward liked blocks
  and away from disliked ones. Empty cells sit at 0 (neutral) — distinct from a disliked cell
  (negative).

- **Softmax exploration + propensity logging (the logging policy).**
  *Problem it solves:* if we always picked the single top-scored slot, we'd only ever collect
  outcome data for that one slot, biasing what later phases can learn and breaking off-policy
  evaluation. *Intuition:* introduce a small, *known* amount of randomness into which slot we
  suggest, and record the probability of each choice.

  So the re-ranker does **not** pick the single highest-scored feasible slot by a deterministic
  argmax. A pure argmax (a) **biases the telemetry** later phases learn from — only one slot per
  context ever gets outcome data — and (b) makes **off-policy Inverse-Propensity-Scoring (IPS)**
  degenerate, because IPS needs a *stochastic* logging policy whose action probabilities are
  known. Instead the re-ranker is a **softmax / Boltzmann** sampler over the feasible cell
  scores at a tunable temperature `T`: `p_i ∝ exp(cellScore_i / T)`. It is implemented with the
  **Gumbel-top trick** — `logit_i = cellScore_i / T + gumbel`, take the argmax — so the chosen
  slot is a genuine softmax draw while the returned ordering is still a pure permutation of EDF's
  feasible set (deadline feasibility is never traded away). `T → 0` recovers the greedy argmax;
  larger `T` explores more. For each auto-placement we **persist the chosen slot's propensity**
  `π(chosen | feasible set) = exp(score_chosen/T) / Σ_j exp(score_j/T)` into the event snapshot,
  so the offline IPS/SNIPS replay (see [Evaluation](#evaluation)) can divide by the *true* logged
  probability rather than a hand-rolled floor. This is the prerequisite the roadmap requires
  before Phase 3's bandit can be evaluated honestly on historical logs.

  **Cold-start safety + stability.** When every feasible slot scores equally (an all-zero /
  neutral matrix — the common new-user case) there is no preference to act on, so the
  re-ranker returns EDF's earliest-fit order **unchanged** rather than randomly shuffling a
  fresh user's tasks; its propensity is uniform `1/n`. The Gumbel seed is derived from the
  **task id only** (never from `now`), so re-packing the same task on an unrelated cascade
  yields the same draw — no slot churn (this protects the *Time-to-stable* metric). Randomness
  enters the otherwise-pure core **only via an injected seed**, so the re-ranker stays a
  reproducible function of `(inputs + seed)` (see CLAUDE.md invariant #2).

- **Why no per-tag matrices yet:** Tag-conditioned placement multiplies the data requirement
  far past the "~1–2 weeks of single-user history" this phase targets, so the matrix stays
  **global per user** here (one matrix capturing *when* the user works, ignoring *what*).
  Tag-conditioned placement preferences are deferred to Phase 3, where they enter naturally as
  bandit *features* rather than as a sparse stack of matrices.

---

## Phase 3: Contextual Bandits

**Goal:** Transition from rigid heuristic rules to an algorithmic framework that balances
*exploring* new schedule distributions with *exploiting* known user habits in real time — still
choosing only among EDF-feasible slots.

*Why a bandit, and why now:* Phase 2's single global matrix can't say "this user likes
`#backend` in the morning but `#review` in the afternoon" — it knows *when*, not *when-for-what*.
A contextual bandit reads tags **and** time together as features, so it can learn those
interactions; it also keeps exploring instead of locking onto a possibly-stale habit.

### Technical Focus

- **The Framework:** Implement a **hybrid LinUCB** contextual bandit in a lightweight Python
  microservice (FastAPI) alongside the NestJS backend on the VPS. Hybrid (shared + per-arm
  weights) is chosen deliberately so new tags and rarely-used time blocks borrow shared
  structure instead of starting from zero — disjoint per-arm models would be far too sparse.

- **Arm space:** Arms are **not** raw 15-minute slots (hundreds of arms → hopeless sparsity).
  They are the **96 time-of-day blocks** reused from the Phase 2 matrix grid (or a coarser
  time-of-day binning if data is thin). The bandit ranks the *feasible* arms EDF returned.

- **Context = task features ⊕ arm features.** A LinUCB arm must be identifiable in the
  feature vector, so the candidate slot's own features are included — the Phase 2 vector
  described only the task and could not tell two slots apart. The assembled vector:

    $x_{t,a} = [\underbrace{\text{day\_of\_week}, \text{hours\_to\_deadline}, t_1 \dots t_n, \text{current\_day\_load}}_{\text{task context}}, \; \underbrace{\text{block\_of\_day}(a), \text{slot\_load}(a), \text{is\_after\_break}(a)}_{\text{arm features}}]$

    Tags $t_1 \dots t_n$ are a fixed-width **multi-hot vector** (e.g. 6 global tags →
    `[1,0,1,0,0,0]`), since linear models can't read text arrays.

- **Reward:** A blend of the day-one signals, not a single bit —
  $r = w_1 \cdot \text{accepted} + w_2 \cdot \text{completed in slot} - w_3 \cdot \text{moved away}$.
  Completion is weighted highest (it's the real outcome); placement acceptance is the fast,
  dense signal that arrives immediately. Updates are applied online as events arrive.

- **The Loop:**
    1. EDF returns the feasible arms; NestJS flattens the multi-tag + arm context per arm and
       passes the vectors to the bandit service.
    2. The bandit scores each feasible arm and returns the highest-UCB one.
    3. The user accepts (positive reward), overrides by dragging (negative), and ultimately
       completes/abandons (the strongest signal) — all of which update the weights.
- **Duration correction from Phase 2 remains** as preprocessing; the bandit only chooses
  *where*, never *how long*.

---

## Phase 4: Collaborative Archetypes & Cold Start

**Goal:** Eliminate the initial data-void for new users by leveraging aggregate behavioral
signatures across the entire user base.

*The problem:* a brand-new user has no history, so Phases 2–3 have nothing to personalize from.
*Intuition:* people cluster into recognizable types ("Night Owl"); find those clusters across
all users, then seed a newcomer from the cluster their onboarding role points to.

### Technical Focus

- **Factorize the right matrix.** Archetypes here are *temporal* ("Night Owl"), so the
  factorization is over the **(user × time-block-preference) matrix** — the aggregated Phase 2
  preference matrices across all users — **optionally conditioned on tags**, not over a raw
  tag co-occurrence matrix. Tag co-occurrence tells you *what work clusters*; it does not tell
  you *when* people do it, so it cannot by itself yield a temporal archetype. Tag context
  enters as a side feature (e.g. via LightFM's feature support) so "the `#dev`+`#ops` person
  who also works late" is expressible — but the *when* comes from the temporal matrix.

- **User Archetypes:** Identify behavioral profiles from the temporal factors (e.g. a
  late-shifted preference vector → "The Night Owl Developer"). Tag signatures label and refine
  clusters; they don't define the temporal shape.

- **Solving the Cold Start:** A brief onboarding survey maps the user's self-selected role to
  the nearest behavioral cluster. The system seeds their initial **hybrid LinUCB weights** and
  **signed preference matrix** with that cluster's baseline averages, so a brand-new user
  starts at the population prior instead of zero. Personal data then overrides the prior as it
  accumulates.

---

## Evaluation

Personalization is only worth shipping if it **measurably reduces the work the user has to do
to fix the schedule**. Every phase is gated on the same north-star and validated *offline
before it goes online*, which the Phase 1 audit log makes possible.

### North-star metric

**Manual Adjustment Rate (MAR)** — the fraction of suggested placements the user changes:

$\text{MAR} = \dfrac{\lvert\{\text{tasks moved or resized after suggestion}\}\rvert}{\lvert\{\text{tasks scheduled}\}\rvert}$

Lower is better. Phase 1's pure-EDF MAR is the **baseline**; each later phase must beat the
phase before it.

**Repeated edits to one task.** MAR is **per-task and binary**: a task counts in the numerator
if it was touched *at all* after the suggestion, whether the user moved it once or fifteen
times. Re-fiddling does not inflate MAR — that would conflate "the suggestion was wrong" with
"the user kept tuning," and MAR only answers the former. The *intensity* of re-editing is
owned by **Time-to-stable** below (it counts every edit per task), and the magnitude of the
final correction is owned by **Move distance**. So the three metrics partition the question
cleanly: MAR = *did we miss?*, Time-to-stable = *how much fiddling did the miss cost?*,
Move distance = *how far off were we?*. The raw per-event signals (every individual move/resize)
are always retained in the `task_events` log, so any phase can recompute a stricter
edit-weighted variant offline if needed.

### Supporting metrics

| Metric | Definition | Target direction |
|--------|------------|------------------|
| Slot acceptance rate | suggestions kept unchanged ÷ suggestions | ↑ |
| Move distance | median minutes between suggested and the **final** chosen slot (intermediate drags ignored) | ↓ |
| Duration error | median \|actual − suggested duration\| | ↓ (Phase 2 owns this) |
| Completion-in-slot | tasks completed in their suggested slot ÷ scheduled | ↑ (the real outcome) |
| Time-to-stable | **count of edits per task** before the user stops touching it (this is where repeated moves/resizes are captured) | ↓ |

### Offline evaluation (do this *before* any model goes live)

*Why offline first:* it lets us reject a bad model using only history, with zero risk to real
users. Because every event logs the **suggested slot, the chosen slot, the tags, the duration,
and the outcome**, a new model can be scored on historical data with no user exposure:

- **Replay / counterfactual estimation.** For each logged decision, run the candidate model
  on the same context and compare its choice to what the user actually did. Use
  **Inverse-Propensity-Scoring (IPS)** off-policy evaluation: a model that would have suggested
  the slot the user *kept* scores higher; one that suggests slots the user *moved away from*
  scores lower. This estimates the new policy's expected reward from old logs. Phase 3's
  bandit must clear the Phase 2 heuristic on replay before it's allowed online. **IPS requires
  the logging policy to be stochastic with known action probabilities** — which is exactly why
  Phase 2's placement re-ranker is a softmax sampler that **records the chosen slot's
  propensity** on each auto-placement event (see §Phase 2 §Signed Preference Matrix). The
  importance weight is `w = π_candidate(chosen | x) / π_logging(chosen | x)`; both propensities
  are each policy's closed-form softmax first-choice marginal (uniform `1/n` for the identity
  baseline), with a small floor on the denominator to keep the estimator well-defined.
- **Duration backtest (Phase 2).** Recompute the bias-corrected duration for every historical
  task and measure the reduction in \|actual − corrected\| versus \|actual − original
  estimate\|. Ship the correction only if the error drops.
- **Cold-start backtest (Phase 4).** Hold out each user's first *N* days, seed them from their
  archetype, and check the archetype-seeded MAR over those days beats the cold (zero-prior)
  MAR. This proves the seeding helps before exposing real new users to it.

### Online evaluation

- **A/B test** each phase against the previous one (randomized by user). The new phase ships
  only if it **lowers MAR with statistical significance** and does not regress
  completion-in-slot.
- **Guardrail:** because the bandit *explores*, cap exploration so MAR never rises above the
  prior phase's baseline for any cohort. If a cohort's MAR regresses, fall back to the
  previous phase's re-ranker.

## Roadmap Summary

| **Phase** | **Core Scheduling Mechanism** | **Complexity** | **Data Required** | **Ships only if…** |
| --- | --- | --- | --- | --- |
| **Phase 1** | Pure Heuristic (EDF Sorting) | Low | None (Baseline) | establishes MAR baseline |
| **Phase 2** | EDF + sample-weighted bias + signed preference matrix | Medium-Low | ~1–2 weeks single-user history | beats P1 MAR on replay + duration backtest |
| **Phase 3** | EDF-feasible hybrid LinUCB bandit | Medium-High | ~1 month single-user history | beats P2 reward on IPS replay, then A/B |
| **Phase 4** | Bandit + collaborative cold-start seeding | High | Multi-user aggregate data | archetype-seeded cold-start MAR < cold MAR |