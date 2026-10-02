# Benchmark report: heuristic vs LinUCB on simulated students (issue #60)

## Main points

1. **LinUCB's proposals are kept more often.** 70% of LinUCB's proposals are kept as proposed, against
   56% for the heuristic. Students drag them 84 minutes on average, against 130.
2. **LinUCB is slightly closer to the best slot overall.** Average regret is 0.447 for LinUCB and
   0.463 for the heuristic. The gap is small but consistent across 20 seeds.
3. **The overall number hides a split.** LinUCB is much better for night owls and for midday students
   with stable habits. It is worse for early birds and for weekenders.
4. **LinUCB wins early and slips later.** It is clearly better between 6 and 40 placements and slightly
   worse after 40 on regret. It still keeps a higher acceptance rate.
5. **LinUCB learns faster for most students.** It reaches steady acceptance in a median of 11–13
   placements, against 16–27 for the heuristic.
6. **Setup:** this compares the two policies as shipped. The heuristic starts from the default
   preference table, and LinUCB starts with no knowledge. Part of the early-bird result is the table
   fitting early birds, not LinUCB being a weaker algorithm.
7. **Limit:** the students are invented. This checks how the system behaves. It does not prove LinUCB
   is better for real people.

## 1. How to read the metrics

All numbers are per proposal the system makes, then averaged over students.

| Metric | What it means | Better is |
| --- | --- | --- |
| **Regret** | How much worse the proposed slot is than the best free slot for that student, using the student's hidden true preference. 0 means the proposal was the best slot. Units are the simulator's utility units. | lower |
| **Acceptance** (proposal kept) | The share of proposals the student leaves alone instead of dragging. It is what a user sees as "the app got it right". It is a noisy proxy, because a student also leaves slots that are only good enough. | higher |
| **Drag** | How many minutes the student moves a proposal, counting 0 when they keep it. It measures effort wasted on corrections. | lower |
| **Placements to 60%** (time-to-threshold) | How many proposals it takes until the student has kept at least 6 of the last 10. It measures how fast a policy gets useful for a new student. 10 is the minimum possible. | lower |
| **Reached 60%** | The share of students who ever reach that level within their 60 arrivals. | higher |
| **Divergence** | The share of paired placements where the two policies chose different start times. | (neutral) |
| **Cold-start bucket** | The student's experience: how many proposals they had already seen (0–5, 6–10, 11–20, 21–40, 40+). It shows how a policy behaves as it learns. | n/a |
| **Seeds LinUCB better** | In how many of the repeat runs ("seeds") the policy difference pointed LinUCB's way. A repeat run uses a new set of random students. | higher |
| **95% range** | The range the true difference very likely lies in. If it excludes 0, the difference is real and not luck. | n/a |

**Regret and acceptance can disagree.** Regret measures distance to the best slot. Acceptance
measures whether a student bothered to move. A slot that is good enough but not best counts as a
win for acceptance and a loss for regret. For slot quality, trust regret. For what the user feels,
look at acceptance and drag.

## 2. Method

**Policies compared (as shipped)**
- *Heuristic:* picks the free slot that scores best on a weekday × hour preference table. The table
  **starts with default guesses** (mornings, afternoons and evenings) and updates from what the student does.
- *LinUCB:* a learning model that **starts with no knowledge** and scores parts of the day using
  context (deadline, duration, how busy the day is, weekend). It improves from feedback.

Both run the real production code. A test confirms the simulator picks the same slots as `/v1/place`.

**Simulated students.** Each student has two independent traits, which gives 15 types:
- *When they work best:* early bird, midday or night owl.
- *How they behave:* stable, erratic, crammer (wants late slots near deadlines), planner (front-loads
  work) or weekender (prefers weekends).

Each student has a hidden true preference for every weekday and hour. It is built so it does not
match either policy's model. Neither can win by design, and tests check this.

**Night owls still work in the daytime.** Night owls prefer late hours, but on some days they have
classes, exam prep or deadline pressure, and daytime slots become acceptable or preferred. This is
random per student and per day. On other days the late-night peak stays. Both policies see the same
pull days.

**How a student reacts.** Shown a proposal, a student may drag it to a better slot on the same day.
They do so only if the gain is big enough, only with some probability, and with some noise in what
they perceive. A drag is a "move". Leaving the proposal is "retained". Each policy then learns from
the outcome the way it does in production.

**Design**
- Both policies get the same calendar, tasks and random luck for each student, so any difference is
  due to the policy.
- 5 scenarios: a single task, and series of 3 or 6 sittings, each packed loosely or tightly. Each
  student does 60 task arrivals per scenario.
- **Two studies:**
  - *Study A, differences:* 20 seeds × 1,000 students (20,000 students). It gives the LinUCB − heuristic
    difference with its 95% range and how many seeds agree.
  - *Study B, absolute values:* 3 seeds × 1,000 students (3,000 students), using the same code.
    It gives the heuristic's and LinUCB's own values, averaged over the 3 seeds. About 1.14 million
    placements per policy per seed.
