# Zenflow Simulation Strategy

> **What this doc is:** the plan for generating *synthetic* user data to test Zenflow's
> personalization roadmap ([`docs/heuristic.md`](heuristic.md) Phases 2–4) when the real
> 3-person pilot is too small to learn from. It defines **what to simulate** — personas,
> tasks, and behavior — over a **~1-year** time series, and how that data validates each
> phase without falling into the circularity trap.
> **Who should read it:** the ML engineer building or evaluating the learners. Read
> [`docs/heuristic.md`](heuristic.md) first — this doc assumes its phases, metrics (MAR), and
> terms (EDF, re-ranker, preference matrix, LinUCB, IPS) are already understood. The
> step-by-step promotion procedure lives in [`docs/phase-2-evaluation-steps.md`](phase-2-evaluation-steps.md).

---

## 0. Concepts & terminology (this doc's own jargon)

[`docs/heuristic.md`](heuristic.md) defines the shared ML terms (EDF, re-ranker, preference
matrix, bandit, LinUCB, IPS/SNIPS, MAR). The terms below are specific to *this* simulation
doc. Each is defined before its first use.

| Term | Plain definition | Why it's here |
|------|------------------|---------------|
| **Generator** | The synthetic data-producing process: it invents users, their hidden tastes, their tasks, and how they react. | The "world" the learners live in. We control it, so we know the ground truth. |
| **Learner** | Any model a phase trains (the Phase-2 heuristic, the Phase-3 bandit, the Phase-4 factorizer). | It only sees the telemetry log, never the generator's hidden parameters. |
| **Generator ⊋ learner (the cardinal rule)** | The generator must be *strictly richer* than any learner — it embeds drivers no learner can observe. | Stops the result being a tautology ("I recovered exactly what I injected"). |
| **Archetype** | A *cluster* of users defined by distributions over hidden traits (e.g. "Night Owl"). The ground-truth label Phase 4 must recover. | The population is built from 5 of these. |
| **Persona** | One *individual* user — a single random draw from an archetype, plus personal jitter. | Members of an archetype share traits but are never identical; that variance is what makes the problem non-trivial. |
| **Latent / hidden field** | A persona's true, unobservable preferences (e.g. `P_global`, `P_tag`). | Learners must *recover* these from behavior alone; we grade them against the truth. |
| **`P_global(day, block)`** | A persona's smooth preference for each (weekday, time-block), ignoring tags. | The ground truth the Phase-2 preference matrix approximates. |
| **`P_tag(tag, block)`** | Per-tag deviations from `P_global` — e.g. likes `#backend` mornings specifically. | The interaction only Phase 3 can exploit; the reason Phase 3 can beat Phase 2. |
| **Drift** | Slow change in a persona's preferences/skill across the year (non-stationarity). | Tests whether a learner keeps up as the user changes. |
| **Noise floor `ε`** | Probability a persona acts randomly / out of character on any decision. | No real user is perfectly consistent; this sets a *floor* MAR no learner can beat. |
| **Feasibility wall** | A persona can only react within EDF's feasible set — it can't move to a slot EDF never offered. | Forces some "legitimate" manual moves that no learner can remove. |
| **Duration bias `b_tag`** | Per-tag multiplier (actual ÷ estimated) the persona's true durations follow. | The ground truth Phase 2's duration corrector must learn. |
| **Edit propensity `π_edit`** | Probability the persona acts on a mismatch (moves/resizes) rather than letting it ride. | Controls how dense the edit signal is. |
| **Fatigue / sequence effect** | Reaction to a task depends on recent load, not just the task itself. | A hidden driver that makes reschedules cluster realistically. |
| **Procrastination `ρ`** | A weight pulling a persona's preferred slots toward the deadline. | Lets "deadline-crammer" behavior emerge. |
| **Calibration** | Fitting the generator's *parameter ranges* to the real 3-person pilot. | Keeps the synthetic distributions honest rather than invented. |
| **Anti-circularity / ablation** | Re-running with the mechanism a phase exploits *turned off* in the generator. | If the phase still "wins," the gain was fake. The strongest sanity check. |
| **ARI / purity** | Two scores for how well recovered clusters match the true archetype labels. | Phase 4's cluster-recovery metrics (higher = better). |
| **IPS / SNIPS** | Off-policy estimators (defined in [`heuristic.md`](heuristic.md)) that score a new policy from an old log. | The cheap offline pre-filter in §13. |
| **Paired design** | Run *each persona twice* — once per policy — sharing the same seeds, differing only in the re-ranker. | Cancels persona/seed variance so small true effects are detectable. |

---

## 1. Purpose & framing

A real pilot (3 users × a few weeks) cannot produce the data volume Phase 2 needs,
the ~1-month-per-user history Phase 3 needs, or the multi-user spread Phase 4 needs.
So Phases 2–4 are evaluated as a **simulation study**: a population of synthetic
users with hidden "true" preferences react to the scheduler's suggestions, and the
learners must recover signal from the resulting telemetry.

What this study legitimately proves:

1. **Engineering correctness** — telemetry → learner → re-ranker loop runs end-to-end.
2. **Sample complexity** — how much history each phase needs before MAR drops.
3. **Robustness / sensitivity** — degradation as signal-to-noise falls or users drift.
4. **Ablations** — relative comparisons (sample-weighted blend vs. max-bias; hybrid
   vs. disjoint LinUCB; archetype-seeded vs. cold cold-start) where the generator's
   structure cancels across the compared methods.

Online A/B testing on real users is explicitly **future work**.

