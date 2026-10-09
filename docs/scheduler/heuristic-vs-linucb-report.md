# Report: heuristic vs LinUCB

**Context.** Zenflow is a study planner. When a student adds a task, the app proposes a time slot for it.
The student can keep the proposal or drag it to another time. Each drag tells the app what the student
prefers.

We compared two ways of choosing the slot, using simulated students:

1. **Heuristic:** a rule-based method with a table of favourite hours that learns from drags.
2. **LinUCB:** a learning method that starts knowing nothing about the time bands. (LinUCB is a standard
   "contextual bandit" algorithm: it tries options, watches the reward, and shifts toward what works.) It
   reads the same favourite-hours table to choose the hour inside a time band, which also keeps its first
   proposals in the default study hours.

**Terms used below.**

- *Proposal:* one slot the app suggests for one task. The student keeps it or drags it.
- *Favourite-hours table:* one liking score per weekday and hour (7 × 24), shared by both methods.
- *Band:* one of six parts of the day that LinUCB learns about separately (section 2).
- *Regret:* how much worse the proposed slot is than the best free slot, in the student's own taste.
- *Kept:* the share of proposals the student does not move.

## 1. The answer in short

| | Heuristic | LinUCB |
| --- | --- | --- |
| Average regret (how far from the best slot; lower is better) | ***0.390*** | 0.401 |
| Proposals the student keeps (higher is better) | 60.6% | ***69.9%*** |
| Minutes the student drags a proposal, per proposal (lower is better) | 103 | ***75*** |
| Proposals needed until it feels reliable (lower is better) | 29.3 | ***17.7*** |

(Exact definitions of every metric are in section 3.)

- **LinUCB keeps more proposals and needs less dragging.**
  - 70% of its proposals are kept, against 61%.
  - Students move them 27 minutes less per proposal.
  - It becomes reliable after 18 proposals instead of 29.
- **LinUCB is not closer to the best slot overall.** Its regret is slightly higher (0.401 vs 0.390). The
  heuristic is strong because its table also learns quickly (section 2).
- **LinUCB wins clearly for night owls** (regret 0.31 to 0.44 vs 0.47 to 0.58, except weekenders) and in the
  first 10 proposals for night owls and midday students. It loses for early birds, weekenders and most midday students once
  the heuristic's table has caught up.
- **Confidence:** these are 20 seeds × 700 students with 95% confidence intervals (section 5.1). The
  intervals are narrow, so the overall ordering is solid. Judge a difference by its size, not by whether it
  is "significant".
- **Limit:** the students are invented. The results show how the systems behave, not that real people
  will see the same.

## 2. The two systems

**Heuristic.**

- Keeps a table with one liking score for each hour of each weekday (7 × 24 cells).
- The table starts from defaults:
  - 09:00-12:00 scores 1.0, 14:00-17:00 scores 0.5, 19:00-22:00 scores 0.2, and every other hour 0.
  - Saturday and Sunday use the same hour scores as weekdays.
- It proposes the free slot with the best score.
- When the student drags a proposal, the table shifts toward the new hour (learning rate 0.2). When the
  student keeps a proposal, its hour gains a quarter of that.

**LinUCB.**

- Splits the day into 6 time bands: 00-08, 08-12, 12-14, 14-18, 18-22 and 22-24. No band that students
  commonly use starts before 08:00.
- Keeps one small model per band that predicts how much the student will like a task placed in that
  band. The prediction uses:
  - days until the deadline,
  - the task's length,
  - how busy the day is,
  - whether it is a weekend.
- Every free slot gets a score:

  ```text
  score = (band prediction + 0.15 × uncertainty) + 1.0 × favourite-hours table value of the slot
  ```

  - The first part is flat inside a band, so it picks the band. The table term picks the hour inside the
    band and lets a student who keeps moving tasks to 10:00 get 10:00. It uses the same table and the same
    learning as the heuristic.
  - The uncertainty bonus is larger for bands it knows little about, so it tries different bands early.
- After each proposal it updates the band's model from the student's reaction. The reward is +1 when the
  proposal is kept, and minus (minutes dragged ÷ 240), capped at -1, when it is dragged.
- It starts with no knowledge of the bands. All bands tie at the start, so the table alone puts the first
  proposals at 09:00-12:00.

## 3. How to read the numbers

- All numbers are per proposal, averaged over students.
- In every table, ***bold italic*** marks the best value in its row (or in its column group for the wide
tables). Ties are both marked.

A **proposal** is one slot the system suggests for one task (or one sitting of a multi-sitting task).
The formulas below use these symbols for proposal *i*:

