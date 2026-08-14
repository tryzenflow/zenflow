# Zenflow for DLU: Thesis Scope

> **What this doc is:** a product-level assessment of how Zenflow's existing scheduler
> and personalization roadmap narrows and adapts into an academic thesis (Aug–early Dec),
> integrated with Dalat University's (DLU) learning systems. Product decisions only — no
> implementation detail.
> **Who should read it:** the thesis advisor, and the user as a working scope reference.

---

## 1. Why this pivot

The existing product ([`docs/heuristic.md`](heuristic.md)) is a general-purpose deadline
scheduler with a four-phase personalization roadmap ending in collaborative,
population-scale cold-start seeding. That roadmap was designed for a product with many
users, a long observation window, and open-ended "is this a better suggestion?"
evaluation. A thesis running August through early December has none of those luxuries,
and doesn't need them:

- **No large, subjective evaluation.** The thesis can't rely on many people judging
  whether a suggestion "feels right" — that's slow to collect and hard to defend as
  evidence. Evaluation instead uses the same objective, already-logged behavioral
  signals the product already collects: did the user keep the suggested slot, did they
  move it, did they finish the task there.
- **No large user study.** A handful of self-verifying DLU students (the user plus a
  few classmates) is enough to generate real telemetry and to sanity-check that
  suggestions make sense, without the coordination and consent overhead of a proper
  human-subjects study.
- **No expensive model training.** The roadmap already names a lightweight, classical
  approach for exactly this situation — a contextual bandit (LinUCB) — rather than a
  deep model. That choice was already the right one for a small-data, single-service
  deployment; the thesis just moves it from "phase 3, someday" to the center of the
  project.

The upshot: the thesis is a **narrowing**, not a redesign. It keeps the scheduler core
and the telemetry-driven personalization philosophy, drops the phases and features that
assume more data and more users than a thesis term can produce, and adds one new
capability the general product never needed — pulling a student's actual academic
workload in from the systems that hold it.

---

## 2. What stays the same

- **The deadline-driven scheduler itself.** Tasks are still placed automatically onto a
  15-minute time grid, respecting work hours and deadlines as soft costs rather than
  hard walls, with manual drag/resize always available as an override.
- **The core interaction loop.** A student still creates or receives a task, the
  scheduler proposes a placement, and the student can accept it, move it, or complete it
  — and every one of those reactions is logged.
- **Telemetry as the only source of truth.** Every suggestion, override, and outcome is
  recorded, and it remains the sole fuel for personalization — nothing is inferred from
  outside the app.
- **The behavioral evaluation metrics.** How often a suggestion is kept unchanged, how
  far a student moves it when they don't like it, and whether the task actually gets
  completed in its suggested slot — these remain the yardsticks for "did the scheduler
  get better," now serving double duty as the thesis's evaluation methodology.
- **The duration-learning layer.** Learning that a student systematically under- or
  over-estimates how long certain kinds of work take, and correcting future estimates
  accordingly, stays as a standing feature underneath whatever places the task.
- **The signed time-preference matrix.** The lightweight "when does this person like to
  work" model built directly from accept/reject telemetry remains — it's cheap, it
  already works with almost no data, and it's a natural stepping stone into the bandit's
  richer feature set rather than a competing mechanism.
- **The one explicit multi-task action (batch re-optimize) and manual task creation.**
  A student can still create a task by hand with no LMS involvement at all, and can still
  ask the scheduler to re-pack a window of tasks in one deliberate action.

---

## 3. What changes or narrows

### 3.1 Audience: DLU students only

The product stops being a generic scheduler and becomes a DLU-specific study companion.
Onboarding, terminology, and the ingestion surface below are all built around a DLU
student's actual academic life — courses, assignments, labs, and exams — rather than
a generic "tag your tasks however you like" model.

### 3.2 New ingestion surface: LMS and portal awareness

DLU's learning management system and student portal don't expose anything like a public
API or subscription mechanism a third-party app could register with — so "new item on
LMS triggers a notification" is implemented honestly as a **best-effort watcher**: the
app periodically checks a student's LMS and portal activity (using their own logged-in
session) for anything new — an assignment, a lab, a change to the timetable, an exam
date — and treats a genuinely new item exactly like an external event would: a push
notification inviting the student to turn it into a task, pre-filled with whatever was
scraped (title, due date, and — where available — the attached document).

This is explicitly framed as **best-effort, not authoritative**: it's already known
that not every assignment or exam appears on the LMS, and the manual "create a task
yourself" path is not a fallback bolted on afterward — it's an equally first-class way
to get work onto the calendar, since large parts of a DLU student's actual workload
never touch the LMS at all.

### 3.3 Grades: explicitly out of scope as data