- Study B's differences match Study A's (for example regret -0.016 against -0.018), so the two are consistent.
- Steps taken: read the issue and ADRs; built the simulator; tested it (matches `/v1/place`,
  deterministic, statistics checked on known cases); ran a first 75-student study; added the night-owl
  daytime work after review; ran Studies A and B; ran the full checks (282 Python tests, ruff, mypy,
  TypeScript typecheck), all passing.

## 3. Results: both policies side by side

### 3.1 Overall (Study B, 3 seeds × 1,000 students)

| Metric | Heuristic | LinUCB | Difference (Study A, 20 seeds) |
| --- | --- | --- | --- |
| Regret | 0.463 | 0.447 | -0.018 (95% range -0.021 to -0.015), 20 of 20 seeds |
| Proposal kept | 56.4% | 70.1% | +13.7 points (+13.5 to +13.8), 20 of 20 |
| Average drag | 130 min | 84 min | -47 min (-47.5 to -45.6), 20 of 20 |
| Placements to 60% | see 3.5 | see 3.5 | -18.4 (-18.7 to -18.0), 20 of 20 |
| Divergence | 97.8% of paired placements differ (mean gap 972 min). Mostly because the two simulated calendars drift apart, so it is not disagreement on identical input. | | |

### 3.2 By scenario (Study B)

| Scenario | Placements | Regret H | Regret L | Kept H | Kept L | Drag H (min) | Drag L (min) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| single task | 60,000 | 0.774 | 0.634 | 44.6% | 65.3% | 178 | 85 |
| 3 sittings, loose | 180,000 | 0.548 | 0.523 | 52.7% | 71.0% | 147 | 82 |
| 3 sittings, tight | 179,724 | 0.412 | 0.348 | 54.0% | 66.4% | 130 | 84 |
| 6 sittings, loose | 359,999 | 0.476 | 0.520 | 59.1% | 72.4% | 124 | 83 |
| 6 sittings, tight | 357,161 | 0.382 | 0.353 | 58.7% | 69.9% | 121 | 85 |

(H = heuristic, L = LinUCB.) Study A's regret differences by scenario: single -0.138, 3 loose -0.033,
3 tight -0.064, 6 loose **+0.042**, 6 tight -0.028. Loose 6-sitting series is the only scenario where
LinUCB has the worse regret.

### 3.3 By experience (Study B)

| Placements so far | Placements | Regret H | Regret L | Kept H | Kept L | Drag H (min) | Drag L (min) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0–5 | 30,000 | 0.712 | 0.662 | 41.1% | 47.3% | 220 | 172 |
| 6–10 | 24,999 | 0.674 | 0.556 | 43.3% | 57.5% | 206 | 132 |
| 11–20 | 49,993 | 0.675 | 0.521 | 42.8% | 61.9% | 203 | 117 |
| 21–40 | 99,979 | 0.669 | 0.488 | 44.6% | 66.8% | 197 | 97 |
| 40+ | 931,914 | 0.416 | 0.429 | 59.3% | 71.9% | 114 | 76 |

Study A's regret differences: 0–5 -0.050, 6–10 -0.119, 11–20 -0.156, 21–40 -0.184, 40+ **+0.011**
(LinUCB slightly worse, in every seed). The 40+ bucket holds 82% of all placements, mostly from long
series, so it carries most of the overall average.

The early buckets have high regret for both policies. Those placements come mostly from single tasks
and short series, which are harder than the long series that fill the 40+ bucket. Do not read the drop
from the early buckets to 40+ as "learning". Read across each row instead.

### 3.4 By student type (Study B; about 200 students per type across the 3 seeds)

| Type | Regret H | Regret L | Kept H | Kept L | Drag H (min) | Drag L (min) |
| --- | --- | --- | --- | --- | --- | --- |
| night owl, stable | 0.630 | 0.379 | 47.0% | 74.4% | 253 | 88 |
| night owl, crammer | 0.795 | 0.546 | 46.3% | 71.4% | 246 | 89 |
| night owl, planner | 0.703 | 0.480 | 52.1% | 78.2% | 217 | 60 |
| night owl, erratic | 0.729 | 0.430 | 44.3% | 48.3% | 243 | 184 |
| night owl, weekender | 0.613 | 0.629 | 57.2% | 76.5% | 169 | 62 |
| midday, stable | 0.336 | 0.272 | 58.0% | 74.8% | 86 | 52 |
| midday, planner | 0.370 | 0.350 | 60.5% | 74.5% | 76 | 52 |
| midday, crammer | 0.388 | 0.360 | 55.3% | 68.2% | 94 | 69 |
| midday, erratic | 0.412 | 0.395 | 48.6% | 50.1% | 126 | 135 |
| midday, weekender | 0.411 | 0.550 | 58.8% | 71.5% | 73 | 57 |
| early bird, stable | 0.239 | 0.261 | 69.0% | 82.3% | 70 | 47 |
| early bird, planner | 0.290 | 0.409 | 71.7% | 81.3% | 53 | 50 |
| early bird, crammer | 0.380 | 0.562 | 59.8% | 72.7% | 80 | 86 |
| early bird, erratic | 0.333 | 0.460 | 49.2% | 48.9% | 121 | 165 |
| early bird, weekender | 0.321 | 0.624 | 68.6% | 78.1% | 48 | 59 |

