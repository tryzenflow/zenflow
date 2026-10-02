# Benchmark report: heuristic vs LinUCB on simulated students (issue #60)

## Main points

Results come from 20 independent runs ("seeds") of 1,000 simulated students each, 20,000 students in total.

1. **LinUCB's proposals are accepted more often.** The gain is +13.7 percentage points and it held in
   all 20 seeds. Students also drag proposals about 47 minutes less.
2. **LinUCB lands slightly closer to each student's true best slot overall.** The gap to the best
   slot ("regret") is smaller by 0.018 on average, with a 95% confidence range of 0.015–0.021. It
   favoured LinUCB in all 20 seeds. The effect is small.
3. **The overall number hides a split.** LinUCB is much better for night owls and midday students
   with stable habits. It is clearly worse for early birds, and for weekenders in general.
4. **LinUCB wins early and slips later.** It is clearly better after 6 to 40 placements. After 40 it is
   slightly worse on regret (+0.011), while acceptance stays higher.
5. **LinUCB learns faster for most students**, except early birds, who learn slightly slower with it.
6. **Limit:** the students are invented. This checks how the system behaves. It does not prove LinUCB
   is better for real people.

## 1. Question

We have no real users yet, so we cannot run the real A/B test (`docs/scheduler/ab-testing.md`).
Before launch we asked: can LinUCB beat the heuristic, for whom, and how fast does it learn?

## 2. Method

**Policies compared**
- *Heuristic:* picks the free slot that scores best on a weekday × hour preference table. The table
  starts with default guesses (mornings, afternoons and evenings) and updates from what the student does.
- *LinUCB:* a learning model that scores parts of the day using context (deadline, duration, how
  busy the day is, weekend) and improves from feedback.

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
- **Regret** (the main metric) is how much worse a proposal is than the best free slot by the
  student's true preference. Lower is better.
- Other metrics: acceptance (proposal kept), average drag in minutes, and placements needed until
  acceptance first reaches 60%.
- **Scale:** 20 seeds × 1,000 students. Each seed gives one result. We report the average across
  seeds, how much seeds vary, and in how many seeds LinUCB was better. Confidence ranges come from
  resampling the students 2,000 times.
- The run took about 72 minutes on a 16-thread machine (about 3 minutes per seed).

**Steps taken:** read the issue and ADRs; built the simulator in `services/bandit/src/simulation/`;
tested it (matches `/v1/place`, deterministic, statistics checked on known cases); ran a first
75-student study; added the night-owl daytime work after review; ran the 20-seed study; ran the full
checks (282 Python tests, ruff, mypy, TypeScript typecheck), all passing.

## 3. Results

LinUCB minus heuristic. "Seeds LinUCB better" is how many of the 20 runs favoured LinUCB.

| Measure | Average difference | 95% range | Seeds LinUCB better |
| --- | --- | --- | --- |
| Regret (lower is better) | -0.018 | -0.021 to -0.015 | 20 of 20 |
| Proposal kept | +13.7 points | +13.5 to +13.8 | 20 of 20 |
| Average drag | -47 min | -47.5 to -45.6 | 20 of 20 |
| Placements until 60% acceptance | -18.4 | -18.7 to -18.0 | 20 of 20 |

Seed-to-seed variation is small (regret between -0.025 and -0.012), so the overall result is stable.

**By student type** (regret, negative favours LinUCB; all 20 seeds agree unless noted)

| Type | Regret difference | Verdict |
| --- | --- | --- |
| Night owl: stable, crammer, planner, erratic | -0.22 to -0.30 | LinUCB much better |
| Night owl: weekender | +0.006 | tie (LinUCB better in only 8 of 20 seeds) |
| Midday: stable, planner, crammer, erratic | -0.02 to -0.07 | LinUCB slightly better |
| Midday: weekender | +0.14 | LinUCB worse |
| Early bird: stable | +0.021 | LinUCB slightly worse |
| Early bird: erratic, planner | +0.12 to +0.13 | LinUCB worse |
| Early bird: crammer | +0.18 | LinUCB worse |
| Early bird: weekender | +0.30 | LinUCB much worse |

