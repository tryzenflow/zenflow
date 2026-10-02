# Report: starting LinUCB with a warm-start prior (issue #60)

This follows `simulation-benchmark-report.md`. That report found LinUCB better overall but worse than the
heuristic for early birds, for weekenders, and slightly worse after 40 placements. We tested one fix: let
LinUCB start with a little prior knowledge instead of none.

## Main points

1. **A warm start improves LinUCB overall.** Average regret falls from 0.447 to 0.377 (lower is better).
   The heuristic is at 0.463. Average drag falls from 84 to 72 minutes. The share of proposals kept stays at about 70%.
2. **The slip after 40 placements disappears.** LinUCB's regret at 40+ placements goes from 0.428 (worse
   than the heuristic's 0.416) to 0.361 (better).
3. **Early birds improve, but only part of the way.** Stable, erratic and planner early birds go from
   clearly worse than the heuristic to roughly equal or better. Crammer and weekender early birds are still clearly worse.
4. **Weekenders are not fixed.** The prior has no weekend information. This needs a different fix.
5. **The cost: night owls start worse.** In their first 10 placements, night owls get worse proposals
   than cold LinUCB gives them. They still beat the heuristic by a wide margin there.
6. **Recommended strength: 5 pseudo-observations ("n0 = 5").** Stronger priors help early birds more
   but hurt night owls and midday students.
7. **Limit:** the students are invented, and these runs are smaller than the main study (see Caveats).

## 1. The idea in plain language

LinUCB normally starts knowing nothing about a student. It has to try different times of day before it
can say which ones work. The heuristic starts with a default preference table: mornings, afternoons and
evenings score well, late night scores poorly.

A **warm start** gives LinUCB a small head start from that same default table. We add a few
"pretend" past proposals, called **pseudo-observations**, before the student's first real one:

- Go through every cell of the default table (7 weekdays × 24 hours).
- Each cell belongs to one time-of-day band, which is one LinUCB arm. For example 8:00 belongs to the morning arm.
- For each cell, record a pretend observation on that arm. The pretend context is a typical day, with the
  weekend flag set for Saturday and Sunday. The pretend reward is the cell's table value.
- Each arm's pretend observations add up to a total weight called **n0**. Larger n0 means a stronger prior.

Real feedback replaces the prior over time. After n0 real observations, the prior and the data count
equally. After many more, the prior has almost no effect. With n0 = 0, LinUCB behaves exactly as before.

## 2. How to read the metrics

All numbers are per proposal the system makes, averaged over students.

| Metric | What it means | Better is |
| --- | --- | --- |
| **Regret** | How much worse the proposed slot is than the best free slot for that student, by the student's hidden true preference. 0 means the proposal was the best slot. | lower |
| **Kept** (acceptance) | The share of proposals the student leaves alone instead of dragging. A noisy proxy: a student also keeps slots that are only good enough. | higher |
| **Drag** | Minutes the student moves a proposal, counting 0 when they keep it. | lower |
| **Placements to 60%** | Proposals needed until the student has kept at least 6 of the last 10. It shows how fast the system becomes useful for a new student. 10 is the minimum possible. | lower |
| **First 10 / 40+ placements** | Regret over the student's first 10 proposals, and over proposals after the 40th. They show the start and the late stage. | lower |

Regret measures slot quality. Kept and drag measure what the user feels. They can disagree.

## 3. Method

- **Setup:** the same simulator and 15 student types as `simulation-benchmark-report.md`. Types combine
  when students work best (early bird, midday, night owl) with how they behave (stable, erratic, crammer,
  planner, weekender). Night owls also have some daytime study days.
- **Policies compared, as shipped:**
  - the heuristic, which starts from the default table;
  - LinUCB, cold (the current behavior);
  - LinUCB with a warm start at n0 = 2, 5 and 10.
- **Fair comparison:** every policy sees the same students, calendars, tasks and random luck.
- **Size:** 3 seeds × 700 students, about 140 students per type. An exploration round of 300 students
  tried other prior designs first.
- **Steps taken:** wrote the warm start in the simulator only; ran a design exploration; ran the final
  comparison; checked that the simulator with the prior switched off gives identical results to before;
  ran the checks (290 Python tests, ruff and mypy, all passing).