Study A's regret differences (LinUCB − heuristic), same in all 20 seeds unless noted:
night owls -0.22 to -0.30 (weekender +0.006, a tie, LinUCB better in 8 of 20 seeds); midday -0.02 to
-0.07 (weekender **+0.14**); early birds **+0.02 to +0.30** (stable +0.021, planner +0.122,
erratic +0.131, crammer +0.177, weekender +0.303).

### 3.5 Learning speed (Study B)

Placements until the student has kept at least 6 of the last 10 proposals.

| Scenario | Students reaching 60%: H | L | Median placements: H | L |
| --- | --- | --- | --- | --- |
| single task | 86% | 99% | 27 | 11 |
| 3 sittings, loose | 100% | 100% | 24 | 12 |
| 3 sittings, tight | 100% | 100% | 16 | 11 |
| 6 sittings, loose | 100% | 100% | 24 | 13 |
| 6 sittings, tight | 100% | 100% | 19 | 13 |

Study A's average gap over all students is -18.4 placements (LinUCB reaches it sooner). By type, LinUCB
is sooner for night owls (7 to 73 placements) and midday students (4 to 31) and slightly later for
most early birds (up to 3.8 placements).

**Speed of the code** (Windows 11, 16 logical CPUs): a placement takes under 1 ms in the simulator
(0.66 ms heuristic, 0.84 ms LinUCB in a 1,000-step test). A 1,000-student seed with both policies
took about 3 minutes.

## 4. What the results mean

- **LinUCB is a modest overall win, driven by who it helps.** The regret gain is small (0.447 vs 0.463).
  Night owls and stable midday students gain a lot. Early birds and weekenders lose, which pulls the
  average back.
- **Why night owls gain:** the heuristic's default table favours mornings, afternoons and early
  evenings, so it starts wrong for night owls and unlearns slowly. Its night-owl regret is 0.61–0.80,
  the worst of any group. LinUCB adapts quickly, so its night-owl regret falls to 0.38–0.63.
- **Why early birds lose (our guess, not tested):** the heuristic's default table already matches early
  birds, so it starts near the right answer. LinUCB starts with nothing. Its simple model also probably
  misses deadline and weekend habits, and it aims at the middle of a time band rather than the
  student's exact hour.
- **Weekenders are LinUCB's weak spot** for early-bird and midday students (regret +0.30 and +0.14).
  A stronger weekend signal for LinUCB is the first thing worth trying.
- **Acceptance favours LinUCB almost everywhere, even where regret is worse.** For early-bird weekenders
  LinUCB is kept 78% of the time against 69%, yet its regret is 0.62 against 0.32. Students leave
  proposals that are good enough but not best. That is why regret is the more reliable measure.
- **"Heuristic is better when cold" is not supported.** In the first 5 placements LinUCB already has
  lower regret (0.662 vs 0.712) and a higher kept rate (47% vs 41%).
- **The slip after 40 placements is real but small.** LinUCB's regret is 0.429 vs 0.416 (+0.011, in all
  20 seeds). By then the heuristic's table has learned enough to catch up. LinUCB still keeps a
  higher acceptance rate (72% vs 59%).
- **Erratic students are hard for everyone.** Both policies are kept only about half the time, and
  LinUCB drags more than the heuristic for early-bird and midday erratic students.
- **Alpha:** the earlier 75-student sweep showed no sensitivity (0.15 is fine). It ran before the
  night-owl change and has not been repeated at this scale.

## 5. Caveats

- All results depend on the invented student model. Real users may behave differently.
- The student model was changed once during this work (night-owl daytime work). Findings that depend on
  one trait, such as the early-bird losses, could move if the model changes again.
- The comparison is as shipped: the heuristic has a head start from its default table. A comparison where
  both start with no knowledge was not run.
- Study B has about 200 students per type, so the per-type absolute values are indicative. The per-type
  differences come from Study A (about 1,300 students per type).
- With this many students, even tiny differences look statistically solid. Judge by the size of the
  difference, not only the 95% range.
- Each policy gets its own world, rather than a 50/50 mix inside one student.
- Not modelled: displacement and last-resort placement (tasks with no free slot are skipped), time zones
  and daylight saving (UTC only), and the pairwise and like/dislike signals.

## 6. Next steps

- Settle regret with the real A/B test.
- Try a warm-start prior and a stronger weekend and deadline signal for LinUCB, then rerun this study.
- Repeat the alpha sweep with the new student model if tuning matters.
- Raw data: Study A is `services/bandit/sim_out/multi-1k/pooled.md`
  (`uv run python -m scripts.run_seeds --seeds 1-20 --students 1000 --workers 16 --out-dir sim_out/multi-1k`).
  Study B is three per-seed reports from
  `uv run python -m src.simulation.run --seed N --students 1000 --workers 16` for N = 1, 2, 3.
  All are generated and gitignored, run from `services/bandit/`.
