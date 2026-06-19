# Phase 2 Evaluation — Step-by-Step Plan

> How we prove **Phase 2 beats Phase 1** on the synthetic persona population, and
> what each step actually requires. This specialises the general methodology in
> [simulation-strategy.md §13](simulation-strategy.md) to Phase 2. Read that doc
> for the "why two regimes" framing; this one is the operational checklist.

---

## What Phase 2 actually is (so we evaluate the right thing)

Phase 2 is **two independent learners** ([heuristic.md §Phase 2](heuristic.md)), not one:

1. **Signed 7×96 preference matrix** (placement / *the "where"*) — re-ranks EDF's
   feasible slots toward liked day×block cells, away from disliked ones. This is
   the **bigger** win: it recovers the persona's global temporal field `pGlobal`,
   whose magnitudes (peak heights 2.0–3.2) dominate the tag×time deltas (0.6–2.0)
   that only Phase 3 can exploit.
2. **Per-tag duration-bias correction** (the *"how long"*) — a sample-weighted
   blend of per-tag `actual ÷ estimated` multipliers, applied as preprocessing
   before EDF. Smaller, orthogonal, and a permanent layer that feeds every later
   phase.

Phase 2 is **tag-blind for placement** (global matrix per user); tag-conditioned
placement is deferred to Phase 3.

---

## The two evaluation regimes (do not conflate)

| Regime | Step | Data | Cost | Verdict |
|--------|------|------|------|---------|
| **Offline replay** | 4 | The **existing** `TaskEvent` log (no re-simulation) | cheap | conservative *pre-filter* — passing is necessary, not sufficient |
| **Closed-loop A/B** | 5 | A **fresh** re-run per arm (new reactions) | expensive | the honest, decisive proof |

Why both: a new re-ranker changes the suggestions → changes how the persona reacts
→ changes the data. So a log collected under Phase 1 can only *pre-filter* a
candidate; the honest test re-runs the loop so each policy generates its own
reactions. Only a simulator can do the latter without exposing real users.

---

## Glossary (terms used below)

- **Arm** — one condition in an A/B comparison (clinical-trial / bandit term).
  **Arm A = identity re-ranker = Phase 1**; **Arm B = Phase 2**. "Paired" means
  each persona is run under *both* arms with the *same seed*, so we compare a
  persona to itself.
- **MAR** (Manual Adjustment Rate) — the north-star: fraction of scheduled tasks
  the persona moved or resized after the suggestion. Per-task binary. Lower = better.
- **IPS / SNIPS** — Inverse-Propensity-Scoring / Self-Normalised IPS: off-policy
  estimators that score a candidate re-ranker from a log collected under a different
  policy (the Step-4 replay).
- **Blend vs. max-bias** — when a task has *multiple* tags, each tag has its own
  duration multiplier. **Max-bias** takes the largest (over-reserves → schedule
  inflation). **Sample-weighted blend** (the default) averages by sample count, so
  a well-evidenced tag beats a one-sample fluke. `ops` is the designed discriminator
  (near-unbiased means, high variance).
- **Recovery** — because the generator *wrote down* each persona's hidden fields,
  we can measure whether the learner recovered the **right** thing: `‖matrix −
  pGlobal‖` and `|b̂_tag − b_tag|`. The simulation-only luxury.
- **Ground-truth sidecar** — a JSON file written *alongside* a run holding each
  persona's `archetypeId`, `pGlobal`, and `tagBias`, keyed by `userId`. The latent
  fields are **never** stored in a DB column a learner could read (anti-circularity);
  the sidecar is the out-of-band channel the eval reads to score recovery.

> **Archetypes ≠ a Phase-2 product concern.** The archetype *label* is only used by
> the *product* in Phase 4 (cold-start seeding). In Phase 2 *evaluation* it is just
> an **analysis grouping key** (slice 50 personas into 5 cohorts for the
> "no-cohort-regresses" guardrail and reporting). The fields Phase-2 recovery
> actually needs are `pGlobal` and `tagBias`, which are per-persona latent fields,
> not the archetype.

---

## Steps

### Step 0 — Ground-truth export (prerequisite)
Capture each persona's hidden ground truth (`archetypeId`, `pGlobal`, `tagBias`,
work prefs) to a **sidecar JSON** during `sim:run`, keyed by the real `userId`.
Required because `userId` is a non-deterministic `randomUUID()` minted at run time —
ground truth cannot be regenerated standalone and joined back, so it must be
captured in the same run that writes the DB. Unblocks recovery scoring (Step 6).

### Step 1 — Freeze the substrate
Pin `--seed`, `--start`, `--days`, and the population. Every later comparison reuses
the *exact* same arrival + noise stream, so any metric delta is attributable to the
re-ranker alone. **Note:** the existing 0.82-MAR DB predates the exporter, so its
ground truth is unrecoverable — do one fresh `sim:reset` + `sim:run` with the
exporter so the DB and its sidecar share `userId`s.