- **Prior designs tried:** four versions of the pretend reward. The one using the default table's values
  directly worked best, so we use it. A version with reward 0 for every arm (no preference) was clearly
  weaker, so the preference information matters and the gain is not only "less exploring".

## 4. Results

H = heuristic, Cold = current LinUCB, W2 / W5 / W10 = warm start with n0 = 2 / 5 / 10.

### 4.1 Overall

| Metric | H | Cold | W2 | W5 | W10 |
| --- | --- | --- | --- | --- | --- |
| Regret | 0.463 | 0.447 | 0.388 | **0.377** | **0.377** |
| Kept | 56.4% | 70.0% | 70.0% | 69.8% | 69.1% |
| Drag (min) | 130 | 84 | 74 | **72** | 73 |
| Placements to 60% | 34.4 | 16.1 | 16.3 | 16.4 | 17.0 |
| Regret, first 10 placements | 0.694 | 0.616 | 0.567 | **0.566** | 0.573 |
| Regret, 40+ placements | 0.416 | 0.428 | 0.373 | 0.361 | **0.358** |

### 4.2 Regret by student type (lower is better)

| Type | H | Cold | W2 | W5 | W10 |
| --- | --- | --- | --- | --- | --- |
| night owl, stable | 0.629 | 0.376 | 0.309 | 0.303 | 0.310 |
| night owl, crammer | 0.798 | 0.552 | 0.414 | 0.394 | 0.407 |
| night owl, planner | 0.704 | 0.474 | 0.360 | 0.340 | 0.367 |
| night owl, erratic | 0.731 | 0.431 | 0.437 | 0.452 | 0.478 |
| night owl, weekender | 0.610 | 0.628 | 0.597 | 0.610 | 0.623 |
| midday, stable | 0.335 | 0.270 | 0.253 | 0.264 | 0.288 |
| midday, planner | 0.369 | 0.346 | 0.319 | 0.328 | 0.340 |
| midday, crammer | 0.386 | 0.363 | 0.327 | 0.335 | 0.346 |
| midday, erratic | 0.409 | 0.399 | 0.385 | 0.377 | 0.377 |
| midday, weekender | 0.412 | 0.548 | 0.495 | 0.479 | 0.466 |
| early bird, stable | 0.240 | 0.259 | 0.229 | 0.211 | 0.202 |
| early bird, planner | 0.292 | 0.417 | 0.300 | 0.264 | 0.242 |
| early bird, erratic | 0.330 | 0.461 | 0.393 | 0.372 | 0.359 |
| early bird, crammer | 0.383 | 0.563 | 0.494 | 0.461 | 0.429 |
| early bird, weekender | 0.320 | 0.614 | 0.506 | 0.457 | 0.420 |

### 4.3 Regret at the start and later (n0 = 5 vs the others)

| Type | First 10: H | Cold | W5 | 40+: H | Cold | W5 |
| --- | --- | --- | --- | --- | --- | --- |
| night owl, stable | 1.147 | 0.471 | 0.797 | 0.523 | 0.375 | 0.274 |
| night owl, crammer | 1.465 | 0.692 | 1.101 | 0.660 | 0.546 | 0.340 |
| night owl, planner | 1.147 | 0.492 | 0.843 | 0.613 | 0.486 | 0.300 |
| night owl, erratic | 1.139 | 0.580 | 0.905 | 0.653 | 0.406 | 0.408 |
| night owl, weekender | 0.869 | 0.655 | 0.787 | 0.554 | 0.622 | 0.586 |
| midday, stable | 0.674 | 0.458 | 0.464 | 0.277 | 0.255 | 0.249 |
| midday, planner | 0.674 | 0.481 | 0.465 | 0.317 | 0.334 | 0.322 |
| midday, crammer | 0.748 | 0.486 | 0.535 | 0.325 | 0.348 | 0.321 |
| midday, erratic | 0.669 | 0.556 | 0.540 | 0.370 | 0.370 | 0.355 |
| midday, weekender | 0.674 | 0.660 | 0.565 | 0.362 | 0.526 | 0.472 |
| early bird, stable | 0.152 | 0.618 | 0.136 | 0.246 | 0.238 | 0.223 |
| early bird, planner | 0.149 | 0.699 | 0.159 | 0.307 | 0.386 | 0.281 |
| early bird, erratic | 0.179 | 0.750 | 0.302 | 0.346 | 0.425 | 0.373 |
| early bird, crammer | 0.384 | 0.870 | 0.467 | 0.371 | 0.519 | 0.454 |
| early bird, weekender | 0.341 | 0.777 | 0.422 | 0.318 | 0.586 | 0.457 |