Grades in this environment are genuinely unusable as a signal: they're often not on the
LMS at all (most exams aren't conducted there), and when they do surface externally
they arrive as inconsistent artifacts — a spreadsheet of IDs and scores with no
reliable way to confirm which row belongs to which student, or a screenshot of the same.
There is no trustworthy, automatable way to attach a grade to a specific student's
specific task.

The product therefore does not attempt to ingest, display, or use grades at all — not
as a scheduling signal, not as a reward for the bandit, and not as an evaluation metric.
"Did this help my grades" is explicitly not a claim the thesis will make. Success is
measured entirely by scheduling behavior: whether suggestions get kept, how far they get
moved when they don't, and whether the work actually happens where it was placed.

### 3.4 New task-creation flow: session count instead of recurrence

The product previously supported (and has since removed) rule-based recurrence for
repeating tasks. Rather than reintroducing that complexity, academic work gets a
simpler, purpose-built flow: when creating a task — whether pulled from the LMS/portal
watcher or entered by hand — the student specifies **how many study sessions** it needs
(capped at three per day), and the scheduler creates that many linked instances of the
task and places each one independently, the same way any other task is placed. This
replaces recurrence as the one way to spread a single piece of work (exam prep, a large
assignment) across multiple sittings, and is a more natural mental model for "I need to
study for this exam three times before Friday" than authoring a repeat rule.

### 3.5 Personalization roadmap: bandit-first, later phases cut or deferred

- **The contextual bandit becomes the centerpiece**, not a distant future phase. Given
  how little data a thesis term realistically produces, the feature set feeds the
  bandit is deliberately narrow and chosen for maximum signal per feature:
  - **Deadline pressure** (how urgent the task is) — already central to the scheduler,
    now doubling as a bandit feature.
  - **Document content** — where an assignment or exam-prep task has an attached
    document, its text content becomes a feature describing *what kind of work* this
    is, without requiring the student to hand-tag everything themselves.
  - **Course** — which class a task belongs to, a DLU-specific signal that's more
    reliable and lower-effort than free-text tags for this population, since it's known
    the moment a task is created or scraped.

  These three sit alongside the scheduler's existing situational features (day of week,
  how loaded the rest of the day already is) rather than replacing them — the point is
  to extend the existing feature design with a few DLU-relevant, information-dense
  signals rather than inventing a new model from scratch.

- **The population-scale evaluation approach (large synthetic-persona simulation)** is
  no longer the primary way results get validated. It was built to compensate for a
  real pilot being too small to learn from — but the thesis doesn't need to *prove* the
  approach works at product scale, only to *demonstrate* it improving over the plain
  deadline-only baseline for its own small, self-verified group. Evaluation is done
  directly on real telemetry from that group, with the same behavioral metrics as
  section 2. A lightweight synthetic warm-start may still be useful early on purely to
  give the bandit something better than a blank slate before real data accumulates, but
  it is not the thesis's evidence.

- **Population-level personalization (learning "types" of users and seeding new
  students from them) is out of scope.** That mechanism only pays off with many users'
  worth of aggregate data, which this thesis's small cohort won't produce. It's noted
  as future work rather than pursued.

---

## 4. The end-to-end flow

Two paths converge on the same scheduling step:

1. **Automatic path:** the LMS/portal watcher notices something new (an assignment, a
   lab, an exam date, a timetable change) → the student gets a push notification →
   opening it shows a pre-filled task (title, deadline, and document if one was found)
   → the student confirms or edits it.
2. **Manual path:** the student creates a task themselves, exactly as today, for any
   work that never appears on the LMS.

Both paths then ask: **how many sessions does this need** (up to three a day)? The
scheduler creates that many linked task instances and places each one using the same
placement logic as any other task — now informed by the bandit's growing sense of when
and how this student (and the small cohort like them) tends to actually do this kind of
work.

---

## 5. Risks and open questions to raise with the advisor

- **No official DLU API.** The LMS/portal watcher depends on scraping a logged-in
  session rather than a sanctioned integration — it's fragile to any site change,
  raises questions about acceptable use that are worth clearing with the university
  ahead of time, and needs the student's own credentials handled carefully.
- **No grade-based outcome claim.** Because grades are dropped entirely, the thesis
  can only claim the scheduler changes *behavior* (fewer manual corrections, better
  completion-in-slot), not academic *outcomes*. Worth stating explicitly up front so
  it isn't read as an oversight later.
- **Cold start with a small cohort.** Even a handful of students produces limited
  telemetry per person, and population-level seeding (the usual fix) is out of scope.
  The bandit will likely need a simple, non-personalized default behavior for its first
  stretch with each student before it has enough of their own history to specialize.
- **Timeline pressure.** Between now and early December, the watcher/ingestion surface,
  the session-count flow, and the bandit's online-learning loop are three substantial
  pieces of work to land and evaluate in one term — worth sequencing deliberately (see
  below) so there's a working, evaluable product even if the latest pieces slip.

---

## 6. Suggested sequencing

1. **Ingestion + manual fallback.** Get the LMS/portal watcher producing believable
   pre-filled tasks, alongside the always-available manual path — this is the
   prerequisite for everything downstream having realistic data to work with.
2. **Session-count flow.** Replace recurrence with the sessions-per-task model so
   academic work actually lands on the calendar the way students think about it.
3. **Bandit context groundwork.** Wire deadline, document content, and course into the
   scheduler's context so every placement is already carrying the features the bandit
   will need.
4. **Bandit online-learning loop.** Turn on live scoring and weight updates from real
   accept/move/complete telemetry.
5. **Small-cohort evaluation.** Run the bandit against the plain deadline-only baseline
   for the self-verified group, using the behavioral metrics in section 2, and write up
   the comparison.
