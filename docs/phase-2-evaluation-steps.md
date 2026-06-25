# Phase 2 Evaluation — Step-by-Step Plan

> **What this doc is.** The operational checklist for proving **Phase 2 beats
> Phase 1** on the synthetic persona population: what each stage tests, why, and the
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
> **The structure.** The gate has **four stages**: Prepare → A/B → Evaluate → Sanity.
> An optional duration diagnostic runs before the A/B and can abort only if the
> corrector is clearly broken. Building the Phase-2 re-ranker (engineering) is
> out of scope here — it belongs in architecture docs.

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

**Arm.** One condition in an A/B comparison. **Arm A = `identity` = Phase 1**;
**Arm B = `phase2`**.

**Paired design.** Every persona is run under *both* arms with the *same seed*, so we
compare a persona **to itself** (Arm A vs Arm B), not to some other persona. Why it
matters: persona-to-persona variance is huge (a crammer overrides far more than a
dev); pairing cancels that variance out, so a much smaller sample reaches
significance. This is the single biggest reason 50 personas is viable.

**Persona / archetype / cohort.** The simulator invents synthetic users.
An **archetype** is a *type* of user (5 of them: `dev`, `night_owl`, `ops`, `pm`,
`crammer`), each with hidden preferences. A **persona** is one concrete sampled user
from an archetype. A **cohort** = "all personas of one archetype".
`--personas-per-cohort=N` keeps the first N personas of *every* archetype, so no
cohort is ever dropped (a balanced shrink).

**MAR (Manual Adjustment Rate) — the north-star.** Fraction of scheduled tasks the
persona moved or resized after the suggestion. Per-task binary, **lower is better**.
A Phase-2 win looks like **MAR going down** (Arm B < Arm A). Measured from the
`TaskEvent` log as override-type events over total placements. Reported split into
*avoidable* (scheduler placed a task in a slot the persona dislikes — scheduler's
fault) and *unavoidable* (urgency spike, sudden external event, feasibility-forced
move — not the scheduler's fault); Phase 2 is graded on avoidable MAR. See
[simulation-strategy.md §12](simulation-strategy.md).

**Completion-in-slot.** Fraction of tasks the persona actually completed in the
suggested slot. **Higher is better.** A complementary guardrail that outranks MAR
as a real-outcome proxy.

**Duration backtest.** A check of the Phase-2 duration **corrector** (which nudges a
task's reserved time toward the user's *true* duration, since people systematically
mis-estimate). Asks: is the *corrected* duration closer to truth than the raw
*estimate*? Measured as `|true − corrected|` vs `|true − est|`. Use the **mean /
trimmed-mean** (not the median, which sits at the 15-min grid floor and is
uninformative there). This is the only offline diagnostic retained; IPS/SNIPS
placement replay is not gating — see Optional Diagnostic below.

**Blend vs. max-bias.** When a task has *multiple* tags, each tag has its own
duration multiplier. **max-bias** takes the single largest (most conservative →
over-reserves → schedule inflation). **Sample-weighted blend** (the default) averages
by sample count, so a well-evidenced tag beats a one-sample fluke. `ops` is the
designed discriminator (near-unbiased means, high variance σ ≈ 0.45). This is **the
one ablation that decides a product default**.

**Wilcoxon signed-rank (paired).** The non-parametric paired significance test. Unit
of analysis = **persona** (never task). It does not assume the deltas are normal (MAR
is a bounded rate). Its **p-value** is the chance of seeing this difference if there
were truly no effect — we want **p < 0.05**.

**Cliff's δ.** A non-parametric *effect size* in [−1, 1] (how big the effect is, not
just whether it exists). Positive δ ⇒ Phase-2 wins; bands (Romano): <0.147
negligible, <0.33 small, <0.474 medium, else large.

**Seed sweep.** Re-running the whole experiment with different population seeds (each
seed = a freshly sampled population). The paired Wilcoxon tests *across personas
within one population*; the seed sweep is the **orthogonal outer loop** that checks
the effect is not an artifact of one lucky population. Three seeds is the standard bar.

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
much do I like working at this time"). Phase 2's bigger win is recovering it.