### 1.1 The cardinal rule: generator ⊋ learner

*Intuition:* if you test a model on data produced by that same model, it will of course
"win" — you only proved your code can recover its own assumptions. To avoid that, the
fake world must be harder than any single learner.

The single thing that makes this defensible: **the data-generating process must be
strictly richer than any model that learns from it.** If the simulator generates
behavior from exactly the model a phase recovers, the result is tautological ("my
code recovered what I injected"). Concretely, the generator embeds drivers **no
learner can observe**:

- **tag × time-of-day interaction preferences** (not just a global time preference),
- **slow preference drift** across the year (non-stationarity),
- **hidden busy/“meeting” blocks** and **fatigue state** (recent-load dependence),
- an **irreducible noise floor** of out-of-character actions,
- **life events** (vacations, sick days, deadline crunches) that distort volume.

Learners only ever see the `task_events` log (`TaskEvent` rows) — never the latent
parameters. Recovery from this messier world is a real, bounded finding.

---

## 2. The closed loop (how data is produced)

Data is **not** fabricated as static rows. Each simulated reaction is applied
**through `SchedulerService`** so the real telemetry path runs: `TaskEvent` rows,
`suggestedStartTime` snapshots, tags-at-event-time, and signed `preferenceMatrix`
updates are produced exactly as in production.

Per simulated **day**, per **persona**:

1. **Task arrival** — the persona's task-generating process emits 0…N tasks
   (tags, *estimated* duration, optional deadline, active `view`).
2. **Suggestion** — `scheduler.service` create path runs EDF; `feasibleSlots`
   (`backend/src/scheduler/edf.ts`) enumerates the feasible set and the active
   `SlotReRanker` (`reranker.ts`) picks a suggested slot.
3. **Reaction** — the persona evaluates the suggestion against its hidden preference
   field and reacts **within the feasible set only** (keep / move-toward / resize),
   probabilistically (§5).
4. **Outcome** — at the task's scheduled time the persona realizes an outcome
   (complete-in-slot / reschedule / abandon) per its discipline.
5. **Clock advances** — a virtual `now` (passed explicitly into every pure-core
   call, per CLAUDE.md invariant #2) moves to the next step.

**Feasibility is a hard wall.** A persona can never move to its preferred block if
EDF didn't offer it (tight deadline, occupied slot) — it accepts a sub-optimal slot,
exactly like a real user. Consequence: a perfect learner can only push MAR down to
the persona's **noise floor + feasibility-forced-moves**, never to zero. *"We reached
the simulated noise floor"* is the target claim, not *"MAR went to 0"*.

---

## 3. Time model (~1 year)

| Aspect | Spec |
|--------|------|
| Span | ~365 days (≈52 ISO weeks). Start date is passed in via `args` (the runtime forbids `Date.now()`/`new Date()` so the series is deterministic & reproducible). |
| Warmup | First ~2 weeks: lighter volume, learners idle (collecting baseline). Establishes the Phase-1 / cold MAR baseline. |
| Steady state | Weeks 3–48: full volume; the regime where Phase 2/3 learning is measured. A full year gives each phase well past its data threshold (Phase 2 ~1–2 weeks, Phase 3 ~1 month) and room for the long-horizon sample-complexity sweeps. |
| Tail | Final ~4 weeks held out per-user as the **cold-start backtest** window for Phase 4 (§10.2). |
| Seasonality | A full year admits an optional yearly cycle (e.g. a quieter mid-year holiday stretch, busier quarter-ends) layered on the 2-week sprint cadence — extra non-stationarity for the learners, and a more honest volume profile. |
| Weekday rhythm | Volume varies by ISO weekday (Mon/Tue heavier, Fri lighter); weekends near-zero except for personas with weekend-work propensity. |
| Sprint/cycle rhythm | A 2-week cadence: task volume and deadline density spike near cycle ends (deadline-crammer effect, §4). |
| Drift | Each persona's preference field and estimation skill drift slowly over the span (§4.3) — tests learner non-stationarity. |
| Life events | Per persona: 1–2 vacations (5–10 contiguous idle days), occasional sick days, public holidays (population-wide idle). Creates realistic gaps, not a clean grid. |

All calendar reasoning is in each persona's IANA timezone; durations stay positive
multiples of 15 and slots align to the 15-minute grid (CLAUDE.md invariant #3).

---

## 4. Personas

### 4.1 Two-level hierarchy

- **Archetype (cluster)** = *distributions* over latent parameters. The ground-truth
  label Phase 4 must recover.
- **Persona (individual)** = a *draw* from one archetype's distributions, with
  personal jitter. **Members of an archetype share traits but are never identical** —
  this intra-cluster variance is load-bearing: Phase 2 generalization and Phase 4
  factorization are only non-trivial if members differ.

Recommended population: **5 archetypes × ~8–12 personas = ~40–60 synthetic users.**
Enough per-cluster mass for stable factorization, enough clusters for the discovery
to be non-trivial. Cluster sizes are deliberately **unequal** (real populations are).

### 4.2 The five archetypes

Each is defined by a distinct **temporal signature** (the *when*, what Phase 4
factorizes) and a **tag signature** (the *what*, a side feature). Numbers below are
distribution centers; per-persona values are sampled around them.

| # | Archetype | Work window (tz) | Temporal preference (the hidden field) | Dominant tags | Duration bias (actual÷est) | Edit propensity | Completion discipline | Noise floor |
|---|-----------|------------------|----------------------------------------|---------------|----------------------------|-----------------|-----------------------|-------------|
| **A** | Steady 9–5 Developer | 09:00–17:00, Mon–Fri | Strong **morning** deep-work peak (09:30–12:00); dislikes post-lunch dip | `#backend`,`#bugfix`,`#review` | underestimates: ~**1.25–1.4×** on `#backend`/`#bugfix` | medium | high complete-in-slot (~0.8) | low (~0.10) |
| **B** | Night-Owl Builder | 12:00–20:00 (some wrap past midnight), Mon–Fri + occasional Sun | Strong **late-afternoon/evening** peak (16:00–20:00); mornings disliked | `#frontend`,`#design`,`#sidequest` | mild under ~**1.1–1.2×** | medium-high | medium (~0.7) | medium (~0.15) |
| **C** | Interrupt-driven Ops/SRE | 08:00–18:00, Mon–Fri + on-call weekends | **Fragmented**: keeps mornings reactive (low preference), prefers short focus blocks midday; many short tasks | `#incident`,`#ops`,`#oncall`,`#review` | near-unbiased but **high variance** (σ large) | **high** (reactive, lots of moves) | low complete-in-slot, **high reschedule** (~0.4) | **high** (~0.25) |
| **D** | Meeting-heavy PM | 09:00–18:00, Mon–Fri | Prefers focus work **early (08:00–09:30) or late (16:30–18:00)**, around a dense midday meeting band | `#planning`,`#1on1`,`#review`,`#writing` | **overestimates** ~**0.8–0.9×** (optimistic blocking) | medium | medium; **many fixed blocks** | medium (~0.15) |
| **E** | Deadline-crammer Student/Researcher | flexible 10:00–22:00, Mon–Sun | **Procrastinates**: prefers slots **close to the deadline**; strong evening peak; bursty | `#writing`,`#reading`,`#analysis` | **large underestimate** ~**1.4–1.8×** on `#writing` | low-medium (lets EDF ride until crunch) | bursty: high abandon early, high complete near deadline | medium-high (~0.2) |

> **Critical for Phase 3:** several archetypes carry **tag × time interactions**, not
> just a global time preference — e.g. A prefers `#backend` in the morning but tolerates
> `#review` in the afternoon; D prefers `#writing` early but `#1on1` midday. A single
> global 7×96 matrix (Phase 2) *cannot* represent this; the LinUCB context vector
> (tags ⊕ block-of-day) *can*. **This interaction is the only reason Phase 3 can beat
> Phase 2 on replay** — so it must be present in the generator, and it must be a
> distinct latent layer from the global field.

### 4.3 Per-persona latent parameters (sampled from the archetype)

The persona factory draws these once (seeded, reproducible) and seeds the `User` row
(`workStart`/`workEnd`/`workDays`/`timezone`) + the persona's `Tag` set:

- **Work window** — archetype center ± jitter; `workDays` may add/drop a day.
- **Timezone** — small spread across a couple of zones (exercises the tz path).
- **Global temporal field** `P_global(day, block)` — a smooth function (sum of
  Gaussian bumps at the archetype's peak times) over the 7×96 grid; the ground truth
  the Phase-2 `preferenceMatrix` approximates.
- **Tag×time field** `P_tag(tag, block)` — per-dominant-tag deviations from the global
  field; the ground truth only Phase 3 can exploit.
- **Per-tag duration bias** `b_tag` — lognormal around the archetype center, with a
  per-tag sample-noise σ applied per task.
- **Edit propensity** `π_edit` — P(act on a mismatch).
- **Move threshold** `θ` — minimum preference gap before a move is worth it.
- **Completion discipline** — `(p_complete, p_reschedule, p_abandon)` simplex.
- **Noise floor** `ε` — P(random / out-of-character action).
- **Procrastination** `ρ` — weight pulling preferred slots toward the deadline.
- **Fixed-load rate** `λ_fixed` — meetings/busy blocks per week (high for D, on-call
  spikes for C).
- **Drift vectors** — slow per-month deltas applied to `P_global` and `b_tag` (e.g. E's
  estimation improves; A gradually shifts earlier). Non-stationarity for the learner.

---

## 5. Behavior model (the reaction policy)

*What this section does:* it defines exactly how a persona reacts to a suggestion. This is
the engine that turns hidden preferences into the `MOVE`/`KEEP`/`RESIZE`/`COMPLETE` events the
learners see.

Two **independent** signal channels — never conflate them (placement vs. duration); a third
subsection (§5.3) covers the eventual outcome.
<!-- TODO: verify — original text said "Two independent signal channels" but three channels
     are described below (5.1 placement, 5.2 duration, 5.3 outcome). -->


### 5.1 Placement channel → `MOVE` / `KEEP`

On suggestion `s` from EDF over feasible set `C`:

1. With prob `ε` (noise floor): take a random feasible slot (or keep) regardless of
   preference — injects irreducible MAR.
2. Else compute the persona's preferred feasible slot
   `c* = argmax_{c∈C} [ P_global(c) + P_tag(task.tags, c) − ρ·dist_to_deadline(c) ]`,
   perturbed by small Gaussian noise (humans aren't argmax machines).
3. If `pref(c*) − pref(s) > θ` **and** `c* ≠ s` **and** `rand() < π_edit`:
   → **drag to `c*`** (a `MOVE`; `scheduler.service.pin` records the event +
   signed matrix deltas: −1 vacated, +1 destination).
4. Else → **KEEP** (when later completed in-slot, `recordKeep` emits the `KEEP`
   event + a +1 matrix delta).

Feasibility wall: `c*` is chosen from `C` only, so a tight-deadline task forces
acceptance of a non-preferred slot — a *legitimate* MAR contribution the learner
cannot remove.

### 5.2 Duration channel → `RESIZE`

- Persona **estimates** `est` (drawn from a per-tag distribution, rounded to 15).
- The task's **true** duration is `true = round15(est × b_tag × lognoise)`.
- With prob `π_edit`, when the mismatch `|true − est|` exceeds one slot, the persona
  **resizes** the block to `true` (`scheduler.service.resize` → `RESIZE` event whose
  snapshot carries the suggested vs. chosen duration). This is the signal Phase 2's
  per-tag bias corrector learns from.

### 5.3 Outcome channel → `COMPLETE` / `MOVE(reschedule)` / `ABANDON`

At the scheduled time, draw from `(p_complete, p_reschedule, p_abandon)`, modulated by:

- **Fatigue**: after a long/back-to-back block, raise `p_reschedule` for the next task.
- **Deadline pressure**: as the deadline nears, `p_complete` rises (E crams).
- **Feasibility**: an abandoned task whose deadline passed while PENDING is the
  `ABANDON` outcome (mirrors the production overdue sweep).

### 5.4 Task dependencies / ordering constraints

20–40 % of tasks carry a `project_id` and an optional list of `prerequisite_task_ids`.
A dependent task is infeasible until all prerequisites reach `COMPLETE`; EDF treats it
as a hard constraint (no slot offered until unblocked).

Why it matters: without this, some `MOVE` events attributed to "time preference" are
actually ordering violations — the user moves the task because it was scheduled before
its prerequisite, not because the time-of-day was wrong. This inflates MAR in a way
no preference learner can fix, so it must be modelled as a distinct cause. Archetype A
(developer) and D (PM) have the highest project density; archetype C (ops/SRE) has
mostly independent reactive tasks.

### 5.5 Energy / cognitive load state

A latent `energy_t ∈ [0, 1]` per persona, updated each simulated step:

- **Depletion**: each meeting block or long task subtracts from energy, scaled by
  duration. Context-switch cost (back-to-back different-tag tasks) adds a penalty.
- **Recovery**: partial overnight reset toward a persona-specific baseline; short
  breaks restore a fraction mid-day.

Effect on behavior: `p_complete` is scaled by `energy_t` (low energy → more
reschedules). The effective preference used in §5.1 is modulated:
`pref_eff = pGlobal + P_tag − ρ·deadline + β·energy_t`, where `β` is a
persona-level sensitivity weight. Archetype C (Ops/SRE) has a high `β`; Archetype A
(Developer) moderate.

This accounts for moves caused by fatigue or context overload that have nothing to do
with time-of-day preference, providing a more honest noise floor.

### 5.6 Task urgency drift

Each task has a latent `urgency_t` that can change after creation. On each simulated
step, with a small persona-specific probability, a pending task receives an urgency
spike (e.g. a random external trigger such as a stakeholder request). When `urgency_t`
exceeds a threshold the persona may pull the task forward regardless of the
re-ranker's suggestion.

The resulting `MOVE` is tagged with cause `urgency_shift` in the sidecar. This lets
the evaluation decompose:
- **MAR_avoidable** — the re-ranker placed the task in a slot the persona dislikes.
- **MAR_unavoidable** — urgency spike, emergency, feasibility-forced move; not the
  scheduler's fault.

Phase 2 is graded on MAR_avoidable. See §12.

### 5.7 Task splitting behavior

Long tasks (true duration > a persona-specific threshold — typically 90 min for A/D,
60 min for E) may be **split** across sessions. On the scheduled slot, the persona
works a partial duration `d_partial < true`, emits a `RESIZE` down to `d_partial`,
and re-queues a remainder task for a future slot. The total planned duration is
preserved across the split.

Archetype E (crammer) has a high split rate; Archetype A (deep-work developer) prefers
uninterrupted blocks and splits rarely. Without this mechanism the simulator
over-estimates the need for long contiguous blocks, which distorts duration-error
metrics and completion rates for writing/research tasks.

---

## 6. Realism & noise checklist

The series must look like real users, not a clean generator. Required mechanisms:

- [ ] **Noise floor** `ε` of random actions per persona (no one is perfectly consistent).
- [ ] **Argmax jitter** — preferred-slot choice is softmax/Gaussian-perturbed, not exact.
- [ ] **Heteroscedastic durations** — duration noise σ varies by tag and persona (C high).
- [ ] **Bursty arrivals** — over-dispersed (negative-binomial) daily counts, with
      deadline-driven spikes, not uniform Poisson.
- [ ] **Idle gaps** — vacations, sick days, holidays → contiguous zero-activity stretches.
- [ ] **Fixed/busy blocks** — meetings (esp. D) and on-call (C) occupy time the persona
      didn't choose, shaping which slots are even feasible.
- [ ] **Drift** — preferences and estimation skill change slowly over the year.
- [ ] **Fatigue / sequence effects** — reaction depends on recent load, not just the task.
- [ ] **Mixed deadline use** — only a fraction of tasks carry explicit deadlines; the
      rest rely on period-bounded placement (`view`), per persona.
- [ ] **View mix** — day/week/month weighting differs by persona (E plans in weeks; C in days).
- [ ] **Task dependency DAGs** — 20–40 % of tasks carry a `project_id` +
      `prerequisite_task_ids`; a task is blocked until all prerequisites complete (§5.4).
      Ordering violations are a distinct MAR source, not attributable to time preference.
- [ ] **Energy / cognitive load state** — latent `energy_t ∈ [0,1]` per persona;
      depletes with meetings and long tasks, recovers overnight; modifies `p_complete`
      and effective slot preference (§5.5).
- [ ] **Task urgency drift** — latent `urgency_t` can spike post-creation; urgency-driven
      moves are tagged `urgency_shift` in the sidecar to support MAR decomposition (§5.6).
- [ ] **Task splitting** — long tasks may be split across sessions; remainder re-queued,
      preserving total planned duration (§5.7).

### Medium-value / Phase 3 nice-to-have

These improve credibility but are unlikely to change Phase 2 pass/fail conclusions.
Defer unless Phase 3 evaluation demands them.

- [ ] **Dynamic calendar fragmentation** — exogenous meetings added mid-span beyond the
      initial fixed-block rate; especially realistic for archetype D (PM).
- [ ] **Habit formation** — `π_edit(t)` that increases as past scheduler accuracy builds
      trust; creates a feedback loop between suggestion quality and edit density.
- [ ] **Structured seasonal events** — punctuated regime shifts (exam crunch, product
      launch, burnout stretch) rather than purely gradual drift.

All randomness flows from a **single seeded PRNG** (e.g. mulberry32) keyed by persona
index + step, so any run is byte-reproducible (no `Math.random`).

---

## 7. Task generation detail

Per arrival:

- **Count/day**: over-dispersed draw scaled by weekday + cycle phase + persona volume.
- **Tags**: 1–3 sampled from the persona's weighted tag mix (dominant tags favored;
  occasional off-profile tag for realism). Written via the implicit M2M `Tag` relation.
- **Estimated duration**: per-tag distribution, rounded up to a 15-min multiple
  (15–240 min typical; C skews short, E skews long).
- **Deadline**: present with persona-specific probability; horizon sampled (tight for
  C/E near cycle ends, loose for A). Absent ⇒ period-bounded by `view`.
- **View**: sampled from the persona's day/week/month weights.
- **Project / dependency**: 20–40 % of tasks carry a `project_id` and optional
  `prerequisite_task_ids`. Prerequisite tasks must reach `COMPLETE` before a dependent
  task is schedulable; EDF treats them as infeasible until unblocked (§5.4).
- **Title/note**: templated from tag (cosmetic; not learned).

---

## 8. Mapping to Phase 2

**Learns:** per-tag duration bias (sample-weighted blend) + global signed
preference matrix. **Needs:** ~1–2 weeks/user — abundant in a year.

- **Duration backtest** — recompute bias-corrected duration for every historical task;
  ship only if `mean|true − corrected| < mean|true − est|`. The §5.2 channel provides
  the ground-truth `true` durations to score against.
- **Placement** — the signed matrix should converge toward each persona's
  `P_global`. Measure recovery error `‖matrix_normalized − P_global‖` (possible only
  because we know ground truth) **and** the downstream MAR drop.
- **Ablation** — sample-weighted blend vs. max-bias on multi-tagged tasks: the blend
  should avoid the schedule inflation max-bias causes (heuristic §Phase 2). C/E with
  high-variance tags are the discriminating personas.

**Anti-circularity:** the matrix is *global per persona*, but the generator also has
`P_tag` interactions and drift it can't represent — so Phase 2 leaves residual MAR
that Phase 3 must then close. That residual is the proof Phase 2 isn't the whole story.

---

## 9. Mapping to Phase 3 (Contextual Bandit — plan)

**Learns:** hybrid LinUCB re-ranker over the 96 block-of-day arms.
**Needs:** ~1 month/user. **Beats Phase 2 only because of `P_tag` interactions** (§4.2).

### 9.1 What the simulator must feed

The context vector the heuristic specifies (`docs/heuristic.md` Phase 3):
`x_{t,a} = [day_of_week, hours_to_deadline, tags(multi-hot), current_day_load |
block_of_day(a), slot_load(a), is_after_break(a)]`. Every field is derivable from the
simulated task + the EDF-feasible candidate slot, so no schema change is needed — the
flattener reads task features + candidate-slot features at suggestion time.

### 9.2 Reward (matches heuristic)

`r = w1·accepted + w2·completed_in_slot − w3·moved_away`, applied online as the §5.3
outcomes arrive. Because the simulator's reward driver (`P_global + P_tag − ρ·deadline
+ fatigue`) is **richer** than the bandit's linear model, convergence is a real
result, not built-in.

### 9.3 Evaluation

- **IPS off-policy replay** — score the bandit on the logged decisions; it must clear
  the Phase-2 heuristic's estimated reward **before going online** (heuristic §Offline
  evaluation). The logged `suggested` vs. `chosen` pair makes this possible.
- **Exploration guardrail** — in simulation, sweep exploration α and confirm MAR never
  rises above the Phase-2 baseline for any persona cohort.
- **The decisive test** — Phase 3 should beat Phase 2 **specifically on personas with
  strong `P_tag` interaction** (A, D) and tie elsewhere. If it beats Phase 2 *even
  with interactions disabled in the generator*, that's a red flag the gain is artifactual.

---

## 10. Mapping to Phase 4 (Archetypes & Cold Start — plan)

**Learns:** temporal archetypes by factorizing the (user × time-block-preference)
matrix — the aggregated Phase-2 matrices across all personas — optionally tag-conditioned.
**Needs:** the multi-user population (§4.1).

### 10.1 What the population must provide

- **≥5 distinct temporal signatures** with **unequal cluster sizes** and real
  intra-cluster variance, so factorization is non-trivial and cluster recovery is
  measurable against the known archetype labels.
- **Tag signatures** that *refine but do not define* clusters (B and E both evening-
  peaked but differ by tags) — tests that the temporal axis drives the archetype and
  tags enter as a side feature (LightFM-style), per heuristic §Phase 4.

### 10.2 Evaluation

- **Cluster recovery** — does the factorization's cluster assignment match the
  ground-truth archetype labels (ARI / purity)? Known only because the sim assigns labels.
- **Cold-start backtest** (heuristic §Offline) — hold out each persona's final ~4-week
  tail (§3); seed their `roleArchetypeId` + initial `preferenceMatrix` + LinUCB weights
  from the cluster baseline; confirm **archetype-seeded MAR < cold (zero-prior) MAR**
  over the held-out window. This proves seeding helps before any real new user sees it.

### 10.3 Anti-circularity

The number of clusters must be **discovered/validated**, not hardcoded to 5 — report
how well the recovered k matches. Because members vary and tags cross-cut the temporal
axis, naive recovery is genuinely non-trivial.

---

## 11. Calibration from the real pilot

The 3-person pilot does **not** provide volume; it **calibrates the generator's
parameters** so distributions aren't invented:

- Fit **duration-error spread** (per-tag CV of `actual/estimated`) from pilot RESIZE
  events → sets `b_tag` noise σ.
- Fit **edit frequency** (`MOVE`+`RESIZE` per task) → sets `π_edit` ranges.
- Fit **completion/abandon rates** → sets the discipline simplex centers.
- Fit **arrival dispersion** (tasks/day variance) → sets the over-dispersion parameter.

**Face-validity check** (the credibility lever): synthetic summary stats (MAR,
edits/task, duration-error CV, arrivals/day) must fall **within the pilot's observed
ranges**. Where the pilot is too thin to fit a parameter, fall back to a **documented,
cited literature prior** and flag it as an assumption. Calibrated parameters live in a
`calibration.json` the persona/archetype definitions load.

---

## 12. Evaluation summary (north-star + supporting)

All metrics computed from the generated `task_events` log (definitions in
`docs/heuristic.md` §Evaluation):

| Metric | Role |
|--------|------|
| **MAR** (Manual Adjustment Rate) | north-star; split into **MAR_avoidable** (scheduler placed the task in a slot the persona dislikes — scheduler's fault) and **MAR_unavoidable** (urgency spike, sudden external event, feasibility-forced move — not the scheduler's fault). Report both; phases are graded on MAR_avoidable. Total MAR = avoidable + unavoidable, each phase must beat the prior on avoidable MAR, down toward the persona noise floor. |
| Slot acceptance | ↑ keeps/suggestions |
| Move distance | ↓ minutes between suggested & final slot |
| Duration error | ↓ (Phase 2 owns) |
| Completion-in-slot | ↑ real-outcome proxy |
| Time-to-stable | ↓ edits/task |

Reported as **sweeps**, which is where simulation earns its keep:

- **Sample-complexity** — MAR vs. history length (days) per phase.
- **Sensitivity** — MAR vs. persona noise floor `ε` and vs. drift magnitude.
- **Ablation** — blend vs. max-bias; hybrid vs. disjoint; interactions on/off; seeded
  vs. cold cold-start.

---

## 13. Verifying that phase N+1 beats phase N

*The question this section answers:* "Is the new phase actually better, or did I just get
lucky / fool myself?" The short version: there is a **cheap test** (replay on an old log) and
an **expensive test** (re-run the whole simulation with the new policy live). A phase must pass
the cheap one first, then the expensive one, then a battery of sanity checks. The full
step-by-step procedure also lives in [`docs/phase-2-evaluation-steps.md`](phase-2-evaluation-steps.md).

This is the operationalization of the heuristic's "Ships only if…" gate
([`docs/heuristic.md`](heuristic.md) §Roadmap Summary). The core methodological point: there are
**two distinct evaluation regimes**, and a phase must pass the cheap one before the
expensive one.

> **Why two regimes?** A new re-ranker *changes the suggestions*, which *changes how
> the persona reacts*, which *changes the data*. So you cannot fully judge it by
> replaying a log collected under the old policy — that log contains reactions to the
> *old* suggestions. Replay is a cheap, conservative pre-filter; the honest proof is to
> **re-run the closed loop** with the new policy live. Only a simulator can do the
> latter without exposing real users — that is its single biggest advantage.

### Step 0 — Freeze the substrate
Hold everything constant except the re-ranker under test: same persona population, same
PRNG seeds, same calendar/arrival stream. Any metric difference is then attributable to
the re-ranker alone.

### Step 1 — Offline gate (counterfactual replay on a fixed log)
Cheap pre-filter; run **before** promoting a policy.
1. Take the `task_events` log collected under the incumbent (phase N).
2. For each logged decision, run the candidate (phase N+1) re-ranker on the **identical**
   context and record what it *would* have chosen.
3. Estimate the candidate's expected reward with an off-policy estimator
   (**IPS / SNIPS**, heuristic §Offline evaluation): it scores higher when it would have
   picked the slot the user *kept* and lower when it picks slots the user *moved away from*.
4. Phase-specific direct backtests on the same log:
   - **Phase 2:** duration backtest — `mean|true − corrected| < mean|true − est|`.
   - **Phase 3:** IPS reward must clear the Phase-2 heuristic.
5. **Gate:** fails here ⇒ do not promote. (Replay is conservative: passing is necessary,
   not sufficient.)

### Step 2 — Closed-loop A/B re-simulation (decisive)
Re-run the full ~1-year loop once per arm so each policy generates its **own** reactions.
- **Paired design (preferred):** run *each persona twice* — once under phase N, once under
  phase N+1 — sharing the same task-arrival + noise seed, differing only in the re-ranker.
  Pairing cancels persona/seed variance, so a small true effect is detectable.
- Recompute MAR + all supporting metrics (§12) per persona, per arm, from the regenerated
  logs.

### Step 3 — Statistical significance
- **Unit of analysis = persona**, never task (tasks within a persona are correlated —
  treating them as independent fakes significance).
- **Paired test** across personas on the per-persona MAR delta: Wilcoxon signed-rank
  (non-parametric) or paired *t*. Report **effect size** (Cliff's δ / Cohen's *d*) and a
  **95% CI**, not just a *p*-value.
- Repeat over **multiple population seeds** (e.g. 10–30 independently sampled populations)
  and report the distribution of the effect — one lucky population is not evidence.
- Pre-register MAR as the **primary endpoint** and α; the supporting metrics are
  secondary (multiple-comparison correction).

### Step 4 — Guardrails (a win that regresses these does not ship)
- **Completion-in-slot** must not drop significantly (the real-outcome proxy outranks MAR).
- **No cohort regresses:** no persona cluster's MAR may rise above the incumbent baseline
  (for the bandit, this caps exploration — heuristic §Online evaluation guardrail).
- **No schedule inflation:** total reserved time must not worsen (the Phase-2 blend-vs-
  max-bias check).

### Step 5 — Ground-truth recovery (the simulation-only luxury)
Because we *know* each persona's hidden parameters, verify the win comes from learning the
**right** thing, not luck:
- **Phase 2:** `‖matrix_normalized − P_global‖` ↓ and per-tag bias error `|b̂_tag − b_tag|` ↓.
- **Phase 3:** the policy's choices align with the `P_global + P_tag` argmax more than
  Phase 2's do.
- **Phase 4:** recovered clusters vs. true archetype labels (**ARI / purity** ↑).
- A MAR drop that is **not** accompanied by better recovery is a red flag — investigate
  before claiming improvement.

### Step 6 — Ablation / falsification (anti-circularity check)
Re-run the closed-loop A/B with the structure the new phase exploits **disabled in the
generator**:
- Phase 3: turn off `P_tag` time×tag interactions → Phase 3's edge over Phase 2 must
  collapse toward zero.
- Phase 4: make all archetypes identical → archetype-seeding must stop helping.

If phase N+1 still "wins" with its mechanism's signal removed, the gain is **artifactual**
(leakage, an unfair baseline, or a bug) — not real personalization. This is the test that
most directly answers an examiner's circularity challenge.

### Step 7 — Sensitivity (does the win generalize?)
The improvement must hold across the §12 sweeps — noise floor `ε`, drift magnitude, and
history length — not only at default settings. **Report where it breaks down** (e.g. very
high `ε` swamps the signal); a phase honest about its operating envelope is stronger than
one claiming universal wins.

### Promotion decision
Promote phase N+1 only when **all** hold: offline gate passed (Step 1), closed-loop MAR
improvement is statistically significant with a meaningful effect size (Steps 2–3), no
guardrail regression (Step 4), recovery improved (Step 5), the ablation confirms the
mechanism (Step 6), and the win survives the sensitivity sweeps (Step 7). Otherwise fall
back to the incumbent re-ranker for any regressing cohort.

---

## 14. Reproducibility & invariants

- **Determinism** — one seeded PRNG per persona; start date via `args`; no
  `Math.random()` / `Date.now()` (also required by the workflow runtime).
- **Grid invariants** — all durations positive multiples of 15; slots on the 15-min
  grid; `DAILY_HORIZON` respected (CLAUDE.md invariant #3).
- **Purity** — the EDF core stays pure; only `scheduler.service` writes Prisma +
  telemetry (CLAUDE.md invariant #2). The simulator drives the service, never bypasses it.
- **Isolation** — runs against a dedicated sim database (its own dotenv profile), never
  dev/prod.

---

## 15. Out of scope

- Frontend changes — the simulator is backend/service-level only.
- Production cold-start onboarding UI — Phase 4 evaluation is offline/backtest here.
- The Phase 2/3/4 **learner implementations** themselves — this document specifies the
  *data and evaluation substrate*; the learners slot into the existing `SlotReRanker`
  seam (`backend/src/scheduler/reranker.ts`) and are built separately (`ml-engineer`).

---

## 16. References & further reading

New to ML? **Start with the textbooks/surveys** in §16.1 — they're written to be read
cover-to-cover and cover most concepts below. The primary papers (§16.2 onward) are the
original sources to cite once a concept clicks. Each entry notes *why it's relevant here*.

### 16.1 Start here (textbooks & surveys)

- **Lattimore, T., & Szepesvári, C. (2020).** *Bandit Algorithms.* Cambridge University
  Press. Free PDF at `banditalgs.com`. — The reference for bandits (Phase 3). Read the
  early chapters on UCB before LinUCB.
- **Sutton, R. S., & Barto, A. G. (2018).** *Reinforcement Learning: An Introduction*
  (2nd ed.). MIT Press. Free online. — Foundations incl. off-policy evaluation (Phase 3 IPS).
- **Aggarwal, C. C. (2016).** *Recommender Systems: The Textbook.* Springer. — Collaborative
  filtering, matrix factorization, cold-start, evaluation (Phase 4) in one place.
- **Ricci, F., Rokach, L., & Shani, G. (eds.) (2022).** *Recommender Systems Handbook*
  (3rd ed.). Springer — esp. the chapter "Evaluating Recommender Systems."

### 16.2 Contextual bandits / LinUCB (Phase 3)

- **Li, L., Chu, W., Langford, J., & Schapire, R. E. (2010).** "A Contextual-Bandit Approach
  to Personalized News Article Recommendation." *WWW 2010.* — **The LinUCB paper**, including
  the hybrid (shared + per-arm) model the heuristic adopts.
- **Auer, P., Cesa-Bianchi, N., & Fischer, P. (2002).** "Finite-time Analysis of the
  Multiarmed Bandit Problem." *Machine Learning.* — UCB1; the explore/exploit intuition.
- **Chu, W., Li, L., Reyzin, L., & Schapire, R. (2011).** "Contextual Bandits with Linear
  Payoff Functions." *AISTATS.* — The regret theory underpinning LinUCB.
- **Chapelle, O., & Li, L. (2011).** "An Empirical Evaluation of Thompson Sampling."
  *NeurIPS.* — A common alternative exploration strategy, useful for comparison.

### 16.3 Off-policy / counterfactual evaluation (the offline replay gate, §13)

- **Dudík, M., Langford, J., & Li, L. (2011).** "Doubly Robust Policy Evaluation and
  Learning." *ICML.* — IPS and the more robust DR estimator.
- **Swaminathan, A., & Joachims, T. (2015).** "The Self-Normalized Estimator for
  Counterfactual Learning." *NeurIPS.* — **SNIPS**, the estimator named in §13.
- **Bottou, L., et al. (2013).** "Counterfactual Reasoning and Learning Systems." *JMLR.* —
  Why counterfactual estimation matters when a policy changes the data it sees.

### 16.4 Collaborative filtering, matrix factorization & cold-start (Phase 4)

- **Koren, Y., Bell, R., & Volinsky, C. (2009).** "Matrix Factorization Techniques for
  Recommender Systems." *IEEE Computer.* — The canonical MF intro (Netflix Prize).
- **Hu, Y., Koren, Y., & Volinsky, C. (2008).** "Collaborative Filtering for Implicit
  Feedback Datasets." *ICDM.* — Implicit feedback (Zenflow's keep/move signals are implicit).
- **Lee, D. D., & Seung, H. S. (1999).** "Learning the parts of objects by non-negative
  matrix factorization." *Nature.* — NMF, a natural fit for the non-negative temporal
  preference matrix.
- **Kula, M. (2015).** "Metadata Embeddings for User and Item Cold-start Recommendations."
  arXiv:1507.08439. — **LightFM**, the hybrid-with-side-features model the heuristic names
  for tag-conditioned archetypes.
- **Schein, A. I., Popescul, A., Ungar, L. H., & Pennock, D. M. (2002).** "Methods and
  Metrics for Cold-Start Recommendations." *SIGIR.*

### 16.5 Evaluation metrics & methodology

- **Herlocker, J. L., Konstan, J. A., Terveen, L. G., & Riedl, J. T. (2004).** "Evaluating
  Collaborative Filtering Recommender Systems." *ACM TOIS.*
- **Gunawardana, A., & Shani, G. (2009).** "A Survey of Accuracy Evaluation Metrics of
  Recommendation Tasks." *JMLR.* — Helps choose/justify the §12 metric set.

### 16.6 Statistical testing (significance & effect size, §13 Step 3)

- **Student [Gosset, W. S.] (1908).** "The Probable Error of a Mean." *Biometrika.* — Origin
  of the (paired) *t*-test.
- **Wilcoxon, F. (1945).** "Individual Comparisons by Ranking Methods." *Biometrics Bulletin.*
  — The **signed-rank test** (the non-parametric paired test recommended in §13).
- **Demšar, J. (2006).** "Statistical Comparisons of Classifiers over Multiple Data Sets."
  *JMLR.* — **Read this one** — a clear, practical guide to comparing ML methods statistically.
- **Benjamini, Y., & Hochberg, Y. (1995).** "Controlling the False Discovery Rate." *JRSS B.*
  — Multiple-comparison correction for the secondary metrics.
- **Cohen, J. (1988).** *Statistical Power Analysis for the Behavioral Sciences.* — Cohen's
  *d*, statistical power, sample sizing.
- **Cliff, N. (1993).** "Dominance statistics: Ordinal analyses to answer ordinal questions."
  *Psychological Bulletin.* — Cliff's δ, the non-parametric effect size paired with Wilcoxon.

### 16.7 Online controlled experiments (A/B, §13 Step 2)

- **Kohavi, R., Longbotham, R., Sommerfield, D., & Henne, R. M. (2009).** "Controlled
  experiments on the web: survey and practical guide." *Data Mining and Knowledge Discovery.*
- **Kohavi, R., Tang, D., & Xu, Y. (2020).** *Trustworthy Online Controlled Experiments.*
  Cambridge University Press. — The practical A/B testing bible.

### 16.8 Simulation for recommenders / bandits (the approach of this whole doc)

- **Ie, E., et al. (2019).** "RecSim: A Configurable Simulation Platform for Recommender
  Systems." arXiv:1909.04847. — Closest prior art to Zenflow's persona simulator; good
  precedent to cite for the methodology.
- **Rohde, D., et al. (2018).** "RecoGym: A Reinforcement Learning Environment for the
  problem of Product Recommendation in Online Advertising." arXiv:1808.00720.

### 16.9 Scheduling background (the EDF core)

- **Liu, C. L., & Layland, J. W. (1973).** "Scheduling Algorithms for Multiprogramming in a
  Hard-Real-Time Environment." *JACM.* — The origin of Earliest-Deadline-First.