- *U(slot)* is the student's hidden utility of a slot: a unitless "how much would this student like to study
then" score. A student's ideal hour scores about 1, ordinary hours less, and sleeping hours below 0.
- *best* is the free slot with the highest *U* inside the task's allowed window (the "oracle", which only the
simulator can see).
- *proposed* is the slot the system suggested. *moved(i)* is the number of minutes the student dragged it
(0 if kept).


| Metric                     | Formula                                                                                                                                                                                                          | In plain words                                                                                                                                                                                       | Better is |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **Regret**                 | mean over proposals of `U(best) - U(proposed)`                                                                                                                                                                   | How much worse the proposed slot is than the best free slot, in the student's own taste. 0 means the proposal was the best slot.                                                                     | lower     |
| **Kept**                   | `(number of proposals with moved = 0) / (number of proposals)`                                                                                                                                                   | The share of proposals the student leaves alone. It is what a user feels as "the app got it right". It is a rough measure: a student also keeps slots that are only good enough.                     | higher    |
| **Drag**                   | mean over proposals of `moved(i)`, in minutes                                                                                                                                                                    | How far the student moves a proposal on average. A kept proposal counts as 0, so it is a per-proposal average, not an average over dragged ones.                                                     | lower     |
| **Proposals to reach 60%** | for each student and scenario: the first proposal number `n >= 10` where `(kept among proposals n-9 .. n) / 10 >= 0.6`; if that never happens, the number of placements in the run (60 for single tasks; more when multi-sitting series add placements, hence averages above 60). Then averaged over students and scenarios. | How many proposals pass before the student has kept at least 6 of the last 10. It shows how fast the system becomes useful to a new student. 10 is the fastest possible, a value equal to the run's placement count means "never got there". | lower     |
| **First 10**               | regret, using only proposals 1 to 11 of a student's run                                                                                                                                                          | Regret while the system knows almost nothing about the student.                                                                                                                                      | lower     |
| **40+**                    | regret, using only proposals 42 and later                                                                                                                                                                        | Regret once the system has had a lot of feedback.                                                                                                                                                    | lower     |


Notes on these definitions:

- Every figure is an average over all proposals of all students and all seeds, except "proposals to reach
60%", which is averaged over student and scenario pairs.
- "First 10" and "40+" come from fixed groups of proposals counted by how many reactions the system had
already seen (0 to 10, and 41 or more).
- **Why 60% and a window of 10?** It is a judgment call: "a clear majority of recent proposals are kept".
We have no further justification, and no test at other cutoffs was run. The cutoff matters most for the
erratic students, whose kept rate hovers around 50% for every system. They often never reach 60%, so their
value is capped at 60 and the figure understates how slow they are. A higher cutoff such as 70% would be
reached by far fewer students. A lower one such as 50% would let erratic students count. Whether the
ordering of the two systems holds at other cutoffs is untested.

**Confidence intervals and "paired" differences.**

- All results are averages over simulated students. To show how much they would change with a different
draw of students, we give a 95% interval: resample the students with replacement 2,000 times, recompute the
metric each time, and report the 2.5th and 97.5th percentiles.
- The two systems run on the same students, so a difference between two systems (for example
`regret(LinUCB) - regret(heuristic)`) is resampled with the same students for both. If the interval of a
difference excludes 0, the two systems are clearly different. "n.s." in the tables means the interval
includes 0. "pts" means percentage points.
- With 14,000 students the intervals are very narrow, so nearly every difference is clear. Judge by the size
of a difference.

**Known limitation: infeasible placements.** When no free slot exists inside a task's window the simulator
records no proposal for that member, whereas production still assigns a start through displacement or the
last resort. Crowded cases are therefore under-represented in regret, kept and drag. Every difference between
systems is taken over the placements all systems produced (same task and member), so they stay paired.

**Regret and kept can disagree.**

- Regret is about slot quality. Kept is about whether a student bothered to move the proposal.
- A slot that is good but not the best counts as a win on kept and a loss on regret.
- To judge slot quality, trust regret. To judge what users feel, look at kept and drag.

## 4. How we tested

**Simulated students.** Each has two labels that vary independently, giving 15 types. The labels name the
centre of a student, not the whole student:

- *When they work best:* early bird, midday or night owl. The peak hour is drawn from a wide range around the
  label (early birds 05:00-11:30, centred on 08:00; midday 10:00-17:00, centred on 13:30; night owls
  19:00-23:45, centred on 21:30), so the ranges overlap. Night owls still have some daytime days, such as
  classes and exam prep.
