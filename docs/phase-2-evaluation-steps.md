# Phase 2 Evaluation — Step-by-Step Plan

> **What this doc is.** The operational checklist for proving **Phase 2 beats
> Phase 1** on the synthetic persona population: what each step tests, why, and the
> concrete commands to run. It specialises the general methodology in
> [simulation-strategy.md §13](simulation-strategy.md) to Phase 2. The *results* of
> running this plan live in
> [phase-2-evaluation-results.md](phase-2-evaluation-results.md); the tooling that
> implements it lives under `backend/src/simulation/eval/`.
>
> **Who should read it.** Anyone who has to *re-run* or *extend* the Phase-2 gate,
> or anyone reviewing whether the verdict was earned honestly. You do **not** need to
> have read the ML internals — this doc defines every term it uses before using it.
>
> **The one thing to take away first.** There are now **two ways to run this gate**:
> a cheap **fast path** that is the default and is statistically defensible on its
> own, and the **full protocol** you escalate to only when the fast path comes back
> *borderline*. The [fast-path vs full-protocol table](#fast-path-vs-full-protocol)
> below tells you which to run and what each lets you claim.

---

## Concepts & terminology

Read this once. Every non-obvious term used later is defined here: a plain
definition, the intuition (why it is needed), and — for metrics — how it is
measured.

**EDF (Earliest-Deadline-First).** The deterministic Phase-1 scheduler. It places
each task in the earliest feasible slot that still meets its deadline. It has no
personalization — it does not know *this* user hates mornings. Phase 2 adds a
personalization layer *on top of* EDF without replacing it.

**Re-ranker.** A hook that re-orders EDF's list of feasible slots before one is
chosen (the `SlotReRanker` seam in `scheduler/reranker.ts`). `identity` = the no-op
re-ranker (= pure Phase-1 EDF = our baseline). `phase2` = the personalized re-ranker
under evaluation.

**Arm.** One condition in an A/B comparison (a clinical-trial / bandit term).
**Arm A = `identity` = Phase 1**; **Arm B = `phase2`**.

**Paired design.** Every persona is run under *both* arms with the *same seed*, so we
compare a persona **to itself** (Arm A vs Arm B), not to some other persona. Why it
matters: persona-to-persona variance is huge (a crammer overrides far more than a
dev); pairing cancels that variance out, so a much smaller sample reaches
significance. This is the single biggest reason the fast path is viable at n = 50.

**Persona / archetype / cohort.** The simulator invents synthetic users.
An **archetype** is a *type* of user (5 of them: `dev`, `night_owl`, `ops`, `pm`,
`crammer`), each with hidden preferences. A **persona** is one concrete sampled user
from an archetype. A **cohort** = "all personas of one archetype".
`--personas-per-cohort=N` keeps the first N personas of *every* archetype, so no
cohort is ever dropped (a balanced shrink).

**MAR (Manual Adjustment Rate) — the north-star.** Fraction of scheduled tasks the
persona moved or resized after the suggestion. Per-task binary, **lower is better**.
A Phase-2 win looks like **MAR going down** (Arm B < Arm A). Measured from the
`TaskEvent` log as override-type events over total placements.

**Completion-in-slot.** Fraction of tasks the persona actually completed in the
suggested slot. **Higher is better.** A complementary, real-outcome positive signal
that outranks MAR as a guardrail.

**Offline replay (vs closed-loop).** *Offline* = estimate how a new policy *would
have* done using a log collected under the **old** policy, with **no
re-simulation** — cheap, but conservative. *Closed-loop* = run a **fresh** simulation
per arm where the personas actually react to each arm's suggestions, so each policy
generates its own data — expensive, but the honest test. Why both: a new re-ranker
changes the suggestions → changes how the persona reacts → changes the data, so a log
collected under Phase 1 can only *pre-filter* a candidate.

**IPS / SNIPS.** Inverse-Propensity-Scoring / Self-Normalised IPS: the standard
off-policy estimators that score a candidate re-ranker from a log collected under a
different policy (used in the Step-4 replay). SNIPS is the variance-reduced version.
Caveat used below: meaningful only if the log records the *full candidate set* per
decision.

**Reward (offline replay).** Per-decision score: `1.0` accepted unchanged (KEEP),
`0.0` moved, `0.5` resized.

**Duration backtest.** A check of the Phase-2 duration **corrector** (which nudges a
task's reserved time toward the user's *true* duration, since people systematically
mis-estimate). Asks: is the *corrected* duration closer to truth than the raw
*estimate*? Measured as `|true − corrected|` vs `|true − est|`.

**Blend vs. max-bias.** When a task has *multiple* tags, each tag has its own
duration multiplier. **max-bias** takes the single largest (most conservative →
over-reserves → schedule inflation). **Sample-weighted blend** (the default) averages
by sample count, so a well-evidenced tag beats a one-sample fluke. `ops` is the
designed discriminator (near-unbiased means, high variance σ ≈ 0.45). This is **the
one ablation that decides a product default**, so it stays in the fast path.

**Wilcoxon signed-rank (paired).** The non-parametric paired significance test. Unit
of analysis = **persona** (never task). It does not assume the deltas are normal (MAR
is a bounded rate). Its **p-value** is the chance of seeing this difference if there
were truly no effect — we want **p < 0.05**.

**Cliff's δ.** A non-parametric *effect size* in [−1, 1] (how big the effect is, not
just whether it exists). Positive δ ⇒ Phase-2 wins; bands (Romano): <0.147
negligible, <0.33 small, <0.474 medium, else large.

