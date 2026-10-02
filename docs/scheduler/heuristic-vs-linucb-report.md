# Report: heuristic vs LinUCB vs LinUCB with a warm start (issue #60)

We compared three ways of choosing a time slot for a student's task, using simulated students:

1. **Heuristic:** the current rule-based method.
2. **LinUCB (cold):** a learning method that starts knowing nothing.
3. **LinUCB (warm):** the same learning method, started with a little built-in knowledge.

## 1. The answer in short

|                                                              | Heuristic | LinUCB (cold) | LinUCB (warm) |
| ------------------------------------------------------------ | --------- | ------------- | ------------- |
| Average regret (how far from the best slot; lower is better) | 0.481     | 0.447         | ***0.387***   |
| Proposals the student keeps                                  | 58.1%     | ***70.0%***   | 69.7%         |
| Minutes the student drags a proposal                         | 121       | 84            | ***73***      |
| Proposals needed until it feels reliable                     | 30.8      | ***16.1***    | 16.4          |

(Warm uses n0 = 5, explained in section 2.)

- **Both LinUCB versions beat the heuristic on kept proposals and dragging.**
  - About 70% of their proposals are kept, against 58%.
  - Students move them about 40 to 50 minutes less.
- **Cold LinUCB is only slightly closer to the best slot** than the heuristic (0.447 vs 0.481).
  - It is better for some students and worse for others.
- **Warm LinUCB is clearly the best overall.**
  - Regret is 0.387.
  - It fixes cold LinUCB's late slip (section 6).