- *How they behave:*
  - stable,
  - erratic,
  - crammer (wants late slots near deadlines),
  - planner (front-loads work),
  - weekender (prefers weekends).
- *Mixing:* every student carries the other behaviours too. A student who is not labelled crammer, planner or
  weekender shows each of them with a 40% chance, at 15% to 45% of the labelled strength.
- *Personal shape:* the width of the peak, the weekend shift of the peak (-1.5 to +2.5 hours), how bad the
  sleeping hours are, how much a busy day damps the peak, and where a busy day pulls the evening are drawn per
  student. The reaction traits (noise, threshold, chance to act, inertia, drift) vary by up to ±40%.

**Hidden preference.**

- Each student has a secret preference for every weekday and hour.
- It is built so that it matches neither system's way of working, so no system wins by design.

**How a student reacts.**

- Shown a proposal, a student may drag it to a better slot on the same day.
- They do it only if the gain is big enough, only some of the time, and with some noise in what they perceive.
- Each system then learns from what happened, the way it would in the real app (the heuristic nudges its
table, LinUCB updates its band's model).

**Hidden preference, in more detail.** A student's liking of a slot is a smooth curve over the day that
peaks at their best hour (about 08:00 for early birds, 13:30 for midday students, 21:30 for night owls). It is lowered for sleeping hours and
adjusted by the context: weekends, how busy the day is, how close the deadline is, and the student's
behaviour type (a crammer likes late slots near a deadline, a planner likes starting early, and so on).

**Fair comparison.** Every system sees the same students, calendars, tasks and random luck. Each system
runs in its own copy of the student's calendar, so one system's placements do not affect another's.

**Tasks and scenarios.**

- Each student gets 60 task arrivals per scenario, one per day.
- A task arrives between 07:00 and 21:00. It lasts 30, 60, 90 or 120 minutes.
- The task's deadline falls between 12:00 and 22:00 on the last day of its window.
- There are five scenarios. A series is a task split into several sittings that share one deadline window.
"Loose" and "tight" describe how much deadline time each sitting gets:


| Scenario          | Sittings | Days allowed per sitting | Deadline window, counted from the day the task arrives |
| ----------------- | -------- | ------------------------ | ------------------------------------------------------ |
| Single task       | 1        | not applicable           | 1 to 7 days (random)                                   |
| 3 sittings, loose | 3        | 2.5                      | 8 days                                                 |
| 3 sittings, tight | 3        | 1.2                      | 4 days                                                 |
| 6 sittings, loose | 6        | 2.5                      | 15 days                                                |
| 6 sittings, tight | 6        | 1.2                      | 8 days                                                 |


- The window is the number of sittings × days per sitting, rounded up.
- A **tight** series squeezes its sittings into few days (about 1 day each), so there is little choice of slot.
- A **loose** series spreads them out (about 2.5 days each), so there is room to pick good hours, and to pick badly.

**Size of the run.**

- 20 repeat runs ("seeds") × 700 students (14,000 students, about 930 per type), both systems in the same
run.
- Systems: heuristic and LinUCB, both with the same preference matrix rules (learning rate 0.2).
- Every number comes with a 95% confidence interval (method in section 3). It only reflects which simulated
students were drawn, not how realistic they are.
- The weight of the preference term in LinUCB was chosen on a smaller run (3 seeds × 300 students, section 5.4).

## 5. Results

### 5.1 Overall

| Metric | Heuristic | LinUCB | LinUCB - heuristic |
|---|---|---|---|
| Regret | 0.390 [0.388, 0.392] | 0.401 [0.399, 0.404] | +0.011 [+0.008, +0.013] |
| Kept | 60.6% [60.4, 60.8] | 69.9% [69.7, 70.1] | +9.3 pts [+9.1, +9.4] |
| Drag (min) | 103 [102, 104] | 75 [75, 76] | -27.3 [-28.0, -26.7] |
| Proposals to 60% | 29.3 [29.0, 29.6] | 17.7 [17.5, 17.8] | -11.6 [-11.9, -11.3] |
| Regret, first 10 proposals | 0.674 [0.668, 0.681] | 0.591 [0.587, 0.595] | -0.083 [-0.087, -0.080] |
| Regret, 40+ proposals | 0.338 [0.336, 0.340] | 0.381 [0.379, 0.384] | +0.044 [+0.042, +0.046] |

Differences are paired (same students). For regret, drag and proposals to 60% a negative value favours LinUCB;
for kept a positive value does. Intervals that include 0 are marked "n.s.".

- LinUCB is 0.011 worse on regret overall, 9.3 points better on kept and 27 minutes better on drag.
- In the first 10 proposals LinUCB has the lower regret (0.591 vs 0.674). After 40 proposals the heuristic is
  better (0.338 vs 0.381) because its table has by then moved to the student's hours.

### 5.2 By student type

Regret (lower is better):

| Type | Heuristic | LinUCB |
|---|---|---|
| night owl, stable | 0.473 | ***0.314*** |
| night owl, planner | 0.526 | ***0.381*** |
| night owl, crammer | 0.578 | ***0.400*** |
| night owl, erratic | 0.563 | ***0.442*** |
| night owl, weekender | ***0.512*** | 0.586 |
| midday, stable | ***0.232*** | 0.237 |
| midday, planner | ***0.262*** | 0.307 |
| midday, crammer | ***0.285*** | 0.310 |
| midday, erratic | 0.333 | ***0.322*** |
| midday, weekender | ***0.323*** | 0.466 |
| early bird, stable | ***0.283*** | 0.359 |
| early bird, planner | ***0.329*** | 0.465 |
| early bird, crammer | ***0.414*** | 0.515 |
| early bird, erratic | 0.381 | ***0.377*** |
| early bird, weekender | ***0.366*** | 0.536 |

Kept, drag and learning speed:

| Type | Kept: Heur. | LinUCB | Drag min: Heur. | LinUCB | To 60%: Heur. | LinUCB |
|---|---|---|---|---|---|---|
| night owl, stable | 57.9% | ***75.8%*** | 166 | ***69*** | 53.5 | ***17.3*** |
| night owl, planner | 61.4% | ***76.2%*** | 141 | ***58*** | 39.6 | ***16.7*** |
| night owl, crammer | 54.8% | ***69.6%*** | 163 | ***73*** | 49.0 | ***19.5*** |
| night owl, erratic | 46.7% | ***48.7%*** | 205 | ***183*** | 30.3 | ***24.9*** |
| night owl, weekender | 61.0% | ***73.3%*** | 126 | ***68*** | 28.2 | ***16.2*** |
| midday, stable | 70.8% | ***80.5%*** | 50 | ***36*** | 25.1 | ***14.7*** |
| midday, planner | 70.0% | ***78.1%*** | 45 | ***36*** | 21.5 | ***14.3*** |
| midday, crammer | 64.1% | ***71.3%*** | 64 | ***51*** | 24.2 | ***16.0*** |
| midday, erratic | 50.0% | ***51.0%*** | ***118*** | 120 | 22.7 | ***20.5*** |
| midday, weekender | 65.6% | ***71.9%*** | 49 | ***45*** | 19.5 | ***15.0*** |
| early bird, stable | 66.4% | ***77.1%*** | 71 | ***63*** | 29.8 | ***17.6*** |
| early bird, planner | 68.6% | ***78.8%*** | 58 | ***51*** | 22.8 | ***15.4*** |
| early bird, crammer | 59.5% | ***72.6%*** | 85 | ***72*** | 27.8 | ***17.7*** |
| early bird, erratic | 48.4% | ***49.4%*** | ***140*** | 150 | ***23.7*** | ***23.7*** |
| early bird, weekender | 64.2% | ***74.0%*** | 64 | ***58*** | 21.7 | ***15.7*** |

### 5.3 The start and the late stage (regret)

| Type | First 10: Heur. | LinUCB | After 40: Heur. | LinUCB |
|---|---|---|---|---|
| night owl, stable | 1.063 | ***0.734*** | 0.367 | ***0.287*** |
| night owl, planner | 1.055 | ***0.776*** | 0.429 | ***0.354*** |
| night owl, crammer | 1.339 | ***0.978*** | 0.436 | ***0.355*** |
| night owl, erratic | 1.044 | ***0.858*** | 0.478 | ***0.395*** |
| night owl, weekender | 0.866 | ***0.787*** | ***0.442*** | 0.562 |
| midday, stable | 0.496 | ***0.391*** | ***0.194*** | 0.225 |
| midday, planner | 0.498 | ***0.411*** | ***0.225*** | 0.302 |
| midday, crammer | 0.592 | ***0.470*** | ***0.238*** | 0.296 |
| midday, erratic | 0.512 | ***0.451*** | 0.307 | ***0.304*** |
| midday, weekender | 0.555 | ***0.552*** | ***0.286*** | 0.450 |
| early bird, stable | ***0.352*** | 0.430 | ***0.262*** | 0.349 |
| early bird, planner | ***0.335*** | 0.420 | ***0.317*** | 0.468 |
| early bird, crammer | ***0.575*** | 0.627 | ***0.373*** | 0.494 |
| early bird, erratic | ***0.378*** | 0.452 | 0.372 | ***0.354*** |
| early bird, weekender | ***0.461*** | 0.532 | ***0.346*** | 0.528 |

Differences that are **not** clear at 95% (the interval includes 0):

- Proposals to 60%: early bird, erratic
- Regret, first 10 proposals: midday, weekender
- Regret, 40+ proposals: midday, erratic

Every other per-type difference has an interval that excludes 0.

### 5.4 Choosing the weight of the favourite-hours table in LinUCB

The weight (1.0 above) was chosen on a smaller run of the same simulation (3 seeds × 300 students, so intervals
are about ±0.01 on regret and the values differ slightly from section 5.1). LinUCB at each weight, with the
heuristic for reference:

| Weight | 0 | 0.5 | **1.0** | 2 | 4 | Heuristic |
| --- | --- | --- | --- | --- | --- | --- |
| Regret | 0.506 | 0.427 | **0.401** | 0.379 | 0.366 | 0.389 |
| Kept | 68.7% | 70.1% | **69.5%** | 67.3% | 64.6% | 60.3% |
| Drag (min) | 99 | 80 | **76** | 79 | 85 | 103 |
| Proposals to 60% | 16.7 | 17.0 | **17.8** | 20.9 | 25.0 | 29.8 |
| Regret after 40 proposals | 0.491 | 0.410 | **0.381** | 0.347 | 0.317 | 0.336 |

- Regret keeps falling as the weight grows, because the table, which learns fast, increasingly decides the slot.
- Kept and the time to reach 60% get worse above about 1, and drag is best around 1.
- 1.0 is close to the heuristic's regret and keeps the LinUCB advantage on kept, drag and learning speed.
  A weight of 2 would beat the heuristic on regret (0.379 vs 0.389) and still keep 67% against 60%, but it
  needs 21 proposals to become reliable instead of 18.

## 6. What the results mean

**Why LinUCB feels better to students**

- It reacts quickly to what a student does: after a few drags the band models move, while the heuristic's
  table moves one cell at a time.
- That shows up as more kept proposals, less dragging and a shorter time before it is reliable.

**Why LinUCB is not closer to the best slot overall**

- The heuristic's table also learns fast (rate 0.2), and LinUCB's hour choice is the same table. LinUCB adds
  the band models on top of a method that is already good, and they pay off only where the table's defaults
  are wrong.
- After 40 proposals the heuristic has the lower regret for 9 of 15 types and ties for midday erratic.

**Night owls gain the most**

- The default table points at the morning, so the heuristic starts wrong for night owls and unlearns slowly.
- Their regret is 0.47 to 0.58 with the heuristic and 0.31 to 0.44 with LinUCB (weekenders excepted), and
  stable, planner, crammer and weekender night owls drag 58 to 73 minutes with LinUCB against 126 to 166 with
  the heuristic.
- Night-owl weekenders are the exception on regret: LinUCB is worse than the heuristic (0.586 vs 0.512).

**Early birds and midday students lose some ground**

- Early birds peak at about 08:00 and the table peaks at 09:00 to 12:00. LinUCB's regret is 0.36 to 0.54
  against 0.28 to 0.41 for the heuristic; erratic early birds are level (0.377 vs 0.381).
- Midday students peak at about 13:30, inside the 12-14 band. The default table scores that band 0, so the
  table term holds the pick back until the student's drags teach it: the heuristic is better for stable,
  planner, crammer and weekender midday students, most clearly for weekenders (0.323 vs 0.466).
- Erratic students stay hard for every system: they keep only about half of the proposals.

**Bands the default table scores 0 are found a little slower.** In a separate check, a student who always
wants 12:00-14:00 is found after about 6 proposals, and one who wants 22:00-24:00 after about 4. A student
who only nudges every proposal slightly does not make LinUCB try those bands.

## 7. Verdict

**Use LinUCB with the favourite-hours term; keep the heuristic as the control.** Compared with the heuristic
it gives:

- 70% of proposals kept (vs 61%),
- 27 fewer minutes of dragging per proposal (75 vs 103),
- a reliable start after 18 proposals instead of 29,
- much better results for night owls and for the first 10 proposals.

It does **not** lower regret overall: it is 0.011 higher, and clearly higher for early birds, midday students
and weekenders once the heuristic's table has learned.

**Limits:** The students are simulated, so this shows how the systems behave, not how real people will react.
The mix of behaviours and chronotypes is a guess. The early-bird and midday results depend on the simulated
peaks (08:00 and 13:30) relative to the default table. The real answer needs a live A/B test.
