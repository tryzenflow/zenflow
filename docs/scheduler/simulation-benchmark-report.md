# Benchmark report: heuristic vs LinUCB on simulated students (issue #60)

## Main points

1. **LinUCB's proposals are accepted more often.** 72% are kept as proposed, against 58% for the
   heuristic, and students drag them about 58 minutes less. Both differences are statistically solid.
2. **LinUCB is not clearly closer to each student's true best slot.** The gap to the best slot
   ("regret") is a statistical tie overall.
3. **It depends on the student.** LinUCB is much better for night owls and worse for some early birds.
4. **LinUCB learns faster.** It reaches steady acceptance in about 10–12 placements. The heuristic
   needs 13–32.
5. **`BANDIT_ALPHA` barely matters here.** Keep 0.15.
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

**Simulated students.** Each student has two independent traits. That gives 15 types, with 5
students each (75 students):
- *When they work best:* early bird, midday or night owl.
- *How they behave:* stable, erratic, crammer (wants late slots near deadlines), planner (front-loads
  work) or weekender (prefers weekends).

Each student has a hidden true preference for every weekday and hour. It is built so it does not
match either policy's model. Neither can win by design, and tests check this.

**How a student reacts.** Shown a proposal, a student may drag it to a better slot on the same day.
They do so only if the gain is big enough, only with some probability, and with some noise in what
they perceive. A drag is a "move". Leaving the proposal is "retained". Each policy then learns from
the outcome the way it does in production.

**Design**
- Both policies get the same calendar, tasks and random luck for each student, so any difference is
  due to the policy.
- 5 scenarios: a single task, and series of 3 or 6 sittings, each packed loosely or tightly.
- 75 students × 5 scenarios × 60 task arrivals, about 85,000 placements per policy.
- **Regret** (the main metric) is how much worse a proposal is than the best free slot by the
  student's true preference. Lower is better.
- Other metrics: acceptance (proposal kept), average drag in minutes, and placements needed until
  acceptance first reaches 60%.
- The unit of analysis is the student. Confidence ranges come from resampling whole students 2,000 times.
- Alpha sweep: only `BANDIT_ALPHA` (how much LinUCB explores) varied, over 0, 0.05, 0.15 (shipped),
  0.3, 0.6 and 1.0.
- A fixed seed gives identical results. Seeds 2 and 3 were also run.

**Steps taken:** read the issue and ADRs; built the simulator in `services/bandit/src/simulation/`;
tested it (matches `/v1/place`, deterministic, statistics checked on known cases); ran the study, two
extra seeds, the alpha sweep and speed benchmarks; ran the full checks (272 Python tests, ruff, mypy,
TypeScript typecheck), all passing.

## 3. Results

LinUCB vs heuristic, seed 1. Ranges are 95% confidence ranges.

| Measure | Heuristic | LinUCB | Difference |
| --- | --- | --- | --- |
| Regret (lower is better) | 0.482 | 0.462 | -0.019 (-0.070 to +0.031): **no clear difference** |
| Proposal kept | 58.1% | 72.1% | +14.0 points (+11.9 to +16.2): **LinUCB better** |
| Average drag | 133 min | 75 min | -58 min (-78 to -41): **LinUCB better** |

Seeds 2 and 3 agree: regret still shows no clear difference (-0.042 and -0.012), and acceptance is
+14.4 and +13.3 points.

**By student type** (regret, negative favours LinUCB)
- Night owls: LinUCB better, by -0.26 (stable), -0.43 (erratic) and -0.28 (crammer).
- Early birds with context-driven habits (crammer, erratic, planner, weekender): LinUCB worse, by +0.19 to +0.29.
- Midday students: mostly a tie. Midday weekenders are slightly worse (+0.07).

**By experience (placements so far)**
- 0–5: no clear regret difference. Acceptance is already +6 points for LinUCB.
- 6–40: LinUCB better (regret -0.18 to -0.24, acceptance +17 to +24 points).
- 40+: regret is a tie. Acceptance is still +13 points. This bucket is 82% of all placements, mostly
  from long series.

**By scenario:** LinUCB's regret gain is largest for single tasks (-0.22). Its only regret loss is
loose 6-sitting series (+0.075).

**Learning speed:** acceptance over the last 10 placements first reaches 60% after a median of 10–12
placements for LinUCB (10 is the fastest possible) and 13–32 for the heuristic. In the single-task
scenario, 87% of heuristic students ever reach it, against 100% for LinUCB.

**Alpha sweep:** the regret difference stays between -0.032 and +0.011 for every alpha, and every
range includes zero. Acceptance moves by at most 1 point. Alpha 0 (no exploration) does no worse
than 0.15.

**Speed** (Windows 11, 16 logical CPUs)
- 1,000 slot searches: 0.16 s.
- 1,000 full place, react and learn steps: 0.66 s (heuristic) and 0.84 s (LinUCB).
- Full study: 17.7 s with 8 workers, 73 s with 1. Alpha sweep: 75 s. A repeated run is served from cache.

## 4. Interpretation

- **Acceptance and regret tell different stories.** Acceptance only records "kept or dragged", with a
  threshold, so it is a noisy proxy. Regret measures distance to the best slot. So LinUCB feels better
  to students, but we cannot claim it picks better slots.
- **LinUCB's gain comes from fixing bad starting guesses.** The heuristic's default table suits early
  birds but not night owls, and it unlearns slowly. LinUCB adapts quickly, so it wins for night owls.
- **LinUCB's losses are probably from limited detail.** Early birds already match the heuristic's
  defaults, so there is little to fix. Our guess is that LinUCB's simple model cannot capture
  deadline and weekend patterns, and it aims at the middle of a time band rather than the student's
  exact hour. We have not tested this cause.
- **"Heuristic is better when cold" is not supported.** LinUCB is not worse even at 0–5 placements.
- **Alpha: no change needed.** Results do not depend on it, though real users may differ.
- **Speed is not a concern.** A placement takes under 1 ms in the simulator.

## 5. Caveats

- All results depend on the invented student model.
- Each of the 15 types has only 5 students, so per-type rows are hints, not proof.
- The 40+ bucket reflects long series more than long-lived users.
- Each policy gets its own world, rather than a 50/50 mix inside one student.
- Not modelled: displacement and last-resort placement (tasks with no free slot are skipped),
  time zones and daylight saving (UTC only), and the pairwise and like/dislike signals.

## 6. Next steps

- Scale the study (many more students and seeds) to firm up the per-type findings.
- Settle regret with the real A/B test.
- If the early-bird losses show up with real users, try richer context for LinUCB.