**95% CI.** The plausible range for the true MAR difference (bootstrap). A CI that
**excludes 0** means the effect is unlikely to be zero.

**Seed sweep.** Re-running the whole experiment with different population seeds (each
seed = a freshly sampled population). The paired Wilcoxon tests *across personas
within one population*; the seed sweep is the **orthogonal outer loop** that checks
the effect is not an artifact of one lucky population. We want **≥ 3 seeds** to claim
a distribution.

**Recovery.** Because the generator *wrote down* each persona's hidden fields, we can
check the learner recovered the **right** thing, not just that MAR dropped: how close
the learned signed matrix is to the true temporal field `pGlobal`
(cosine ↑, distance ↓) and how close the learned per-tag bias is to `b_tag`
(MAE ↓). A MAR drop **not** accompanied by better recovery is a **red flag**.

**Ground-truth sidecar.** A JSON file written *alongside* a run holding each
persona's `archetypeId`, `pGlobal`, and `tagBias`, keyed by `userId`. The latent
fields are **never** in a DB column a learner could read (anti-circularity); the
sidecar is the out-of-band channel the eval reads to score recovery.

**pGlobal.** The persona's hidden 7-day × 96-slot temporal preference field ("how
much do I like working at this time"). Phase 2's bigger win is recovering it; its
peak magnitudes (2.0–3.2) dominate the tag×time deltas (0.6–2.0) only Phase 3 can
exploit.

**Guardrail.** A metric that must merely **not regress** (as opposed to MAR, which
must *improve*). Three of them: completion-in-slot must not drop; no cohort's MAR may
rise; total reserved time must not inflate.

**Ablation.** Turning *one* component off (or swapping one setting) to attribute the
win to it. Here the discriminating ablation is blend-vs-max-bias.

**Drift.** Slow change in a persona's preferences over time. A planned sensitivity
axis (`--drift-mult`) — but currently **dormant** in the generator, so doubling it is
a no-op (see results doc). Not a gating axis.

> **Archetypes ≠ a Phase-2 product concern.** The archetype *label* is only used by
> the *product* in Phase 4 (cold-start seeding). In Phase 2 *evaluation* it is just
> an **analysis grouping key** (slice the personas into cohorts for the
> "no-cohort-regresses" guardrail). The fields Phase-2 recovery needs are `pGlobal`
> and `tagBias` (per-persona latent fields), not the archetype.

---

## What Phase 2 actually is (so we evaluate the right thing)

Phase 2 is **two independent learners** ([heuristic.md §Phase 2](heuristic.md)), not
one:

1. **Signed 7×96 preference matrix** (placement / *the "where"*) — re-ranks EDF's
   feasible slots toward liked day×block cells, away from disliked ones. The **bigger**
   win: it recovers `pGlobal`.
2. **Per-tag duration-bias correction** (the *"how long"*) — a sample-weighted blend
   of per-tag `actual ÷ estimated` multipliers, applied as preprocessing before EDF.
   Smaller, orthogonal, and a permanent layer that feeds every later phase.