**Guardrail.** A metric that must merely **not regress materially** (as opposed to
MAR, which must *improve*). Three of them: completion-in-slot must not drop; no
cohort's MAR may rise by more than a noise threshold; total reserved time must not
inflate.

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

## The four-stage gate

| Stage | What it does | Decisive? |
|-------|-------------|-----------|
| **1. Prepare** | Sample 50 personas, export latent truth, freeze seed, run baseline | Setup |
| **2. A/B** | Re-run both arms (identity vs phase2) × 3 seeds, paired | Generates evidence |
| **3. Evaluate** | MAR drop + Wilcoxon + Cliff's δ, across seeds | **Yes — primary verdict** |
| **4. Sanity** | Recovery + guardrails + blend-vs-max ablation | Validates the win |
| *(Optional)* Duration diagnostic | Duration backtest before Stage 2; abort only on clear corrector failure | Pre-filter |

---

## Stage 1 — Prepare paired experiment

Do this **once** per evaluation cycle.

1. `sim:reset` — clear the sim DB.
2. Sample with the standard substrate: `--start=2025-01-06 --days=60
   --personas-per-cohort=10 --mode=batched` → **50 personas, 10 per cohort**. 60 days
   gives the learner well past its data threshold while keeping runs inside the time
   budget.
3. Run Arm A **with the ground-truth exporter**: `pnpm sim:run --reranker=identity`.
   This writes both the DB and the sidecar JSON in one shot (avoids the
   `userId`-join problem — `userId` is a non-deterministic `randomUUID()` minted at
   run time, so ground truth must be captured in the same run that populates the DB).
4. Confirm determinism: re-run Arm A with the same seed and expect byte-identical
   event totals.
5. Snapshot the Phase-1 baseline: `pnpm sim:eval` → save per-persona MAR,
   completion-in-slot, move-distance, duration-error. This is the bar (≈ 0.82 MAR).

**Output:** Arm A logs + ground-truth sidecar. Every later comparison reuses the same
personas, seed, and calendar stream.

---

## Optional Diagnostic — Duration backtest (before Stage 2)

On the **frozen Arm A log** (no re-simulation):

- Recompute corrected duration per task from the logged `est` (CREATE) and `true`
  (RESIZE) durations.
- Compare **mean / trimmed-mean** of `|true − corrected|` vs `|true − est|`. Do not
  use the median — it sits at the 15-min grid floor and is uninformative.
- **Abort rule:** if the corrector makes mean error *worse*, stop and do not run
  Stage 2 — the bias learner is broken. An inconclusive result (metrics tied, or
  only median differs) → proceed to Stage 2.

**IPS/SNIPS placement replay is not run.** The existing scaffold reconstructs only
≤ 2 candidate slots per decision, so it cannot discriminate re-rankers — treating a
pass/fail here as informative would be misleading. If `loadDecisions` is later
enriched to re-run `feasibleSlots` (giving the full candidate set), replay can be
added as a secondary diagnostic. Until then, the closed-loop A/B is both cheaper
to reason about and the honest proof.

---

## Stage 2 — Paired A/B simulation

Re-run the span **twice** per seed, sharing the same `--seed`:

- **Arm A:** `pnpm sim:run --reranker=identity`
- **Arm B:** `pnpm sim:run --reranker=phase2 --duration-bias=blend`

Run arms against separate sim DBs/profiles to keep logs isolated. Each arm generates
its own reactions (this is what makes it decisive — each policy produces the data
it would have generated, not what the other policy generated). Repeat for **3 seeds**
(3 freshly sampled populations).

---

## Stage 3 — Evaluate core metrics + significance

Unit of analysis = **persona** (never task — tasks within a persona are correlated).

**Primary metrics** (both must move in the right direction):
- **MAR** must decrease (Arm B < Arm A). Report avoidable MAR separately.
- **Completion-in-slot** must not drop.

**Secondary metrics** (reported, not individually gating):
- Duration error.
- Move distance.