- **Warm LinUCB does not fix everything.**
  - It is still worse than the heuristic for early-bird erratic, crammer and weekender students.
  - It makes night owls' first proposals worse than cold LinUCB's (still far better than the heuristic's).
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
- After each proposal it updates the band's model from the student's reaction (kept, or dragged and by how
  much).
- It starts with no knowledge at all.

**LinUCB (warm).**

- Same as cold, but each band's model is given pretend experience before the first real proposal.
- The pretend experience is built from the heuristic's default table:
  - Every cell of the table (7 weekdays × 24 hours) belongs to one band.
  - Each cell becomes one pretend observation for its band: a typical day (weekend flag set for Saturday
    and Sunday) with the cell's table value as the reward.
- **n0** is the total weight of the pretend experience each band receives.
  - It means "treat the table as if it were n0 real proposals".
  - It is only used at the start. Real feedback gradually outweighs it as the student's own history grows.
  - n0 = 0 is the same as cold. We tested n0 = 2, 5 and 10; n0 = 5 is the one in use.

## 3. How to read the numbers

- All numbers are per proposal, averaged over students.
- In every table, ***bold italic*** marks the best value in its row (or in its column group for the wide
  tables). Ties are both marked.

| Metric                     | What it means                                                                                                                                                                                                | Better is |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **Regret**                 | How much worse the proposed slot is than the best free slot for that student, according to the student's hidden true preference. 0 means the proposal was the best slot.                                     | lower     |
| **Kept**                   | The share of proposals the student leaves alone instead of dragging. It is what a user feels as "the app got it right". It is a rough measure, because a student also keeps slots that are only good enough. | higher    |
| **Drag**                   | How many minutes the student moves a proposal. A kept proposal counts as 0. It measures wasted effort.                                                                                                       | lower     |
| **Proposals to reach 60%** | How many proposals pass before the student has kept at least 6 of the last 10. It shows how fast the system becomes useful to a new student. 10 is the fastest possible.                                     | lower     |
| **First 10 / 40+**         | Regret over a student's first 10 proposals, and over everything after the 40th. They show the start and the late stage.                                                                                      | lower     |

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
- It is built so that it matches neither system's way of working, so no system wins by design. Tests check this.

**How a student reacts.**

- Shown a proposal, a student may drag it to a better slot on the same day.
- They do it only if the gain is big enough, only some of the time, and with some noise in what they perceive.
- Each system then learns from what happened, the way it does in production.

**Fair comparison.** Every system sees the same students, calendars, tasks and random luck.

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

- 3 repeat runs ("seeds") × 700 students, all systems in the same run.
- Systems: heuristic, cold LinUCB, and warm LinUCB with n0 = 2, 5 and 10.
- The per-type tables use n0 = 5 as "warm".
- An earlier round of 300 students tried other designs of the pretend experience. The one that uses the
  table's values directly worked best.
- A version with no preference information (reward 0) was clearly weaker, so the gain does not only come
  from LinUCB exploring less.

## 5. Results

### 5.1 Overall

| Metric | Heuristic | Cold | Warm n0=2 | Warm n0=5 | Warm n0=10 |
| --- | --- | --- | --- | --- | --- |
| Regret | 0.481 | 0.447 | 0.395 | ***0.387*** | 0.391 |
| Kept | 58.1% | ***70.0%*** | ***70.0%*** | 69.7% | 69.2% |
| Drag (min) | 121 | 84 | 74 | ***73*** | ***73*** |
| Proposals to 60% | 30.8 | ***16.1*** | ***16.1*** | 16.4 | 16.8 |
| Regret, first 10 proposals | 0.727 | 0.616 | ***0.578*** | 0.596 | 0.615 |
| Regret, 40+ proposals | 0.430 | 0.428 | 0.380 | ***0.369*** | ***0.369*** |

- Heuristic to cold LinUCB: little gain on regret, a lot on kept and drag.
- Adding the warm start lowers regret by another 0.06 and drag by another 11 minutes.
- n0 = 5 is the best on regret overall and late. n0 = 2 is the best at the start.
- n0 = 10 starts slower.

### 5.2 By student type

Regret (lower is better; warm means n0 = 5):

| Type | Heuristic | Cold | Warm |
| --- | --- | --- | --- |
| night owl, stable | 0.600 | 0.376 | ***0.305*** |
| night owl, crammer | 0.756 | 0.553 | ***0.394*** |
| night owl, planner | 0.673 | 0.474 | ***0.342*** |
| night owl, erratic | 0.695 | ***0.431*** | 0.457 |
| night owl, weekender | 0.679 | 0.628 | ***0.623*** |
| midday, stable | 0.339 | 0.270 | ***0.268*** |
| midday, planner | 0.370 | 0.346 | ***0.336*** |
| midday, crammer | 0.386 | 0.363 | ***0.338*** |
| midday, erratic | 0.408 | 0.399 | ***0.378*** |
| midday, weekender | 0.520 | 0.548 | ***0.512*** |
| early bird, stable | 0.264 | 0.259 | ***0.220*** |
| early bird, planner | 0.319 | 0.417 | ***0.279*** |
| early bird, erratic | ***0.352*** | 0.461 | 0.385 |
| early bird, crammer | ***0.402*** | 0.563 | 0.472 |
| early bird, weekender | ***0.453*** | 0.614 | 0.498 |

Kept, drag and learning speed:

| Type | Kept: Heur. | Cold | Warm | Drag min: Heur. | Cold | Warm | To 60%: Heur. | Cold | Warm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| night owl, stable | 50.0% | 74.4% | ***75.9%*** | 233 | 89 | ***73*** | 79.4 | ***15.4*** | 18.1 |
| night owl, crammer | 48.8% | ***71.5%*** | 69.2% | 224 | 91 | ***72*** | 64.5 | ***15.6*** | 20.5 |
| night owl, planner | 54.7% | ***78.3%*** | 76.7% | 200 | 59 | ***58*** | 49.7 | ***13.5*** | 17.1 |
| night owl, erratic | 45.2% | ***48.4%*** | 48.3% | 233 | ***183*** | 184 | 30.7 | ***23.4*** | 24.4 |
| night owl, weekender | 60.9% | ***76.7%*** | 74.7% | 143 | ***62*** | 67 | 21.7 | ***13.1*** | 14.6 |
| midday, stable | 61.3% | ***75.0%*** | 73.7% | 75 | 51 | ***48*** | 39.1 | ***16.1*** | 18.3 |
| midday, planner | 62.9% | ***74.6%*** | 73.5% | 66 | 52 | ***47*** | 27.8 | ***14.9*** | 15.4 |
| midday, crammer | 57.4% | ***68.2%*** | 67.6% | 85 | 69 | ***61*** | 31.0 | ***16.1*** | 17.2 |
| midday, erratic | 49.3% | 50.2% | ***50.6%*** | ***125*** | 135 | 127 | 24.5 | ***21.6*** | 21.7 |
| midday, weekender | 61.6% | ***70.9%*** | 69.7% | 62 | 59 | ***55*** | 19.0 | ***14.2*** | 14.4 |
| early bird, stable | 69.5% | 82.5% | ***85.4%*** | 70 | 46 | ***30*** | 13.1 | 14.2 | ***10.6*** |
| early bird, planner | 72.2% | 81.4% | ***83.5%*** | 52 | 51 | ***25*** | 12.8 | 13.2 | ***10.9*** |
| early bird, erratic | 49.1% | 48.8% | ***50.3%*** | ***125*** | 165 | 138 | ***17.3*** | 21.8 | 17.4 |
| early bird, crammer | 59.2% | 72.1% | ***72.6%*** | 82 | 89 | ***64*** | 18.3 | 15.4 | ***14.3*** |
| early bird, weekender | 69.4% | ***77.7%*** | 75.1% | 45 | 60 | ***38*** | 12.8 | 12.4 | ***11.4*** |

### 5.3 The start and the late stage (regret)

| Type | First 10: Heur. | Cold | Warm | After 40: Heur. | Cold | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| night owl, stable | 1.154 | ***0.471*** | 0.794 | 0.491 | 0.375 | ***0.276*** |
| night owl, crammer | 1.457 | ***0.692*** | 1.094 | 0.614 | 0.546 | ***0.342*** |
| night owl, planner | 1.162 | ***0.492*** | 0.835 | 0.575 | 0.486 | ***0.306*** |
| night owl, erratic | 1.133 | ***0.580*** | 0.895 | 0.614 | ***0.406*** | 0.412 |
| night owl, weekender | 0.958 | ***0.655*** | 0.863 | 0.619 | 0.622 | ***0.590*** |
| midday, stable | 0.648 | ***0.458*** | 0.481 | 0.286 | 0.255 | ***0.252*** |
| midday, planner | 0.658 | 0.481 | ***0.476*** | ***0.319*** | 0.334 | 0.328 |
| midday, crammer | 0.715 | ***0.486*** | 0.538 | 0.329 | 0.348 | ***0.323*** |
| midday, erratic | 0.642 | 0.556 | ***0.539*** | 0.372 | 0.370 | ***0.356*** |
| midday, weekender | 0.783 | ***0.660*** | 0.688 | ***0.467*** | 0.526 | 0.493 |
| early bird, stable | 0.203 | 0.618 | ***0.157*** | 0.264 | 0.238 | ***0.230*** |
| early bird, planner | 0.202 | 0.699 | ***0.185*** | 0.327 | 0.386 | ***0.296*** |
| early bird, erratic | ***0.217*** | 0.750 | 0.324 | ***0.364*** | 0.425 | 0.386 |
| early bird, crammer | ***0.422*** | 0.870 | 0.491 | ***0.384*** | 0.519 | 0.464 |
| early bird, weekender | ***0.550*** | 0.777 | 0.582 | ***0.434*** | 0.586 | 0.485 |

## 6. What the results mean

**Why LinUCB feels better to students**

- It reacts quickly to what a student does.
- The heuristic's table moves slowly: each drag nudges one cell by a small amount.
- So the heuristic keeps proposing the wrong hours for a long time, which shows up as lower kept and higher drag.

**Why cold LinUCB is not clearly closer to the best slot**

- Kept is a rough yes/no with a threshold, so it exaggerates small improvements.
- On regret, the gain over the heuristic is small (0.447 vs 0.481).

**Night owls gain the most**

- The heuristic's default table points at the daytime, so it starts wrong for night owls and unlearns slowly.
- Their regret is 0.60 to 0.76 with the heuristic (0.68 for weekenders) and 0.38 to 0.63 with cold LinUCB.

**Early birds lose with cold LinUCB, and the warm start fixes most of it**

- The default table already matches early birds, so the heuristic starts almost right.
- Cold LinUCB starts with nothing and needs a while to find the mornings. Stable early birds' first 10
  proposals have regret 0.203 with the heuristic and 0.618 with cold LinUCB.
- The warm start gives LinUCB the same morning bias, so it drops to 0.157.

**The warm start also fixes the late slip**

- After 40 proposals, cold LinUCB is no better than the heuristic (0.428 vs 0.430).
- Warm LinUCB is clearly better (0.369).
- The prior makes LinUCB steadier over the long run, which helps almost every type.

**What the warm start does not fix**

- Early-bird erratic, crammer and weekender students stay worse than the heuristic (for example crammers:
  0.472 vs 0.402).
- Their preferences change with deadlines and with the weekend. A prior that is the same every day cannot
  capture that, and LinUCB's simple model has no weekend-specific shape.
- Weekenders overall are only partly helped.
- Erratic students stay hard for every system: they are kept only about half the time.

**The cost of the warm start: night owls start worse**

- The default table favours the daytime, so the prior pulls LinUCB toward the day.
- Stable night owls' first 10 proposals have regret 0.794 with the warm start, against 0.471 cold.
- That is still far better than the heuristic's 1.154.
- After 40 proposals the warm start is clearly the best (0.276 vs 0.375 cold).
- Night owls also need a few more proposals to reach 60% kept (18.1 vs 15.4).

**Choosing n0**

- n0 = 2 is gentle and best at the start (first 10 proposals: 0.578).
- n0 = 10 starts slower (first 10 proposals: 0.615) and gains nothing later.
- n0 = 5 is the compromise and is the best on regret overall (0.387).

**Kept barely changes with the warm start** (70% either way). Its gains show up in regret and drag.

## 7. Caveats

- The students are invented, and all results depend on how we built them.
  - The early-bird gains exist because the simulated early birds match the default table. Real early
    birds may not.
  - The lower weekend values only help if real students avoid weekends. One in five simulated students
    prefers them.
- The run is small: 3 seeds × 700 students, about 140 per type, so per-type numbers are indicative.
  The overall picture is the safer reading. A 20-seed rerun is needed before a launch decision.
- The comparison is as shipped. The heuristic starts with its default table, and cold LinUCB starts with
  nothing. A comparison where both start with nothing was not run.
- With many students, even tiny differences look statistically solid. Judge by the size of a difference.
  No confidence ranges were computed for this run.
- Each system gets its own world, rather than mixing the two inside one student.
- Not modelled: tasks with no free slot (skipped), time zones and daylight saving (UTC only), and the
  pairwise and like/dislike feedback.
- The student model was changed once (night-owl daytime days). Findings that depend on one trait could move
  if it changes again.
- LinUCB's exploration setting was only tuned on an earlier version. It showed no sensitivity, so it stayed.

## 8. Status and next steps

**Status**

- Warm LinUCB with n0 = 5 is built into the scheduler service.
- The lower weekend values were only tested in simulation. The live default table still has equal values
  for every day.

**Next steps**

- Run the 20-seed study with all three systems.
- Rerun the larger comparisons (by scenario and by experience, with longer series up to 60 sittings) with
  warm LinUCB included.
- Try a stronger weekend and deadline signal for LinUCB, then rerun.
- Optionally run a both-start-from-nothing comparison.
- Settle the real question with the real A/B test.