Phase 2 is **tag-blind for placement** (one global matrix per user); tag-conditioned
placement is deferred to Phase 3.

---

## The two evaluation regimes (do not conflate)

| Regime | Step | Data | Cost | Verdict it licenses |
|--------|------|------|------|---------------------|
| **Offline replay** | 4 | The **existing** `TaskEvent` log (no re-simulation) | cheap | conservative *pre-filter* — passing is necessary, not sufficient |
| **Closed-loop A/B** | 5 | A **fresh** re-run per arm (new reactions) | expensive | the honest, decisive proof |

---

## Fast path vs. full protocol

This is the operational heart of the doc. **Run the fast path by default.** Escalate
to the full protocol **only** when the fast path is *borderline* (defined below).

| | **Fast path (default)** | **Full protocol (escalation)** |
|---|---|---|
| Substrate | `--days=60`, `--personas-per-cohort=10` → **n = 50** personas, cohort-balanced | `--days=90`+, the full **n = 50–250** population, longer span |
| Offline gate (Step 4) | Yes — runs **first**, can **early-abort** | Same |
| Closed-loop A/B (Step 5) | Yes — **1 primary config**, paired | Yes, paired |
| Seeds (Step 6) | **3** population seeds | **5+** seeds |
| Significance (Step 6) | Paired Wilcoxon + Cliff's δ + 95% CI | Same |
| Recovery (Step 6) | Yes — sanity cross-check | Same |
| Guardrails (Step 7) | All **three**, on the primary config | Same, on every config |
| Ablation (Step 8) | **Only** blend-vs-max, primary config | + full grid below |
| `--days` sweep (Step 8) | **Skipped** (optional follow-up) | 14 / 30 / 60 / 90 / 365 |
| Noise / drift sensitivity (Step 8) | **Skipped** (optional follow-up) | `--noise-mult`, `--drift-mult` ×1.5, ×2.0 |
| Rough wall-clock | **~3–4 closed-loop runs** (A + B + max-ablation, ×3 seeds reuse the A/B pair) | **~15–25 runs** (grid × days × multipliers × seeds) |
| What it lets you **claim** | "Phase 2 lowers MAR with a significant, positive, never-flipping paired effect across 3 seeds; guardrails hold; the win is earned (recovery up); blend is the right default." | All of that **plus** the operating envelope (how the win scales with history, and how it degrades under doubled noise / drift). |

**Why the fast path is still defensible.** The paired design (same seed, both arms)
removes between-persona variance — the dominant noise source — so the paired Wilcoxon
has real power at **n = 50** personas even though the per-persona MAR is noisy.
Persona (not task) is the unit, so n = 50 is genuinely 50 independent observations of
the *paired* effect. Three seeds give a distribution of that effect across freshly
sampled populations. That is enough to make the four core claims honest. The work the
fast path **cuts** (the `--days` sample-complexity sweep and the noise/drift
sensitivity grid) characterises the *operating envelope* — useful, but it does not
change the *verdict*; it is reporting, not gating.

### When you MUST fall back to the full protocol

Escalate (do not ship on the fast path) if **any** of these is true after Step 6–7:

- **Borderline significance.** The per-seed Wilcoxon **p sits in [0.01, 0.05]** on a
  majority of seeds, or the **95% CI touches 0** on any seed, or `fractionSignificantWins`
  < ~⅔. (Run more personas — the full population — first; the fix for low power is
  more samples, not a different test.)
- **A guardrail near its threshold.** Completion-in-slot drops in any cohort,
  *any* cohort's MAR Δ is ≤ ~0 (within noise of regressing), or schedule inflation
  exceeds what the corrector's true-duration reservation explains.
- **Effect direction flips** on any seed or cohort (a positive δ that goes negative
  anywhere).
- **Recovery does not improve** alongside the MAR drop (the red flag — investigate
  before claiming a win, regardless of significance).
- **You are changing a product default** that the cut ablations would inform (e.g.
  reconsidering blend vs. max, or the minimum-history assumption) — then run the
  relevant cut axis even if the headline verdict is clean.

> Record in the results doc *which* path you ran and, if you stopped at the fast path,
> that none of the escalation triggers fired.

---

## Steps

> Steps 0–3 are setup and run identically for both paths. Steps 4–8 are where the
> fast path and full protocol differ — each step below marks **[fast]** vs **[full]**
> where they diverge.