### Step 2 — Lock the Phase-1 baseline
`pnpm sim:run` → `pnpm sim:eval`. Snapshot per-persona MAR, completion-in-slot,
move-distance, duration-error. This is the bar (current: MAR ≈ 0.82).

### Step 3 — Build the Phase-2 re-ranker
Implement the duration corrector + signed-matrix re-ranker behind the existing
`SlotReRanker` seam (`scheduler/reranker.ts`); wire a `--reranker=phase2` branch in
`run.ts` (today it hard-rejects anything but `identity`).

### Step 4 — Offline gate (cheap pre-filter, BEFORE closed-loop)
On the **frozen Phase-1 log already in the DB** (no re-simulation; the "logged
decisions" are the existing `TaskEvent` rows — telemetry is complete from Phase 1,
and `eval/replay.ts:loadDecisions` already reads them):
- **Duration backtest** — recompute corrected duration per task from the logged
  `est` (CREATE) and `true` (RESIZE) durations; gate = `median|true − corrected| <
  median|true − est|`.
- **Placement replay (IPS/SNIPS)** — plug the Phase-2 re-ranker into `replay.ts` as
  `candidate`; its estimated reward must clear the identity incumbent.
- **Gate:** fails here ⇒ do not promote.

### Step 5 — Closed-loop A/B re-simulation (decisive)
Re-run the full span **twice, paired**, same `--seed`: Arm A = `identity`, Arm B =
`phase2`. Each arm generates its own reactions. Recompute all §12 metrics per
persona per arm. (Run arms against separate sim DBs / profiles to keep their logs
isolated.)

### Step 6 — Significance + ground-truth recovery
- **Significance:** unit of analysis = **persona** (never task). Paired
  **Wilcoxon signed-rank** on the per-persona MAR delta `(MAR_A − MAR_B)`; report
  **effect size (Cliff's δ)** and a 95% CI. Repeat over **multiple population seeds**
  and report the distribution of the effect — one lucky population is not evidence.
  (The paired test is *across personas within a population*; the seed sweep is the
  *outer* robustness loop — these are two different axes.)
- **Recovery:** against the Step-0 sidecar, `‖matrix_normalized − pGlobal‖ ↓` and
  `|b̂_tag − b_tag| ↓`. A MAR drop **not** accompanied by better recovery is a red
  flag — investigate before claiming a win.

### Step 7 — Guardrails (a win that regresses these does not ship)
These must **not regress** (it is *not* "every metric must improve" — only MAR must
improve; the rest must merely hold):
- **Completion-in-slot** must not drop (the real-outcome proxy outranks MAR).
- **No cohort regresses** — no `archetypeId` cohort's MAR may rise above baseline.
- **No schedule inflation** — total reserved time must not worsen (blend-vs-max-bias).

### Step 8 — Ablation + sensitivity
- **Blend vs. max-bias** duration ablation — `ops` is the discriminator
  (`archetypes.ts`: near-unbiased means, σ ≈ 0.45); blend should avoid the inflation
  max-bias causes.
- **Sample-complexity sweep** — MAR vs. history length: vary `--days`
  (14 / 30 / 90 / 365) or evaluate over rolling windows; does "~1–2 weeks/user" hold?
- **Sensitivity** — re-run at higher noise floor `ε` and drift magnitude (these live
  in `archetypes.ts` as `noiseFloor` / `driftPerMonth`, **not** CLI args today — edit
  them or add a multiplier knob). Report where the win breaks down.

### Promotion decision
Promote Phase 2 only when **all** hold: offline gate passed (4); closed-loop MAR drop
is statistically significant with a meaningful effect size (5–6); recovery improved
(6); no guardrail regression (7); the win survives ablation + sensitivity (8).

---

## Tooling status (what exists vs. what's missing)

| Piece | File / command | Status |
|-------|----------------|--------|
| Phase-1 closed-loop run | `pnpm sim:run` (`simulation/run.ts`, `runner.ts`) | ✅ |
| Metrics (§12) | `pnpm sim:eval` (`eval/run-metrics.ts`, `metrics.ts`) | ✅ |
| Quality snapshot | `node dist/simulation/eval/count.js` | ✅ |
| Offline replay scaffold | `eval/replay.ts` (identity-vs-identity only) | ⚠️ scaffold |
| **Ground-truth sidecar** | `eval/ground-truth.ts` (Step 0) | ✅ (this change) |
| Phase-2 re-ranker | `scheduler/reranker.ts` + `--reranker=phase2` | ❌ not built |
| Recovery scoring | reads sidecar + matrix | ❌ not built (needs Step 3) |
| Significance / sweeps | stats over per-persona MAR | ❌ not built |
</content>
</invoke>