**Statistical test:**
- Paired **Wilcoxon signed-rank** on per-persona MAR delta `(MAR_A − MAR_B)`.
- Report **Cliff's δ** (effect size) — want positive and at least small (≥ 0.147).
- Repeat over 3 seeds; want **p < 0.05** and a positive, never-flipping Cliff's δ
  across all seeds.

Bootstrap 95% CI is omitted from the gate — with a p-value, effect size, and
multi-seed consistency already in hand it adds little for a POC decision. Include it
in any write-up intended for external review.

---

## Stage 4 — Sanity checks

### Recovery

Against the Stage-1 sidecar: `‖matrix_normalized − pGlobal‖ ↓`, cosine ↑, and
`|b̂_tag − b_tag| ↓`. A MAR drop **without** better recovery is a red flag —
investigate before claiming a win (suggests the drop may be an artifact rather than
genuine personalization).

### Guardrails

All three must hold on the primary config:

1. **Completion-in-slot** must not drop — the real-outcome proxy outranks MAR.
2. **Cohort regression** — fail only if any cohort's `ΔMAR > 0.02` **AND**
   statistically significant. A drift of +0.002 in a 10-persona cohort is within
   simulation noise; the hard zero-regression rule is too strict at this scale.
3. **Schedule inflation** — total reserved time must not worsen beyond what the
   corrector's true-duration reservation explains (blend-vs-max).

### Ablation — blend vs. max-bias

This is the only ablation in the gate. Re-run Stage 2 with `--duration-bias=max` on
the primary config and compare against the default `blend`. The `ops` archetype is the
discriminator (near-unbiased means, high variance). Blend should match MAR while
avoiding the over-reservation that max-bias causes on multi-tagged tasks.

Sample-complexity (`--days`), noise (`--noise-mult`), and drift (`--drift-mult`)
sweeps characterise the *operating envelope* but do not change the pass/fail verdict —
defer to Phase 3 readiness work.

---

## Promotion decision

Promote Phase 2 when **all** hold:

- Optional diagnostic not a hard fail (corrector improves mean duration error, or
  inconclusive).
- Stage 2 A/B ran paired across 3 seeds.
- Stage 3: MAR drop is significant (p < 0.05 on all seeds), Cliff's δ positive and
  at least small on all seeds, direction never flips.
- Stage 4: recovery improved; no cohort's ΔMAR > 0.02 significantly; completion-in-slot
  holds; blend ≥ max on MAR without max's over-reservation.

Record in the results doc which seeds were run and confirm no guardrail was near its
threshold at sign-off.

---

## Tooling status (what exists vs. what's missing)

| Piece | File / command | Status |
|-------|----------------|--------|
| Phase-1 / Phase-2 closed-loop run | `pnpm sim:run` (`simulation/run.ts`, `runner.ts`) | ✅ `--reranker`, `--personas-per-cohort`, `--days`, `--duration-bias`, `--noise-mult`, `--drift-mult` |
| Metrics (§12) | `pnpm sim:eval` (`eval/run-metrics.ts`, `metrics.ts`) | ✅ per-persona dump keyed by stable persona email |
| Quality snapshot | `node dist/simulation/eval/count.js` | ✅ |
| Offline duration backtest (Optional Diagnostic) | `eval/duration-backtest.ts` (surfaced by `sim:eval`) | ✅ (use mean, not median) |
| Offline placement replay (IPS/SNIPS) | `eval/replay.ts` | ⚠️ ≤2-candidate scaffold → **non-gating** until `loadDecisions` is enriched to re-run `feasibleSlots` |
| Ground-truth sidecar | `eval/ground-truth.ts` (Stage 1) | ✅ |
| Recovery scoring | `pnpm sim:recovery` (`eval/recovery.ts` + pure `recovery-metrics.ts`) | ✅ |
| Significance / sweeps | `pnpm sim:significance` (`eval/significance.ts`): paired Wilcoxon + Cliff's δ + multi-seed `--pairs` sweep | ✅ pairs by stable persona key |