### Step 0 — Ground-truth export (prerequisite)
Capture each persona's hidden ground truth (`archetypeId`, `pGlobal`, `tagBias`, work
prefs) to a **sidecar JSON** during `sim:run`, keyed by the real `userId`. Required
because `userId` is a non-deterministic `randomUUID()` minted at run time — ground
truth cannot be regenerated standalone and joined back, so it must be captured in the
same run that writes the DB. Unblocks recovery scoring (Step 6).

### Step 1 — Freeze the substrate
**Problem:** if two runs use different arrival/noise streams, you cannot attribute a
metric delta to the re-ranker. **Action:** pin `--seed`, `--start`, `--days`, and the
population so every later comparison reuses the *exact* same stream.

- **[fast]** default substrate: `--start=2025-01-06 --days=60 --personas-per-cohort=10
  --mode=batched` → **50 personas, 10 per cohort**. 60 days is enough history for the
  win to be well past its onset (see results doc: the win is already strong by 60 days)
  while keeping each batched run inside the time budget.
- **[full]** widen to `--days=90`+ and the full population once a fast-path result is
  borderline.

Do one fresh `sim:reset` + Arm-A `sim:run` **with the exporter** so the DB and its
sidecar share `userId`s. Confirm determinism (re-run Arm A, expect byte-identical
event totals).

### Step 2 — Lock the Phase-1 baseline
`pnpm sim:run --reranker=identity` → `pnpm sim:eval`. Snapshot per-persona MAR,
completion-in-slot, move-distance, duration-error. This is the bar (≈ 0.82 MAR).

### Step 3 — Build the Phase-2 re-ranker
Implement the duration corrector + signed-matrix re-ranker behind the existing
`SlotReRanker` seam (`scheduler/reranker.ts`); select it with `--reranker=phase2` in
`run.ts`.

### Step 4 — Offline gate (cheap pre-filter, runs FIRST, can early-abort)
**Problem / intuition:** a full closed-loop run is the expensive part. Before paying
for it, a cheap check on the **already-collected** Phase-1 log can rule a hopeless
candidate out. **This step runs before any closed-loop run and can abort the whole
gate.** Passing is *necessary, not sufficient* (a log collected under Phase 1 cannot
fully reflect how Phase 2 changes reactions).

On the **frozen Phase-1 log already in the DB** (no re-simulation;
`eval/replay.ts:loadDecisions` reads the existing `TaskEvent` rows):

- **Duration backtest** — recompute corrected duration per task from the logged `est`
  (CREATE) and `true` (RESIZE) durations; gate = corrected error **<** estimate error.
  Use the **mean / trimmed-mean** (or fraction-of-tasks-improved), *not* the median:
  the median sits at the 15-min grid floor and is uninformative there (see results
  doc Step 4).
- **Placement replay (IPS/SNIPS)** — plug the Phase-2 re-ranker into `replay.ts` as
  `candidate`; its estimated reward should clear the identity incumbent. **Known
  limitation:** today the replay reconstructs only ≤ 2 candidate slots per decision,
  so it cannot discriminate re-rankers — treat it as *non-informative*, not a fail,
  until `loadDecisions` is enriched to re-run `feasibleSlots`.
- **Early-abort rule:** a *clear* fail on the duration mean-error backtest (corrector
  makes mean error *worse*) ⇒ stop, do not run the closed loop. An inconclusive
  result (median tie, non-informative replay) ⇒ proceed to Step 5, which is decisive.

### Step 5 — Closed-loop A/B re-simulation (decisive)
**Problem:** only a fresh per-arm run lets each policy generate its own reactions.
**Action:** re-run the span **twice, paired**, same `--seed`: Arm A = `identity`,
Arm B = `phase2`. Each arm generates its own reactions; run arms against separate sim
DBs/profiles to keep logs isolated. Recompute all §12 metrics per persona per arm.

- **[fast]** run the **primary config only** (`--duration-bias=blend`). One A + one B
  per seed.
- **[full]** additionally re-run under each ablation/sensitivity config in Step 8.

### Step 6 — Significance + ground-truth recovery
**Problem:** is the MAR drop real or noise, and is it *earned*?

