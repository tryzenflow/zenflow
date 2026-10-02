# Report: heuristic vs LinUCB vs LinUCB with a warm start (issue #60)

We tested three ways of choosing a time slot for a student's task, using simulated students:

1. **Heuristic:** the current rule-based method.
2. **LinUCB (cold):** a learning method that starts knowing nothing.
3. **LinUCB (warm):** the same learning method, started with a little built-in knowledge.

## 1. The answer in short

| | Heuristic | LinUCB (cold) | LinUCB (warm) |
| --- | --- | --- | --- |
| Average regret (how far from the best slot; lower is better) | 0.463 | 0.447 | **0.377** |
| Proposals the student keeps | 56% | 70% | 70% |
| Minutes the student drags a proposal | 130 | 84 | **72** |
| Proposals needed until it feels reliable | 34 | 16 | 16 |

- **Both versions of LinUCB beat the heuristic on kept proposals and dragging.** About 70% of their
  proposals are kept, against 56%, and students move them about 50 minutes less.
- **Cold LinUCB is only slightly closer to the best slot than the heuristic** (0.447 vs 0.463). It is
  better for some students and worse for others, and it slips slightly behind after 40 proposals.
- **Warm LinUCB is clearly the best overall.** Its regret is 0.377, and it fixes the late slip.
- **Warm LinUCB does not fix everything.** It is still worse than the heuristic for early-bird crammers and
  weekenders, and it makes night owls' first proposals worse than cold LinUCB's (still far better than the heuristic's).
- **We implemented the warm start in the real code** with strength 5 (explained in section 2).
- **Limit:** the students are invented. This shows how the systems behave, not that real people will see the same results.

## 2. The three systems

**Heuristic.** It keeps a table of how much a student likes each hour of each weekday. The table starts
with default guesses: mornings, afternoons and evenings are good, late night is poor. It proposes the
free slot with the best score. When the student drags a proposal, the table shifts toward the new hour.

**LinUCB (cold).** It splits the day into six time bands, such as morning and evening. It learns how
well each band works for a task, taking into account the task's deadline, its length, how busy the day
is, and whether it is a weekend. It starts knowing nothing, so it has to try different bands first.

**LinUCB (warm).** Same as cold, but before the first real proposal it is given a small amount of
pretend experience, built from the heuristic's default table:

- We go through every cell of the table (7 weekdays × 24 hours).
- Each cell belongs to one time band. We record a pretend observation for that band, using a typical
  day (weekend flag set for Saturday and Sunday) and the cell's table value as the pretend reward.
- A setting called **n0** is the total weight of the pretend experience each band receives. It is
  like saying "treat the table as if it were n0 real proposals". Real feedback gradually takes over, so
  the pretend experience fades as the student's own history grows. n0 = 0 is the same as cold.

## 3. How to read the numbers

All numbers are per proposal, averaged over students.

| Metric | What it means | Better is |
| --- | --- | --- |
| **Regret** | How much worse the proposed slot is than the best free slot for that student, according to the student's hidden true preference. 0 means the proposal was the best slot. | lower |
| **Kept** | The share of proposals the student leaves alone instead of dragging. It is what a user feels as "the app got it right". It is a rough measure, because a student also keeps slots that are only good enough. | higher |
| **Drag** | How many minutes the student moves a proposal. A kept proposal counts as 0. It measures wasted effort. | lower |
| **Proposals to reach 60%** | How many proposals pass before the student has kept at least 6 of the last 10. It shows how fast the system becomes useful to a new student. 10 is the fastest possible. | lower |
| **First 10 / 40+** | Regret over a student's first 10 proposals, and over everything after the 40th. They show the start and the late stage. | lower |
| **95% range** | The range the true difference very likely lies in. If it does not include 0, the difference is real and not luck. | n/a |

**Regret and kept can disagree.** Regret is about slot quality. Kept is about whether a student bothered
to move the proposal. A slot that is good but not the best counts as a win on kept and a loss on regret.
To judge slot quality, trust regret. To judge what users feel, look at kept and drag.

## 4. How we tested

- **Simulated students.** Each has two traits that vary independently, giving 15 types:
  - *When they work best:* early bird, midday or night owl. Night owls still have some daytime days, such
    as classes and exam prep.
  - *How they behave:* stable, erratic, crammer (wants late slots near deadlines), planner (front-loads
    work) or weekender (prefers weekends).
- **A hidden true preference.** Each student has a secret preference for every weekday and hour. It is
  built so that it matches neither policy's way of working, so no system wins by design. Tests check this.
- **How a student reacts.** Shown a proposal, a student may drag it to a better slot on the same day.
  They do it only if the gain is big enough, only some of the time, and with some noise in what they
  perceive. Each system then learns from what happened, the way it does in production.
- **Fair comparison.** Every system sees the same students, calendars, tasks and random luck.
- **Five scenarios:** a single task, and series of 3 or 6 sittings, each packed loosely or tightly. Each
  student gets 60 task arrivals per scenario.
- **Three runs, with different sizes.**
  - *Run 1, the three-way comparison:* 3 repeat runs ("seeds") × 700 students, with all three systems
    in the same run. This is where the three-way tables in section 5 come from.
  - *Run 2, heuristic vs cold at scale:* 20 seeds × 1,000 students. It gives the heuristic-vs-cold
    differences with confidence ranges, and how many of the 20 runs agree.
  - *Run 3, absolute values for heuristic and cold:* 3 seeds × 1,000 students (about 1.14 million
    proposals per system per seed), used for the scenario and experience tables.
- **Which n0 was used.** Run 1 tried n0 = 2, 5 and 10. The production code uses n0 = 5, which is the
  "warm" column everywhere in this report. An exploration round of 300 students tried other designs
  of the pretend experience first, and the one using the table's values directly worked best.
  A version with no preference information (reward 0) was clearly weaker, so the gain does not only come
  from LinUCB exploring less.

## 5. Results

### 5.1 Overall, all three systems (Run 1)

| Metric | Heuristic | Cold | Warm n0=2 | **Warm n0=5** | Warm n0=10 |
| --- | --- | --- | --- | --- | --- |
| Regret | 0.463 | 0.447 | 0.388 | **0.377** | **0.377** |
| Kept | 56.4% | 70.0% | 70.0% | 69.8% | 69.1% |
| Drag (min) | 130 | 84 | 74 | **72** | 73 |
| Proposals to 60% | 34.4 | 16.1 | 16.3 | 16.4 | 17.0 |
| Regret, first 10 proposals | 0.694 | 0.616 | 0.567 | **0.566** | 0.573 |
| Regret, 40+ proposals | 0.416 | 0.428 | 0.373 | 0.361 | **0.358** |

Reading this: moving from the heuristic to cold LinUCB gains little on regret, but a lot on kept and
drag. Adding the warm start then lowers regret by another 0.07 and drag by another 12 minutes. Warm
n0 = 5 and n0 = 10 tie on regret overall, but n0 = 10 slows some student types (section 5.2), so 5 is the
better choice.

### 5.2 By student type (Run 1)

Regret (lower is better):

| Type | Heuristic | Cold | Warm n0=5 |
| --- | --- | --- | --- |
| night owl, stable | 0.629 | 0.376 | **0.303** |
| night owl, crammer | 0.798 | 0.552 | **0.394** |
| night owl, planner | 0.704 | 0.474 | **0.340** |
| night owl, erratic | 0.731 | **0.431** | 0.452 |
| night owl, weekender | 0.610 | 0.628 | 0.610 |
| midday, stable | 0.335 | **0.270** | 0.264 |
| midday, planner | 0.369 | 0.346 | **0.328** |
| midday, crammer | 0.386 | 0.363 | **0.335** |
| midday, erratic | 0.409 | 0.399 | **0.377** |
| midday, weekender | **0.412** | 0.548 | 0.479 |
| early bird, stable | 0.240 | 0.259 | **0.211** |
| early bird, planner | 0.292 | 0.417 | **0.264** |
| early bird, erratic | **0.330** | 0.461 | 0.372 |
| early bird, crammer | **0.383** | 0.563 | 0.461 |
| early bird, weekender | **0.320** | 0.614 | 0.457 |

(Bold = best of the three.) Kept, drag and learning speed:

| Type | Kept: Heur. | Cold | Warm | Drag min: Heur. | Cold | Warm | To 60%: Heur. | Cold | Warm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| night owl, stable | 47.0% | 74.4% | 76.0% | 253 | 89 | 73 | 88.0 | 15.4 | 18.2 |
| night owl, crammer | 46.4% | 71.4% | 69.4% | 245 | 91 | 72 | 69.4 | 15.6 | 20.1 |
| night owl, planner | 52.2% | 78.3% | 76.7% | 217 | 59 | 58 | 55.7 | 13.5 | 16.6 |
| night owl, erratic | 44.5% | 48.4% | 48.4% | 242 | 183 | 184 | 31.6 | 23.4 | 24.5 |
| night owl, weekender | 57.2% | 76.7% | 74.7% | 170 | 62 | 68 | 27.7 | 13.1 | 15.1 |
| midday, stable | 58.1% | 75.0% | 73.9% | 85 | 51 | 48 | 49.0 | 16.1 | 17.7 |
| midday, planner | 60.3% | 74.6% | 73.7% | 76 | 52 | 47 | 35.8 | 14.9 | 15.8 |
| midday, crammer | 55.2% | 68.2% | 67.5% | 93 | 69 | 62 | 37.5 | 16.1 | 17.3 |
| midday, erratic | 48.9% | 50.2% | 50.7% | 126 | 135 | 126 | 25.6 | 21.6 | 21.2 |
| midday, weekender | 58.7% | 70.9% | 69.7% | 74 | 59 | 54 | 25.4 | 14.2 | 14.9 |
| early bird, stable | 69.0% | 82.5% | 85.3% | 70 | 46 | 29 | 11.9 | 14.2 | 10.5 |
| early bird, planner | 71.6% | 81.4% | 83.5% | 53 | 51 | 25 | 12.3 | 13.2 | 10.9 |
| early bird, erratic | 49.2% | 48.8% | 50.3% | 120 | 165 | 136 | 17.0 | 21.8 | 17.1 |
| early bird, crammer | 59.3% | 72.1% | 72.7% | 81 | 89 | 62 | 16.7 | 15.4 | 14.4 |
| early bird, weekender | 68.0% | 77.7% | 74.9% | 49 | 60 | 38 | 12.7 | 12.4 | 11.7 |

### 5.3 The start and the late stage (Run 1, regret)

| Type | First 10: Heur. | Cold | Warm | After 40: Heur. | Cold | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| night owl, stable | 1.147 | **0.471** | 0.797 | 0.523 | 0.375 | **0.274** |
| night owl, crammer | 1.465 | **0.692** | 1.101 | 0.660 | 0.546 | **0.340** |
| night owl, planner | 1.147 | **0.492** | 0.843 | 0.613 | 0.486 | **0.300** |
| night owl, erratic | 1.139 | **0.580** | 0.905 | 0.653 | **0.406** | 0.408 |
| night owl, weekender | 0.869 | **0.655** | 0.787 | 0.554 | 0.622 | 0.586 |
| midday, stable | 0.674 | 0.458 | 0.464 | 0.277 | 0.255 | **0.249** |
| midday, planner | 0.674 | 0.481 | **0.465** | **0.317** | 0.334 | 0.322 |
| midday, crammer | 0.748 | **0.486** | 0.535 | 0.325 | 0.348 | **0.321** |
| midday, erratic | 0.669 | 0.556 | **0.540** | 0.370 | 0.370 | **0.355** |
| midday, weekender | 0.674 | 0.660 | **0.565** | **0.362** | 0.526 | 0.472 |
| early bird, stable | 0.152 | 0.618 | **0.136** | 0.246 | 0.238 | **0.223** |
| early bird, planner | **0.149** | 0.699 | 0.159 | 0.307 | 0.386 | **0.281** |
| early bird, erratic | **0.179** | 0.750 | 0.302 | **0.346** | 0.425 | 0.373 |
| early bird, crammer | **0.384** | 0.870 | 0.467 | **0.371** | 0.519 | 0.454 |
| early bird, weekender | **0.341** | 0.777 | 0.422 | **0.318** | 0.586 | 0.457 |

### 5.4 Heuristic vs cold LinUCB on larger runs (Runs 2 and 3)

These runs have no warm column. They show how the first two systems compare with more students.

**Overall.** In Run 2 (20,000 students), cold LinUCB's regret is lower than the heuristic's by 0.018
(95% range 0.015 to 0.021), and it was lower in all 20 seeds. Kept is higher by 13.7 points, drag is
lower by 47 minutes, and it needs 18 fewer proposals to reach 60%. All of these held in all 20 seeds.

**By scenario** (Run 3; H = heuristic, C = cold LinUCB):

| Scenario | Regret H | Regret C | Kept H | Kept C | Drag H (min) | Drag C (min) |
| --- | --- | --- | --- | --- | --- | --- |
| single task | 0.774 | 0.634 | 44.6% | 65.3% | 178 | 85 |
| 3 sittings, loose | 0.548 | 0.523 | 52.7% | 71.0% | 147 | 82 |
| 3 sittings, tight | 0.412 | 0.348 | 54.0% | 66.4% | 130 | 84 |
| 6 sittings, loose | 0.476 | 0.520 | 59.1% | 72.4% | 124 | 83 |
| 6 sittings, tight | 0.382 | 0.353 | 58.7% | 69.9% | 121 | 85 |

Cold LinUCB has worse regret only for the loose 6-sitting series.

**By experience** (Run 3):

| Proposals so far | Regret H | Regret C | Kept H | Kept C | Drag H (min) | Drag C (min) |
| --- | --- | --- | --- | --- | --- | --- |
| 0–5 | 0.712 | 0.662 | 41.1% | 47.3% | 220 | 172 |
| 6–10 | 0.674 | 0.556 | 43.3% | 57.5% | 206 | 132 |
| 11–20 | 0.675 | 0.521 | 42.8% | 61.9% | 203 | 117 |
| 21–40 | 0.669 | 0.488 | 44.6% | 66.8% | 197 | 97 |
| 40+ | 0.416 | 0.429 | 59.3% | 71.9% | 114 | 76 |

The early rows have higher regret for both systems because they are mostly single tasks and short
series, which are harder than the long series that fill the 40+ row. Compare each row's two systems,
not rows with each other. Cold LinUCB is better up to 40 proposals, and slightly worse on regret after
that (+0.011, in all 20 seeds of Run 2).

**Learning speed** (Run 3): LinUCB reaches "6 of the last 10 kept" after a median of 11–13 proposals.
The heuristic needs 16–27. In the single-task scenario only 86% of heuristic students ever reach it,
against 99% for LinUCB.

## 6. What the results mean

- **Why cold LinUCB feels better to students.** It reacts quickly to what a student does. The heuristic's
  table moves slowly (each drag nudges one cell by a small amount), so it keeps proposing the wrong hours
  for a long time. That shows up as higher kept and lower drag for LinUCB.
- **Why cold LinUCB is not clearly closer to the best slot.** Kept is a rough yes/no with a threshold, so it
  exaggerates small improvements. On regret, the gain over the heuristic is small.
- **Night owls gain the most.** The heuristic's default table points at the daytime, so it starts wrong
  for night owls and unlearns slowly. Their regret is 0.61–0.80 with the heuristic and 0.38–0.63 with
  cold LinUCB.
- **Early birds lose with cold LinUCB.** The default table already matches early birds, so the heuristic
  starts almost right. Cold LinUCB starts with nothing and needs a while to find the mornings.
  In their first 10 proposals, stable early birds have regret 0.152 with the heuristic and 0.618 with
  cold LinUCB.
- **The warm start fixes most of this.** It gives LinUCB the same morning bias at the start. Stable early
  birds drop from 0.618 to 0.136 in their first 10 proposals. Stable, planner and erratic early birds go
  from clearly worse than the heuristic to roughly even or better.
- **The warm start also fixes the late slip.** After 40 proposals, cold LinUCB was slightly worse than
  the heuristic (0.428 vs 0.416). Warm LinUCB is clearly better (0.361). The prior makes LinUCB steadier
  over the long run, and this helps almost every type.
- **Early-bird crammers and weekenders stay worse than the heuristic, and all weekenders are only
  partly helped.** Their preferences change with deadlines and with the weekend. A prior that is the
  same every day cannot capture that, and LinUCB's simple model has no weekend-specific shape. This
  needs a different fix, such as a stronger weekend signal for LinUCB.
- **The cost of the warm start: night owls start worse.** The default table favours the daytime, so the
  prior pulls LinUCB toward the day. Stable night owls have regret 0.797 in their first 10 proposals
  with the warm start, against 0.471 cold. That is still far better than the heuristic's 1.147, and after
  40 proposals the warm start is clearly the best (0.274 vs 0.375 cold). Night owls also need a few more
  proposals to reach 60% kept (18.2 vs 15.4).
- **Choosing the strength (n0).** n0 = 2 is gentle and helps everyone a little. n0 = 10 helps early birds
  more but slows night owls and midday students and lowers their kept rate. n0 = 5 is the compromise.
- **Kept barely changes with the warm start** (70% either way). The warm start's gains show up in regret
  and drag.
- **Erratic students stay hard** for every system. They are kept only about half the time.

## 7. Caveats

- The students are invented, and all results depend on how we built them. The early-bird gains exist
  because the simulated early birds match the default table. Real early birds may not.
- Run 1 (the only run with all three systems) is small: 3 seeds × 700 students, about 140 per type, so
  per-type numbers are indicative. The overall picture is the safer reading. A 20-seed rerun with all
  three systems is needed before a launch decision.
- The comparison is as shipped. The heuristic starts with its default table, and LinUCB (cold) starts
  with nothing. A comparison where both start with nothing was not run.
- With many students, even tiny differences look statistically solid. Judge by the size of a difference,
  not only by the 95% range.
- Each system gets its own world, rather than mixing the two inside one student.
- Not modelled: tasks with no free slot (skipped), time zones and daylight saving (UTC only), and the
  pairwise and like/dislike feedback.
- The student model was changed once (night-owl daytime days). Findings that depend on one trait could
  move if the model changes again.
- The alpha sweep (LinUCB's exploration setting) was only run on an earlier version and not repeated.
  The earlier sweep showed no sensitivity, so 0.15 stayed.

## 8. What changed in the code

- LinUCB seeds a cold arm from the default table with n0 = 5 (`LINUCB_PRIOR_N0` in
  `services/bandit/src/core/constants.py`; 0 restores the old behavior). The code is in
  `src/core/prior.py`.
- Both the placement and update endpoints start a cold arm from the same prior, so the state saved after
  the first update keeps it. Arms that already have data are untouched.
- The parameter hash changed (`paramsVersion` `py-5f9d5c31203c` to `py-1ce2e99ca66e`), so old and new
  proposals can be told apart. The contract fixtures were regenerated.
- A check through the production path (300 students, 1 seed) gave regret 0.372, matching the simulation.
- 306 Python tests pass, and ruff and mypy are clean. The backend test suite was not run.
- ADR-0001 has a new section 15, and the bandit README has a note.

## 9. Next steps

- Run the 20-seed study with all three systems.
- Settle the real question with the real A/B test.
- Try a stronger weekend and deadline signal for LinUCB, then rerun.
- Optionally run a both-start-from-nothing comparison.

## 10. Reproduce

Run from `services/bandit/`. All outputs are generated and gitignored.

- Run 2: `uv run python -m scripts.run_seeds --seeds 1-20 --students 1000 --workers 16 --out-dir sim_out/multi-1k`
- Run 3: `uv run python -m src.simulation.run --seed N --students 1000 --workers 16` for N = 1, 2, 3
- Run 1: `scripts/bench_warmstart.py`, summarized in `sim_out/ws-final/summary.md`