Acceptance still favours LinUCB for every type except early-bird erratic (about equal, -0.3 points).
For early-bird erratic and weekender students LinUCB also needs more dragging (+45 and +10 min).

**By experience (placements so far)**

| Placements | Regret difference | Acceptance difference |
| --- | --- | --- |
| 0–5 | -0.050 (LinUCB better) | +6.1 points |
| 6–10 | -0.119 | +14.4 |
| 11–20 | -0.156 | +19.2 |
| 21–40 | -0.184 | +22.3 |
| 40+ | +0.011 (LinUCB slightly worse) | +12.7 |

The 40+ bucket holds most placements (mainly long series), so it weighs heavily in the overall number.

**By scenario:** LinUCB's regret gain is largest for single tasks (-0.138) and 3-sitting tight series
(-0.064). The one scenario where it is worse is loose 6-sitting series (+0.042). Acceptance favours
LinUCB in every scenario (+11 to +21 points).

**Learning speed:** LinUCB reaches 60% rolling acceptance sooner for night owls (7 to 73 placements
sooner) and midday students (4 to 31 sooner). For early birds it is about the same or slightly slower
(0.6 sooner to 3.8 later).

**Speed of the code** (Windows 11, 16 logical CPUs): a placement takes under 1 ms (0.66 ms for the
heuristic and 0.84 ms for LinUCB in a 1,000-step test).

## 4. Interpretation

- **LinUCB is a modest overall win, driven by who it helps.** The overall regret gain is small, and
  most of it comes from night owls and midday students. Early birds pull the average the other way.
- **Why night owls gain:** the heuristic's default table favours mornings, afternoons and early
  evenings, and it unlearns slowly. LinUCB adapts quickly to a late-night peak, even with the daytime
  days mixed in.
- **Why early birds lose (our guess, untested):** early birds already match the heuristic's defaults,
  so there is little to fix. LinUCB's simple model probably cannot capture their deadline and weekend
  habits, and it aims at the middle of a time band rather than the student's exact hour.
- **Weekenders are a weak spot** for LinUCB in the midday and early-bird groups (regret +0.14 and
  +0.30). A stronger weekend signal for LinUCB is the first thing worth trying.
- **Acceptance and regret differ.** Acceptance only records "kept or dragged", with a threshold, so
  it favours LinUCB almost everywhere, even where regret is worse. Regret is the more reliable measure
  of slot quality. Acceptance is closer to what a user sees.
- **"Heuristic is better when cold" is not supported.** LinUCB is better even in the first 5 placements.
- **The later slip is real but small.** After 40 placements LinUCB is slightly worse on regret
  (+0.011, in all seeds). The heuristic's table catches up once it has seen enough.
- **Alpha:** the earlier 75-student sweep showed no sensitivity (0.15 is fine). It was run before the
  night-owl change and has not been repeated at this scale.

## 5. Caveats

- All results depend on the invented student model. Real users may behave differently.
- The student model has been changed once during this work (night-owl daytime work). Findings that
  depend on one trait, such as the early-bird losses, could move if the model changes again.
- The alpha sweep was not repeated at this scale.
- Each policy gets its own world, rather than a 50/50 mix inside one student.
- Not modelled: displacement and last-resort placement (tasks with no free slot are skipped),
  time zones and daylight saving (UTC only), and the pairwise and like/dislike signals.
- The student counts are large, so even tiny differences show as statistically solid. Judge by the
  size of the difference, not only by the confidence range.

## 6. Next steps

- Settle regret with the real A/B test.
- Try a stronger weekend and deadline signal for LinUCB, then rerun this study.
- Repeat the alpha sweep with the new student model if tuning matters.
- Raw tables: `services/bandit/sim_out/multi-1k/pooled.md` (generated, gitignored). Reproduce with
  `uv run python -m scripts.run_seeds --seeds 1-20 --students 1000 --workers 16 --out-dir sim_out/multi-1k`
  from `services/bandit/`.