- **Significance:** unit = **persona** (never task). Paired **Wilcoxon signed-rank**
  on the per-persona MAR delta `(MAR_A − MAR_B)`; report **Cliff's δ** and a **95%
  CI**. Repeat over multiple population seeds and report the distribution.
  - **[fast]** **3** seeds.
  - **[full]** **5+** seeds.
- **Recovery:** against the Step-0 sidecar, `‖matrix_normalized − pGlobal‖ ↓`,
  cosine ↑, and `|b̂_tag − b_tag| ↓`. A MAR drop **without** better recovery is a red
  flag — investigate before claiming a win (and an escalation trigger).

### Step 7 — Guardrails (a win that regresses these does not ship)
**Problem:** MAR can drop while something worse happens elsewhere. These must **not
regress** (only MAR must *improve*; the rest must merely hold). Run all three on the
primary config (both paths):

- **Completion-in-slot** must not drop (the real-outcome proxy outranks MAR).
- **No cohort regresses** — no cohort's MAR may rise above baseline.
- **No schedule inflation** — total reserved time must not worsen beyond what the
  corrector's true-duration reservation explains (blend-vs-max).

### Step 8 — Ablation + sensitivity
**Problem:** attribute the win and map where it breaks. **Only the first item is in
the fast path; the rest are optional follow-ups, run only on escalation.**

- **[fast] Blend vs. max-bias** (the one discriminating ablation, decides a product
  default) — `--duration-bias=max` vs the default `blend` on the **primary config**;
  `ops` is the discriminator. Blend should match MAR while avoiding max's
  over-reservation. This is the only Step-8 work the fast path runs.
- **[full / optional] Sample-complexity sweep** — MAR vs. history length: vary
  `--days` (14 / 30 / 60 / 90 / 365). Characterises the operating envelope ("does
  ~1–2 weeks/user hold?"); **not gating**.
- **[full / optional] Sensitivity** — re-run at higher noise floor
  (`--noise-mult=1.5`, `2.0`) and drift (`--drift-mult=1.5`, `2.0`). Reports where the
  win narrows; **not gating**. (Drift is currently dormant in the generator — doubling
  it is a no-op until `driftPGlobal` is activated in the reaction model.)

CLI knobs (defaults reproduce the baseline run exactly): `--duration-bias=blend|max`,
`--noise-mult=<float>`, `--drift-mult=<float>`, `--personas-per-cohort=<N>`,
`--days=<N>`.

### Promotion decision

**[fast] Promote on the fast path when all hold:** offline gate not a hard fail (4);
closed-loop MAR drop is significant with a positive, never-flipping Cliff's δ across
3 seeds (5–6); recovery improved (6); no guardrail regression (7); blend ≥ max on MAR
without max's over-reservation (8); **and no escalation trigger fired**.

**[full] If any escalation trigger fired,** re-run on the wider population / extra
seeds and report the optional `--days` and noise/drift axes before sign-off. Do **not**
ship while a trigger is unresolved.

---

## Tooling status (what exists vs. what's missing)

| Piece | File / command | Status |
|-------|----------------|--------|
| Phase-1 / Phase-2 closed-loop run | `pnpm sim:run` (`simulation/run.ts`, `runner.ts`) | ✅ `--reranker`, `--personas-per-cohort`, `--days`, `--duration-bias`, `--noise-mult`, `--drift-mult` |
| Metrics (§12) | `pnpm sim:eval` (`eval/run-metrics.ts`, `metrics.ts`) | ✅ per-persona dump keyed by stable persona email |
| Quality snapshot | `node dist/simulation/eval/count.js` | ✅ |
| Offline duration backtest (Step 4) | `eval/duration-backtest.ts` (surfaced by `sim:eval`) | ✅ (use mean, not median) |
| Offline placement replay (IPS/SNIPS) | `eval/replay.ts` — identity + Phase-2 candidate (`replayPhase2`) | ⚠️ ≤2-candidate scaffold → non-informative until enriched |
| Ground-truth sidecar | `eval/ground-truth.ts` (Step 0) | ✅ |
| Recovery scoring | `pnpm sim:recovery` (`eval/recovery.ts` + pure `recovery-metrics.ts`) | ✅ |
| Significance / sweeps | `pnpm sim:significance` (`eval/significance.ts`): paired Wilcoxon + Cliff's δ + 95% CI + multi-seed `--pairs` sweep | ✅ pairs by stable persona key |