### 4.4 Kept, drag and learning speed by type (H vs Cold vs W5)

| Type | Kept H | Cold | W5 | Drag H (min) | Cold | W5 | To 60% H | Cold | W5 |
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

## 5. What the results mean

- **The warm start mostly fixes the late stage.** After 40 placements, cold LinUCB lost slightly to the
  heuristic. With the prior it wins (0.361 vs 0.416). The prior makes LinUCB less jumpy in the long run,
  and that helps in nearly every type.
- **It helps early birds because their preferences match the default table.** The table points at
  mornings, so a warm LinUCB starts in the right place. That removes most of the early-bird start problem:
  stable early birds have regret 0.136 in their first 10 placements with the prior, against 0.618 cold
  (the heuristic: 0.152).
- **Early-bird crammers and weekenders remain worse than the heuristic.** Their needs depend on deadlines
  and weekends. A prior that is the same every day cannot capture that, and LinUCB's simple model has no
  weekend-specific shape. This is a modelling issue, not a starting-point issue.
- **Why night owls start worse:** the default table favours the daytime, so the prior pulls LinUCB toward
  mornings and afternoons. In their first 10 placements stable night owls have regret 0.797 with the
  prior, against 0.471 cold. Even so, it is far better than the heuristic's 1.147, and after 40
  placements the prior is clearly better than cold (0.274 vs 0.375). Night owls also take longer to reach 60%
  kept (18.2 vs 15.4 placements for stable).
- **Strength trade-off:** n0 = 2 is gentle and helps everyone a little. n0 = 10 helps early birds more but
  slows night owls and midday students and lowers their kept rate. n0 = 5 is the compromise, and its
  overall regret equals n0 = 10.
- **Kept rate barely moves (70% to 70%).** The gains show up in regret and drag, not in how often
  students keep a proposal.
- **Erratic students stay hard** for every policy.

## 6. Caveats

- The students are invented. The early-bird gain exists because the simulated early birds match the default
  table. Real early birds may not.
- This is 3 seeds × 700 students, much smaller than the 20-seed study (20,000 students) behind the main
  report. Each type has only about 140 students. Per-type numbers are indicative, and the overall
  picture is the safer reading.
- Only the simplest prior designs were tried. A prior that also knows about weekends or deadlines might do better.
- The prior is built from the default table. It does not use a student's own learned table.
- A full 20-seed rerun is needed before a launch decision.

## 7. Production change

LinUCB now seeds a cold arm from the default table as described in section 1, with n0 = 5
(`LINUCB_PRIOR_N0` in `services/bandit/src/core/constants.py`; 0 restores the old cold start).

- **Code:** `src/core/prior.py` loops over the 168 table cells and adds a weighted pseudo-observation to the
  arm that owns each hour. Both `/v1/place` and `/v1/update` start a cold arm from the same prior, so the
  state saved after the first update keeps it. Arms that already have data are untouched.
- **Version:** the parameter hash `paramsVersion` changed (`py-5f9d5c31203c` to `py-1ce2e99ca66e`), so
  proposals from before and after are told apart.
- **Fixtures:** the `/v1/place` contract fixtures were regenerated. Cold LinUCB scores changed
  (for example 0.314 to 0.700 in one case), but the chosen slot did not.
- **Check through the production path:** 300 students, 1 seed: regret 0.372 for warm LinUCB, against
  0.447 cold and 0.464 for the heuristic. This agrees with the prototype.
- **Tests:** 306 Python tests pass, ruff and mypy are clean.
- **Docs:** ADR-0001 has a new section 15, and the bandit README has a short note.
- **Not done:** the backend test suite was not run, and the 20-seed rerun is still pending.
