# Report: heuristic vs LinUCB vs LinUCB with a warm start

**Context.** Zenflow is a study planner. When a student adds a task, the app proposes a time slot for it.
The student can keep the proposal or drag it to another time. Each drag tells the app what the student
prefers.

We compared three ways of choosing the slot, using simulated students:

1. **Heuristic:** a rule-based method with a fixed table of favourite hours (the app's current method).
2. **LinUCB (cold):** a learning method that starts knowing nothing. (LinUCB is a standard "contextual
bandit" algorithm: it tries options, watches the reward, and shifts toward what works.)
3. **LinUCB (warm):** the same learning method, started with a little built-in knowledge.

## 1. The answer in short


|                                                                      | Heuristic | LinUCB (cold) | LinUCB (warm) |
| -------------------------------------------------------------------- | --------- | ------------- | ------------- |
| Average regret (how far from the best slot; lower is better)         | 0.463     | 0.445         | ***0.374***   |
| Proposals the student keeps (higher is better)                       | 56.5%     | ***70.1%***   | 69.8%         |
| Minutes the student drags a proposal, per proposal (lower is better) | 130       | 84            | ***72***      |
| Proposals needed until it feels reliable (lower is better)           | 34.3      | ***15.9***    | 16.4          |


(Warm uses n0 = 5, explained in section 2. Exact definitions of every metric are in section 3.)

- **Both LinUCB versions beat the heuristic on kept proposals and dragging.**
  - About 70% of their proposals are kept, against 58%.
  - Students move them about 45 to 60 minutes less.
- **Cold LinUCB is only slightly closer to the best slot** than the heuristic (0.445 vs 0.463).
  - It is better for some students and worse for others.
  - After 40 proposals it is slightly worse than the heuristic (0.426 vs 0.416).
- **Warm LinUCB is clearly the best overall.**
  - Regret is 0.374.
  - It fixes cold LinUCB's late slip (section 6).
- **Warm LinUCB does not fix everything.**
  - It is still worse than the heuristic for early-bird erratic, crammer and weekender students, and
  for midday weekenders.
  - It makes night owls' first proposals worse than cold LinUCB's (still far better than the heuristic's).
- **Confidence:** these are 20 seeds × 700 students with 95% confidence intervals (section 5.1). The
intervals are narrow, so the overall ordering is solid. Judge a difference by its size, not by whether it
is "significant".
- **Limit:** the students are invented. The results show how the systems behave, not that real people
will see the same.

## 2. The three systems

**Heuristic.**

- Keeps a table with one liking score for each hour of each weekday (7 × 24 cells).
- The table starts from defaults:
  - 08:00-11:00 scores 1.0, 14:00-17:00 scores 0.5, 19:00-22:00 scores 0.2, and every other hour 0.
  - Saturday and Sunday scores are half of the weekday scores, because people rarely want to study on
  weekends.
- It proposes the free slot with the best score.
- When the student drags a proposal, the table shifts toward the new hour by a small step. It learns slowly.

**LinUCB (cold).**

- Splits the day into 6 time bands: 00-06, 06-11, 11-14, 14-17, 17-20 and 20-24.
- Keeps one small model per band that predicts how much the student will like a task placed in that
band. The prediction uses:
  - days until the deadline,
  - the task's length,
  - how busy the day is,
  - whether it is a weekend.
- It proposes a slot in the band with the highest prediction plus an exploration bonus. The bonus is
larger for bands it knows little about, so it tries different bands early.
- Score of a band = predicted liking + 0.15 × uncertainty. The 0.15 sets how adventurous it is.
- After each proposal it updates the band's model from the student's reaction. The reward is 0 when the
proposal is kept, and minus (minutes dragged ÷ 240), capped at -1, when it is dragged.
- It starts with no knowledge at all.

**LinUCB (warm).**

- Same as cold, but each band's model is given pretend experience before the first real proposal.
- The pretend experience is built from the heuristic's default table:
  - Every cell of the table (7 weekdays × 24 hours) belongs to one band.
  - Each cell becomes one pretend observation for its band: a typical day (weekend flag set for Saturday
  and Sunday) with the cell's table value as the reward. So bands covering the morning start with a
  high expected liking, and bands covering the night with a low one.
- **n0** is the total weight of the pretend experience each band receives.
  - It means "treat the table as if it were n0 real proposals".
  - It is only used at the start. Real feedback gradually outweighs it as the student's own history grows.
  - n0 = 0 is the same as cold. We tested n0 = 2, 5 and 10; n0 = 5 is the one in use.

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
| **Proposals to reach 60%** | for each student and scenario: the first proposal number `n >= 10` where `(kept among proposals n-9 .. n) / 10 >= 0.6`; if that never happens, `60` (the run length). Then averaged over students and scenarios. | How many proposals pass before the student has kept at least 6 of the last 10. It shows how fast the system becomes useful to a new student. 10 is the fastest possible, 60 means "never got there". | lower     |
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
ordering of the three systems holds at other cutoffs is untested.

**Confidence intervals and "paired" differences.**

- All results are averages over simulated students. To show how much they would change with a different
draw of students, we give a 95% interval: resample the students with replacement 2,000 times, recompute the
metric each time, and report the 2.5th and 97.5th percentiles.
- The three systems run on the same students, so a difference between two systems (for example
`regret(warm) - regret(heuristic)`) is resampled with the same students for both. If the interval of a
difference excludes 0, the two systems are clearly different. "n.s." in the tables means the interval
includes 0. "pts" means percentage points.
- With 14,000 students the intervals are very narrow, so nearly every difference is clear. Judge by the size
of a difference.

**Regret and kept can disagree.**

- Regret is about slot quality. Kept is about whether a student bothered to move the proposal.
- A slot that is good but not the best counts as a win on kept and a loss on regret.
- To judge slot quality, trust regret. To judge what users feel, look at kept and drag.

## 4. How we tested

**Simulated students.** Each has two traits that vary independently, giving 15 types.

- *When they work best:* early bird, midday or night owl. Night owls still have some daytime days, such as
classes and exam prep.
- *How they behave:*
  - stable,
  - erratic,
  - crammer (wants late slots near deadlines),
  - planner (front-loads work),
  - weekender (prefers weekends).

**Hidden preference.**

- Each student has a secret preference for every weekday and hour.
- It is built so that it matches neither system's way of working, so no system wins by design.

**How a student reacts.**

- Shown a proposal, a student may drag it to a better slot on the same day.
- They do it only if the gain is big enough, only some of the time, and with some noise in what they perceive.
- Each system then learns from what happened, the way it would in the real app (the heuristic nudges its
table, LinUCB updates its band's model).

**Hidden preference, in more detail.** A student's liking of a slot is a smooth curve over the day that
peaks at their best hour (early morning, midday or late evening). It is lowered for sleeping hours and
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

- 20 repeat runs ("seeds") × 700 students (14,000 students, about 930 per type), all systems in the same
run.
- Systems: heuristic, cold LinUCB, and warm LinUCB with n0 = 5.
- Every number comes with a 95% confidence interval (method in section 3). It only reflects which simulated
students were drawn, not how realistic they are.
- The choice of n0 (2, 5 or 10) comes from an earlier 3-seed × 700-student run (section 5.4). It was not
repeated at 20 seeds.
- An earlier round of 300 students tried other designs of the pretend experience. The one that uses the
table's values directly worked best. A version with no preference information (all rewards 0) was clearly
weaker, so the warm start's gain does not only come from LinUCB exploring less.

## 5. Results

### 5.1 Overall


| Metric                     | Heuristic            | Cold                 | Warm n0=5            |
| -------------------------- | -------------------- | -------------------- | -------------------- |
| Regret                     | 0.463 [0.460, 0.466] | 0.445 [0.442, 0.447] | 0.374 [0.372, 0.376] |
| Kept                       | 56.5% [56.3%, 56.6%] | 70.1% [69.9%, 70.3%] | 69.8% [69.6%, 70.0%] |
| Drag (min)                 | 130 [129, 131]       | 84 [83, 84]          | 72 [71, 73]          |
| Proposals to 60%           | 34.3 [33.8, 34.7]    | 15.9 [15.8, 16.0]    | 16.4 [16.2, 16.5]    |
| Regret, first 10 proposals | 0.694 [0.687, 0.701] | 0.612 [0.610, 0.615] | 0.567 [0.562, 0.572] |
| Regret, 40+ proposals      | 0.416 [0.413, 0.418] | 0.426 [0.424, 0.429] | 0.359 [0.357, 0.361] |


Differences between systems (paired, same students). For regret, drag and proposals to 60% a negative value favours the first system; for kept a positive value does. Intervals that include 0 are marked "n.s." (none do in this table):


| Metric                     | Cold - heuristic         | Warm - heuristic         | Warm - cold             |
| -------------------------- | ------------------------ | ------------------------ | ----------------------- |
| Regret                     | -0.018 [-0.021, -0.015]  | -0.089 [-0.092, -0.086]  | -0.070 [-0.072, -0.069] |
| Kept                       | +13.6 pts [+13.5, +13.8] | +13.4 pts [+13.2, +13.5] | -0.3 pts [-0.3, -0.2]   |
| Drag (min)                 | -46.5 [-47.7, -45.3]     | -58.1 [-59.2, -57.0]     | -11.6 [-11.9, -11.2]    |
| Proposals to 60%           | -18.3 [-18.8, -17.9]     | -17.9 [-18.3, -17.5]     | +0.4 [+0.3, +0.5]       |
| Regret, first 10 proposals | -0.081 [-0.089, -0.073]  | -0.127 [-0.129, -0.124]  | -0.045 [-0.051, -0.040] |
| Regret, 40+ proposals      | +0.011 [+0.008, +0.014]  | -0.057 [-0.060, -0.054]  | -0.068 [-0.069, -0.066] |


- Heuristic to cold LinUCB: little gain on regret (-0.018), a lot on kept (+13.6 points) and drag (-47 min).
- Adding the warm start lowers regret by another 0.07 and drag by another 12 minutes.
- Cold LinUCB's regret after 40 proposals is slightly worse than the heuristic's (+0.011). The warm start
turns that into a clear gain (-0.057).
- Warm and cold keep the same share of proposals (the 0.3-point gap is significant but negligible). Warm
needs about 0.4 more proposals to reach 60%.

### 5.2 By student type

Regret (lower is better; warm means n0 = 5):


| Type                  | Heuristic   | Cold        | Warm        |
| --------------------- | ----------- | ----------- | ----------- |
| night owl, stable     | 0.627       | 0.373       | ***0.307*** |
| night owl, crammer    | 0.796       | 0.533       | ***0.388*** |
| night owl, planner    | 0.701       | 0.477       | ***0.347*** |
| night owl, erratic    | 0.729       | ***0.431*** | 0.457       |
| night owl, weekender  | 0.614       | 0.619       | ***0.593*** |
| midday, stable        | 0.336       | 0.269       | ***0.268*** |
| midday, planner       | 0.367       | 0.343       | ***0.326*** |
| midday, crammer       | 0.389       | 0.366       | ***0.339*** |
| midday, erratic       | 0.419       | 0.390       | ***0.366*** |
| midday, weekender     | ***0.407*** | 0.545       | 0.474       |
| early bird, stable    | 0.237       | 0.257       | ***0.212*** |
| early bird, planner   | 0.292       | 0.414       | ***0.258*** |
| early bird, erratic   | ***0.329*** | 0.462       | 0.374       |
| early bird, crammer   | ***0.382*** | 0.561       | 0.455       |
| early bird, weekender | ***0.325*** | 0.628       | 0.451       |


Kept, drag and learning speed:


| Type                  | Kept: Heur. | Cold        | Warm        | Drag min: Heur. | Cold      | Warm      | To 60%: Heur. | Cold       | Warm       |
| --------------------- | ----------- | ----------- | ----------- | --------------- | --------- | --------- | ------------- | ---------- | ---------- |
| night owl, stable     | 46.9%       | 73.9%       | ***75.1%*** | 252             | 89        | ***74***  | 87.6          | ***15.2*** | 18.3       |
| night owl, crammer    | 46.4%       | ***71.9%*** | 69.8%       | 247             | 86        | ***71***  | 72.1          | ***15.3*** | 19.9       |
| night owl, planner    | 52.2%       | ***77.9%*** | 76.7%       | 217             | 61        | ***58***  | 56.4          | ***13.6*** | 16.9       |
| night owl, erratic    | 44.9%       | ***48.7%*** | 48.6%       | 242             | ***185*** | 187       | 30.1          | ***22.9*** | 23.6       |
| night owl, weekender  | 56.4%       | ***76.1%*** | 74.0%       | 172             | ***62***  | 69        | 28.8          | ***13.5*** | 15.4       |
| midday, stable        | 58.3%       | ***75.5%*** | 73.9%       | 84              | 51        | ***49***  | 47.0          | ***15.9*** | 18.0       |
| midday, planner       | 59.9%       | ***73.7%*** | 72.8%       | 76              | 53        | ***48***  | 35.5          | ***15.1*** | 16.1       |
| midday, crammer       | 55.9%       | ***68.6%*** | 67.9%       | 93              | 69        | ***61***  | 36.2          | ***15.9*** | 17.0       |
| midday, erratic       | 48.7%       | 50.4%       | ***50.8%*** | 128             | 132       | ***124*** | 24.2          | 20.4       | ***20.2*** |
| midday, weekender     | 58.8%       | ***70.9%*** | 69.8%       | 74              | 59        | ***54***  | 25.4          | ***14.2*** | 14.7       |
| early bird, stable    | 69.5%       | 83.0%       | ***85.6%*** | 69              | 45        | ***29***  | 11.9          | 13.8       | ***10.4*** |
| early bird, planner   | 72.0%       | 81.3%       | ***83.7%*** | 52              | 51        | ***24***  | 11.8          | 13.2       | ***10.9*** |
| early bird, erratic   | 49.4%       | 49.1%       | ***50.6%*** | ***120***       | 165       | 136       | 18.1          | 21.9       | ***18.0*** |
| early bird, crammer   | 59.1%       | 72.2%       | ***72.6%*** | 81              | 88        | ***61***  | 16.4          | 15.8       | ***14.3*** |
| early bird, weekender | 68.3%       | ***78.7%*** | 75.6%       | 48              | 59        | ***37***  | 12.5          | 12.2       | ***11.9*** |


### 5.3 The start and the late stage (regret)


| Type                  | First 10: Heur. | Cold        | Warm        | After 40: Heur. | Cold        | Warm        |
| --------------------- | --------------- | ----------- | ----------- | --------------- | ----------- | ----------- |
| night owl, stable     | 1.150           | ***0.463*** | 0.802       | 0.521           | 0.371       | ***0.277*** |
| night owl, crammer    | 1.464           | ***0.687*** | 1.102       | 0.658           | 0.527       | ***0.335*** |
| night owl, planner    | 1.153           | ***0.492*** | 0.857       | 0.609           | 0.488       | ***0.308*** |
| night owl, erratic    | 1.139           | ***0.592*** | 0.899       | 0.651           | ***0.406*** | 0.414       |
| night owl, weekender  | 0.875           | ***0.647*** | 0.786       | ***0.556***     | 0.613       | 0.569       |
| midday, stable        | 0.670           | ***0.453*** | 0.467       | 0.281           | 0.256       | ***0.254*** |
| midday, planner       | 0.668           | 0.482       | ***0.469*** | ***0.315***     | 0.332       | 0.319       |
| midday, crammer       | 0.748           | ***0.497*** | 0.540       | 0.328           | 0.351       | ***0.324*** |
| midday, erratic       | 0.674           | 0.548       | ***0.545*** | 0.378           | 0.363       | ***0.344*** |
| midday, weekender     | 0.666           | 0.658       | ***0.563*** | ***0.358***     | 0.525       | 0.467       |
| early bird, stable    | 0.152           | 0.596       | ***0.137*** | 0.244           | 0.237       | ***0.224*** |
| early bird, planner   | ***0.146***     | 0.697       | 0.155       | 0.307           | 0.383       | ***0.275*** |
| early bird, erratic   | ***0.184***     | 0.728       | 0.304       | ***0.345***     | 0.429       | 0.374       |
| early bird, crammer   | ***0.374***     | 0.861       | 0.463       | ***0.372***     | 0.519       | 0.447       |
| early bird, weekender | ***0.346***     | 0.786       | 0.422       | ***0.321***     | 0.600       | 0.452       |


Differences that are **not** clear at 95% (the interval includes 0):

- Regret: cold vs heuristic for night-owl weekenders; warm vs cold for midday stable.
- Regret after 40 proposals: warm vs heuristic for midday planner and midday crammer; warm vs cold for midday
stable.
- Regret in the first 10 proposals: warm vs cold for midday erratic.
- Kept and drag: warm vs cold for night-owl erratic.
- Proposals to 60%: warm vs heuristic for early-bird erratic; warm vs cold for midday erratic.

Every other per-type difference in the tables above has an interval that excludes 0. The per-type
intervals are about ±0.01 for regret.

### 5.4 Choosing n0 (earlier 3-seed run)

Only n0 = 5 was rerun at 20 seeds. The comparison of n0 values below is from the earlier 3 seeds × 700
students, without confidence intervals, so the other columns differ slightly from section 5.1.


| Metric                     | Heuristic | Cold        | Warm n0=2   | Warm n0=5   | Warm n0=10  |
| -------------------------- | --------- | ----------- | ----------- | ----------- | ----------- |
| Regret                     | 0.481     | 0.447       | 0.395       | ***0.387*** | 0.391       |
| Kept                       | 58.1%     | ***70.0%*** | ***70.0%*** | 69.7%       | 69.2%       |
| Drag (min)                 | 121       | 84          | 74          | ***73***    | ***73***    |
| Proposals to 60%           | 30.8      | ***16.1***  | ***16.1***  | 16.4        | 16.8        |
| Regret, first 10 proposals | 0.727     | 0.616       | ***0.578*** | 0.596       | 0.615       |
| Regret, 40+ proposals      | 0.430     | 0.428       | 0.380       | ***0.369*** | ***0.369*** |


- n0 = 5 is the best on regret overall and late. n0 = 2 is the best at the start.
- n0 = 10 starts slower.

## 6. What the results mean

**Why LinUCB feels better to students**

- It reacts quickly to what a student does.
- The heuristic's table moves slowly: each drag nudges one cell by a small amount.
- So the heuristic keeps proposing the wrong hours for a long time, which shows up as lower kept and higher drag.

**Why cold LinUCB is not clearly closer to the best slot**

- Kept is a rough yes/no with a threshold, so it exaggerates small improvements.
- On regret, the gain over the heuristic is small (0.445 vs 0.463).
- After 40 proposals it is slightly worse than the heuristic (0.426 vs 0.416).

**Night owls gain the most**

- The heuristic's default table points at the daytime, so it starts wrong for night owls and unlearns slowly.
- Their regret is 0.63 to 0.80 with the heuristic (0.61 for weekenders) and 0.37 to 0.53 with cold LinUCB.
- Night-owl weekenders are the exception: cold LinUCB is no better than the heuristic (0.619 vs 0.614).

**Early birds lose with cold LinUCB, and the warm start fixes most of it**

- The default table already matches early birds, so the heuristic starts almost right.
- Cold LinUCB starts with nothing and needs a while to find the mornings. Stable early birds' first 10
proposals have regret 0.152 with the heuristic and 0.596 with cold LinUCB.
- The warm start gives LinUCB the same morning bias, so it drops to 0.137.

**The warm start also fixes the late slip**

- After 40 proposals, cold LinUCB is slightly worse than the heuristic (0.426 vs 0.416).
- Warm LinUCB is clearly better (0.359).
- The prior makes LinUCB steadier over the long run. Compared with cold LinUCB, warm is better after 40
proposals for 13 of 15 types (one tie, and night-owl erratic is slightly worse).
- Compared with the heuristic, warm is better after 40 proposals for 8 types, tied for 2 (midday planner and
crammer) and worse for 5 (the three weekender types and early-bird crammer and erratic).

**What the warm start does not fix**

- Early-bird erratic, crammer and weekender students, and midday weekenders, stay worse than the heuristic
(for example early-bird crammers: 0.455 vs 0.382).
- Their preferences change with deadlines and with the weekend. A prior that is the same every day cannot
capture that, and LinUCB's simple model has no weekend-specific shape.
- Weekenders are only partly helped: night-owl weekenders gain a little (0.593 vs 0.614), the other two
types are worse than the heuristic.
- Erratic students stay hard for every system: they are kept only about half the time.

**The cost of the warm start: night owls start worse**

- The default table favours the daytime, so the prior pulls LinUCB toward the day.
- Stable night owls' first 10 proposals have regret 0.802 with the warm start, against 0.463 cold.
- That is still far better than the heuristic's 1.150.
- After 40 proposals the warm start is clearly the best (0.277 vs 0.371 cold).
- Night owls also need a few more proposals to reach 60% kept (18.3 vs 15.2 for stable).

**Kept barely changes with the warm start** (70% either way). Its gains show up in regret and drag.

## 7. Verdict

**Use warm LinUCB (n0 = 5).** Compared with the heuristic it gives:

- lower regret (0.374 vs 0.463),
- about 70% of proposals kept (vs 57%),
- 58 fewer minutes of dragging per proposal (72 vs 130),
- a reliable start after 16 proposals instead of 34.

Cold LinUCB is not enough on its own: it improves kept and drag but barely improves regret, and it is
slightly worse than the heuristic after 40 proposals.

**Where it falls short.** The heuristic is still better for early-bird erratic, crammer and weekender
students and for midday weekenders. Erratic students are hard for every system. Night owls start worse than
with cold LinUCB, but they end up better and are far ahead of the heuristic.

**Limits:** The students are simulated, so this shows how the systems behave, not how real people will react. The early-bird results in particular depend on the simulated early birds matching the heuristic's default table. The real answer needs a live A/B test.

