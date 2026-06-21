# Seed / Simulator Implementation

> **What this doc is:** the *how* — the concrete code changes that build the
> simulator which produces synthetic telemetry for the strategy described in
> [`docs/simulation-strategy.md`](./simulation-strategy.md). Read the strategy doc
> first for the *what*; this is the implementation guide.
>
> **Who should read it:** anyone building, debugging, or extending the simulator,
> or trying to understand where the Phase-2 evaluation data comes from.
>
> The simulator is a **closed-loop driver**: per simulated day it generates tasks,
> reacts to the EDF suggestions, and settles outcomes — producing the exact
> `TaskEvent` / `suggestedStartTime` / signed `preferenceMatrix` telemetry the
> production app would.
>
> **Two persistence modes share one decision loop (`runner.ts`, via an `Actuator`
> seam):**
> - **`--mode=batched` (default)** computes the whole population's lifecycle in
>   memory and bulk-writes it in 50k-row `createMany` batches. It does NOT call the
>   services row-by-row (a year × ~50 personas is hundreds of thousands of
>   transactions); instead it calls the SAME pure builders the services use — see
>   §7. This is the fast path used to seed the sim DB.
> - **`--mode=service`** drives the literal `TasksService` / `SchedulerService` /
>   `AbandonedTasksService` so telemetry is produced through the production code
>   path exactly. Slower; kept as the reference path.
>
> Both share the pure scheduler core + the extracted telemetry builders, so they
> emit the same shape of telemetry — see §7 for what was extracted and why.

---

## Concepts & terminology

New to this codebase? Read this once. Terms are defined before their first use below.

**Telemetry / `TaskEvent`.** The behavioral log the app records as users interact
with their schedule: a row per `CREATE` / `MOVE` / `RESIZE` / `KEEP` / `COMPLETE` /
`ABANDON`. Phase-2 and beyond *learn* from this log, so the simulator's whole job is
to manufacture realistic telemetry we can train and evaluate on.

**Closed-loop driver.** A simulator where the synthetic user *reacts* to what the
scheduler suggests (accept it, move it, resize it), and those reactions feed the next
decision — exactly like a real user. Contrast with replaying a fixed log. Closed-loop
data is what makes the Phase-2 A/B test trustworthy.

**EDF.** The deterministic Earliest-Deadline-First scheduler (Phase 1). The simulator
drives the *real* EDF code so the telemetry matches production exactly.

**Persona vs. archetype.** An **archetype** is a *type* of user (`dev`, `night_owl`,
`ops`, `pm`, `crammer`), defined as parameter **distributions**. A **persona** is one
concrete user sampled from an archetype. Sampling from distributions (not fixed
values) gives a varied population.

**Latent / ground-truth fields (`pGlobal`, `pTag`, `tagBias`).** Each persona has
*hidden* preferences the learner never sees directly:
- `pGlobal` — a 672-cell (7 days × 96 slots) field of how much the persona likes each
  time-of-week slot.
- `pTag` — per-tag deviations from `pGlobal` (a Phase-3-only signal).
- `tagBias` — how badly the persona under/over-estimates durations, per tag
  (the duration corrector's target).

These are "ground truth": we know them because we generated them, and we keep them
*out* of any column a learner reads, so later "recovery" checks aren't circular.

**`preferenceMatrix` (signed matrix).** A per-user accumulator the app updates from
behavior: +1 toward a slot the user keeps/moves toward, −1 away from a slot they move
away from. The Phase-2 signal builds up here. **It is read-modify-write**, which is
why §1.2 matters.

**Reaction model.** The probabilistic policy that decides what a persona *does* with a
suggestion — keep it, move it, resize it, complete it, abandon it — bounded by the EDF
feasible set so it can never pick an impossible slot.

**Feasible set / `feasibleSlots`.** The list of slots EDF says a task could legally go
in. The reaction model only ever chooses from this set, so the "feasibility wall"
holds for free.

**Actuator seam.** The one decision loop (`runner.ts`) is parameterized over an
`Actuator` so the same logic can either call the real services (`ServiceActuator`,
service mode) or mutate in-memory state and bulk-write (`BatchedActuator`, batched
mode).

**Virtual `now` / clock.** The simulator runs a ~1-year timeline in minutes, not real
wall-clock time. A virtual `now` is threaded through every call so events are stamped
across the simulated year (see §1.1) — essential for any time-bucketed metric.

**Determinism / seeded PRNG.** All randomness comes from one seeded pseudo-random
generator (no `Math.random()`), so the same `--seed` reproduces the same decisions
byte-for-byte. Row UUIDs still differ run-to-run; the *decision stream* does not.

**MAR / IPS / SNIPS (evaluation outputs).** MAR = Move-Away Rate, the north-star
metric (fraction of suggestions the user overrode; lower is better). IPS/SNIPS are
off-policy estimators used by the offline replay scaffold to estimate a new
re-ranker's reward from a logged run. Full definitions live in the evaluation docs;
here they are just the outputs `eval/` produces.

---

## 0. The production surface the simulator drives

Everything already exists — the simulator only orchestrates it (paths under `backend/src`):

| Action (strategy §) | Real call | Telemetry emitted |
|---------------------|-----------|-------------------|
| Task arrival | `TasksService.create(dto, user)` (`tasks/tasks.service.ts:96`) | `CREATE` + `cascadeReschedule` placement |
| Move-toward / move-away | `TasksService.reschedule(id, startISO, user)` → `SchedulerService.pin` (`scheduler/scheduler.service.ts:355`) | `MOVE` + signed matrix ±1 |
| Resize-toward-true-duration | `TasksService.resize(id, startISO, dur, user)` → `SchedulerService.resize` (`:454`) | `RESIZE` |
| Overflow recovery | `TasksService.resolveOverflow(id, dto, user)` | `MOVE` |
| Complete-in-slot / keep | `TasksService.complete(id, user)` → `SchedulerService.recordKeep` (`:656`) | `COMPLETE`, and `KEEP` + matrix +1 when untouched |
| Abandon (deadline expired) | `AbandonedTasksService.sweep(now)` (`scheduler/abandoned-tasks.service.ts:85`) | `ABANDON` |

The signed-matrix math (`applyPreference`, `preferenceIndex`) and EDF feasibility
(`feasibleSlots`, `scheduleAll`) are reused untouched.

---

## 1. Two production changes the simulator needs

These are the **only** edits to existing files. Both default to today's behavior, so
production is byte-for-byte unchanged.

### 1.1 Thread a virtual `now` (so the year-long timeline is faithful) — REQUIRED

**Why:** the services default to real wall-clock time. In a 1-year simulation that
would place every task relative to *today* and stamp every event at the seed-run
instant, flattening the timeline. The fix lets the simulator say "pretend it is this
simulated moment".

Today `TasksService.create` calls `cascadeReschedule(user, tx)` with the default
`now = new Date()`, and every `tx.taskEvent.create` omits `occurredAt` (DB default
`now()`). For a ~1-year simulation this would (a) place tasks relative to real wall-clock
instead of the simulated day, and (b) stamp **all** events at the seed-run instant instead
of spreading them across the simulated year — breaking every time-bucketed metric.

Fix: add an optional `now?: Date` to the mutation methods and forward it to both
`cascadeReschedule` and the event's `occurredAt`. Representative change in
`tasks/tasks.service.ts`:

```ts
// create(dto, user)  →  create(dto, user, now: Date = new Date())
async create(dto: CreateTaskDto, user: User, now: Date = new Date()): Promise<CreateTaskResponse> {
  ...
  await this.scheduler.cascadeReschedule(user, tx, now);          // was: (user, tx)
  ...
  await tx.taskEvent.create({
    data: { /* …unchanged… */, occurredAt: now },                // was: omitted (default now())
  });
  ...
  const overflow = finalTask.scheduledStartTime === null
    ? await this.scheduler.computeOverflowOptions(user, finalTask, overflowView, tx, now)  // already takes now
    : null;
}
```

Apply the same `now: Date = new Date()` parameter + `occurredAt: now` to: `complete`,
`reschedule`/`pin`, `resize`, and `resolveOverflow`/`applyOverflowOption`. `pin`/`resize`
don't use `now` for placement (they snap `requestedStart`), so there it's only for
`occurredAt`. `cascadeReschedule` and `AbandonedTasksService.sweep` **already** accept
`now` — no change needed there.

> Keep these changes minimal and clearly defaulted; they don't alter the HTTP controllers
> (which keep calling with no `now`).

### 1.2 Re-fetch the `User` before every matrix-mutating call — REQUIRED (correctness)

**Why:** the signed `preferenceMatrix` is read-modify-write. Reuse a stale in-memory
`User` across calls and each call overwrites the others' accumulated +1/−1 updates,
silently corrupting the very Phase-2 signal we are trying to generate. This is the
easiest bug to introduce, hence the explicit call-out.

`SchedulerService.applyPreference` reads `user.preferenceMatrix` **from the passed object**
and writes the result back (`scheduler.service.ts:627`). If the simulator caches one `User`
object and reuses it across many `complete`/`reschedule` calls, each call starts from the
**stale** matrix and overwrites the committed accumulation — silently corrupting the Phase-2
signal. So the runner must reload the user (`prisma.user.findUniqueOrThrow`) immediately
before each call that can touch the matrix (`reschedule`, `resize`, `complete`). This is a
simulator discipline, not a code change — but it is the easiest bug to introduce, so it's
called out here.

---

## 2. New module: `backend/src/simulation/`

This is the simulator itself. Reading order mirrors the data flow: seeded randomness
(`rng`) and a virtual `clock` underpin everything; `personas/` defines and samples the
synthetic users and their hidden fields; `behavior/` generates tasks and decides
reactions; `runner.ts` is the closed loop that ties them to the real services; `eval/`
reads the resulting log back out as metrics.

```
backend/src/simulation/
  rng.ts                       # seeded PRNG + sampling helpers (deterministic)
  clock.ts                     # virtual clock spanning the ~1-year window
  personas/
    archetypes.ts              # the 5 archetypes as parameter DISTRIBUTIONS
    persona.factory.ts         # sample a Persona; seed its User + Tag rows
    preference-field.ts        # build P_global (672) + P_tag; score a candidate slot
  behavior/
    task-generator.ts          # per-persona daily task stream (est + true duration)
    reaction.model.ts          # keep/move/resize decision; outcome decision
  runner.ts                    # the closed loop (drives the real services)
  run.ts                       # entry point: parse args, bootstrap Nest, run
  eval/
    metrics.ts                 # MAR, acceptance, move-distance, … from TaskEvent log
    replay.ts                  # IPS/SNIPS offline replay scaffold (§13 Step 1)
  simulation.module.ts         # wires providers for the standalone context
```

### 2.1 `rng.ts` — determinism

A single seeded PRNG drives all randomness so a run is byte-reproducible (no
`Math.random()`). Note: the seed runner is a normal Node process, so `Date` works — but we
still inject `seed` + `startDate` for reproducibility, not because the runtime forbids them.

```ts
// mulberry32 — tiny, fast, seedable
export function makeRng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,                                            // uniform [0,1)
    int: (n: number) => Math.floor(next() * n),
    normal: (mean = 0, sd = 1) => {                  // Box–Muller
      const u = 1 - next(), v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    lognormal: (mu: number, sigma: number) => Math.exp(mu + sigma * /* normal(0,1) */ 0),
    pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)],
    weighted: <T>(xs: T[], w: number[]) => { /* cumulative-sum sample */ return xs[0]; },
  };
}

export const round15 = (m: number) => Math.max(15, Math.round(m / 15) * 15);
```

### 2.2 `personas/archetypes.ts` — distributions, not fixed values

Each archetype is a set of parameter *distributions* (strategy §4.2). A persona is a draw
(strategy §4.3). Centers below are illustrative; calibrate with §4.

```ts
export interface Archetype {
  id: 'dev' | 'night_owl' | 'ops' | 'pm' | 'crammer';
  label: string;
  work: { start: [number, number]; end: [number, number]; days: number[] }; // [mean, sd] minutes
  timezones: string[];
  peaks: { day: number; block: number; height: number; spread: number }[];  // P_global bumps
  tagMix: { name: string; weight: number }[];
  tagBias: Record<string, { mu: number; sigma: number }>;     // actual/estimated, lognormal
  tagTimeInteractions?: { tag: string; block: number; delta: number }[];     // P_tag — Phase-3 signal
  editPropensity: [number, number];      // [mean, sd]
  moveThreshold: [number, number];
  discipline: { complete: number; reschedule: number; abandon: number };
  noiseFloor: [number, number];
  procrastination: [number, number];
  fixedLoadPerWeek: [number, number];
  driftPerMonth: { peakShiftBlocks: number; biasDecay: number };
}

export const ARCHETYPES: Archetype[] = [ /* dev, night_owl, ops, pm, crammer (strategy §4.2) */ ];
export const POPULATION = [ { archetype: 'dev', count: 12 }, /* …unequal sizes… */ ];
```

### 2.3 `personas/persona.factory.ts` — sample + seed the `User`

```ts
export interface Persona {
  userId: string;
  archetypeId: Archetype['id'];          // GROUND TRUTH for Phase-4 recovery — never fed to a learner
  prefs: { workStart: number; workEnd: number; workDays: number[]; timezone: string };
  pGlobal: Float64Array;                 // 672 cells, the hidden placement field
  pTag: Map<string, Float64Array>;       // per-tag deviations (the Phase-3-only signal)
  tagBias: Map<string, { mu: number; sigma: number }>;
  editPropensity: number; moveThreshold: number; noiseFloor: number; procrastination: number;
  discipline: { complete: number; reschedule: number; abandon: number };
  // …
}

// Draw latent params from the archetype (seeded), then persist the User + Tag rows.
export async function seedPersona(prisma: PrismaService, a: Archetype, seed: number): Promise<Persona> {
  const rng = makeRng(seed);
  const user = await prisma.user.create({
    data: {
      name: `${a.label} #${seed}`, email: `sim-${a.id}-${seed}@zenflow.sim`,
      timezone: rng.pick(a.timezones),
      workStart: round15(rng.normal(a.work.start[0], a.work.start[1])),
      workEnd:   round15(rng.normal(a.work.end[0], a.work.end[1])),
      workDays:  a.work.days,
      onboardingComplete: true,
      // preferenceMatrix left []: seeded lazily by the real applyPreference path.
      roleArchetypeId: null,            // Phase-4 cold-start fills this; ground truth kept in Persona only
    },
  });
  await prisma.tag.createMany({
    data: a.tagMix.map((t) => ({ userId: user.id, name: t.name })), skipDuplicates: true,
  });
  return buildPersona(user, a, rng);
}
```

Note the archetype label lives **only** in the in-memory `Persona` (and an out-of-band
labels file for evaluation) — never in a column a learner reads, or Phase-4 recovery becomes
circular (strategy §1.1, §10.3).

### 2.4 `personas/preference-field.ts`

Builds `P_global` as a sum of Gaussian bumps over the 7×96 grid (indexing matches
`scheduler/slot.ts` `preferenceIndex`: `(isoWeekday-1)*96 + slotOfDay`), adds per-tag
deltas for `P_tag`, and exposes:

```ts
export function scoreSlot(persona: Persona, slot: Date, tags: string[], deadline: Date | null): number {
  const i = preferenceIndex(slot, persona.prefs.timezone);   // reuse the real indexer
  let s = persona.pGlobal[i];
  for (const t of tags) s += persona.pTag.get(t)?.[i] ?? 0;
  if (deadline) s -= persona.procrastination * hoursUntil(deadline, slot); // crammers pull late
  return s;
}
```

### 2.5 `behavior/task-generator.ts`

Per simulated day, emit 0…N task specs (strategy §6, §7): over-dispersed daily count
(weekday × sprint-phase × seasonality), 1–3 tags from the persona's weighted mix, an
**estimated** duration (`round15`), and a separate **true** duration
`round15(est × lognormal(tagBias) )`. Deadlines present with persona probability; `view`
sampled from the persona's weights. Returns `CreateTaskDto`-shaped specs **plus** the hidden
`trueDurationMinutes` the reaction model uses for resizing.

### 2.6 `behavior/reaction.model.ts`

The probabilistic, feasibility-bounded policy (strategy §5). It needs the EDF feasible set,
which the simulator obtains by reading the persona's PENDING tasks and calling the pure
`feasibleSlots` directly (same inputs the service uses):

```ts
export function decidePlacement(persona, task, suggested: Date, feasible: Date[], rng): Date | null {
  if (rng.next() < persona.noiseFloor) return rng.pick(feasible);          // out-of-character
  const best = argmaxBy(feasible, (c) => scoreSlot(persona, c, task.tags, task.deadline)
                                          + rng.normal(0, 0.1));            // not a perfect optimizer
  const worthIt = scoreSlot(persona, best, …) - scoreSlot(persona, suggested, …) > persona.moveThreshold;
  return worthIt && best !== suggested && rng.next() < persona.editPropensity ? best : null; // null = KEEP
}

export function decideOutcome(persona, task, rng): 'complete' | 'reschedule' | 'abandon' { /* simplex + fatigue + deadline pressure */ }
```

`best` is drawn from `feasible` only → the feasibility wall (strategy §2) holds for free.

### 2.7 `runner.ts` — the closed loop

```ts
for (let day = 0; day < SPAN_DAYS; day++) {
  const today = clock.dayStart(day);                       // virtual now
  if (clock.isIdle(persona, day)) continue;                // vacations / holidays / weekends
  for (const spec of generateTasksForDay(persona, today, rng)) {
    const user = await reloadUser(persona.userId);         // §1.2 — fresh preferenceMatrix
    const res  = await tasks.create(toCreateDto(spec), user, clock.at(today, spec.arrivalMin));

    if (res.overflow && !res.schedulingMeta.placedAt) {    // unplaced → maybe accept a recovery option
      if (rng.next() < persona.editPropensity) await tasks.resolveOverflow(res.task.id, pickOption(res.overflow), user, /*now*/);
      continue;
    }
    const suggested = new Date(res.schedulingMeta.placedAt!);
    const feasible  = await computeFeasible(persona, res.task);             // pure feasibleSlots
    const move = decidePlacement(persona, spec, suggested, feasible, rng);
    if (move) await tasks.reschedule(res.task.id, move.toISOString(), await reloadUser(persona.userId), nowAt);
    if (Math.abs(spec.trueDurationMinutes - spec.durationMinutes) >= 15 && rng.next() < persona.editPropensity)
      await tasks.resize(res.task.id, (move ?? suggested).toISOString(), spec.trueDurationMinutes, await reloadUser(persona.userId), nowAt);
  }
  // Settle the day's outcomes for tasks whose slot has passed in virtual time:
  for (const t of await duePendingTasks(persona.userId, clock.endOf(day))) {
    const outcome = decideOutcome(persona, t, rng);
    if (outcome === 'complete') await tasks.complete(t.id, await reloadUser(persona.userId), clock.completionAt(t));
    else if (outcome === 'reschedule') await tasks.reschedule(t.id, nextSlot(t).toISOString(), await reloadUser(persona.userId), nowAt);
    // 'abandon' is left to the sweep below
  }
  await abandoned.sweep(clock.endOf(day));                  // ABANDON for deadline-expired PENDING
}
```

Personas are independent, so the outer loop can be `for (const persona of personas)` around
this, or interleaved by day — either is fine since each persona owns its own `User` rows.

### 2.8 `run.ts` + `simulation.module.ts`

`run.ts` boots a **standalone** Nest context (no HTTP) and resolves the real providers:

```ts
const app = await NestFactory.createApplicationContext(SimulationModule);
const tasks     = app.get(TasksService);
const scheduler = app.get(SchedulerService);
const abandoned = app.get(AbandonedTasksService);
const prisma    = app.get(PrismaService);

const args = parseArgs(process.argv);   // --seed, --start=YYYY-MM-DD, --days=365, --reranker=identity|phase2
await runSimulation({ tasks, scheduler, abandoned, prisma, ...args });
await app.close();
```

`SimulationModule` imports `PrismaModule`, `SchedulerModule`, and `TasksModule` so the real
services are injectable. To A/B a re-ranker (strategy §13), inject the chosen `SlotReRanker`
into `scheduleAll` — the cleanest path is a `--reranker` flag the scheduler reads; until the
Phase-2 re-ranker lands, only `identity` (the Phase-1 baseline) is available.

---

## 3. Wiring: scripts, env, DB isolation

### 3.1 Dedicated sim database

Create `backend/.env.sim` (copy `.env.dev`, point `DATABASE_URL` at a **separate** DB, e.g.
`zenflow_sim`). Never run against dev/prod (strategy §13 isolation).

### 3.2 `backend/package.json` scripts

```jsonc
"sim:run":   "dotenv -e .env.sim -- ts-node -r tsconfig-paths/register src/simulation/run.ts",
"sim:reset": "dotenv -e .env.sim -- npx prisma migrate reset --force",
"sim:eval":  "dotenv -e .env.sim -- ts-node -r tsconfig-paths/register src/simulation/eval/run-metrics.ts"
```

(`ts-node` + `tsconfig-paths` are already used by `test:debug`.) No schema migration is
needed — the data model is complete (strategy §1, §0 here).

---

## 4. Evaluation outputs

- `eval/metrics.ts` — read the `TaskEvent` log per user/day and compute MAR + the supporting
  metrics (definitions in `docs/heuristic.md` §Evaluation, listed in strategy §12). Group by
  `occurredAt` (now faithful thanks to §1.1) and join `oldSnapshot.suggestedStartTime` vs.
  `newSnapshot.scheduledStartTime` for move-distance.
- `eval/replay.ts` — the IPS/SNIPS offline-replay scaffold (strategy §13 Step 1): iterate the
  log, re-score each decision under a candidate `SlotReRanker`, output the off-policy reward
  estimate. The closed-loop A/B (Step 2) is just two `sim:run`s with different `--reranker`
  and the same `--seed`.

---

## 5. Build order (suggested)

1. `rng.ts`, `clock.ts` + their `*.spec.ts` (pure, easy to unit-test first).
2. `archetypes.ts`, `preference-field.ts`, `persona.factory.ts` — seed N users, eyeball them
   in `prisma:dev:studio` (against the sim DB).
3. `task-generator.ts`, `reaction.model.ts` + specs (assert reactions stay within the
   feasible set — strategy §2).
4. The two production edits in §1, then `runner.ts` + `run.ts`; run `sim:run --days=14` and
   confirm `MOVE`/`RESIZE`/`KEEP` rows carry `suggestedStartTime` + tags, and that
   `preferenceMatrix` is accumulating.
5. `eval/metrics.ts`; confirm a non-trivial baseline MAR with the `identity` re-ranker, then
   scale to `--days=365`.

## 6. Verification

- `pnpm --filter backend typecheck && pnpm --filter backend lint` clean.
- Unit specs green: reactions feasibility-bounded; metrics match hand-computed fixtures
  (CLAUDE.md invariant #2 — pure code carries its `*.spec.ts`).
- `pnpm --filter backend sim:run --days=14 --seed=1` populates the sim DB; spot-check events
  in studio.
- Re-running with the same `--seed` reproduces identical per-persona decision streams
  (determinism, strategy §14). Row *ids* are random UUIDs, so they differ run-to-run.
- Production untouched: existing `pnpm --filter backend test` / `test:e2e` still pass (the
  `now` params default to `new Date()`).

---

## 7. Batched mode + shared telemetry builders

The closed loop is identical in both modes; only persistence differs. The day-by-day
logic lives once in `runner.ts:drivePersona(act, …)` and is parameterised over an
`Actuator` (see the two implementations: `ServiceActuator`, `BatchedActuator`).

### 7.1 Shared pure builders — `backend/src/scheduler/telemetry.ts`

The event-snapshot shape, the signed `preferenceMatrix` math, the pairwise conflict
recompute, and the `Task → EdfTask` mapping used to live as private methods inside
`SchedulerService`. They are now **pure functions** in `scheduler/telemetry.ts`, called by
BOTH the services and the batched engine — a single source of truth so the in-memory path
can't drift from production:

| Builder | Replaces (was private in `SchedulerService`) |
|---------|----------------------------------------------|
| `EVENT_REWARD` | the inline `rewardScore` literals (CREATE/KEEP/COMPLETE=+1, MOVE/RESIZE=0, ABANDON=−1) |
| `buildSnapshot(task, tags, suggested?)` | `snapshot(...)` |
| `applyPreferenceDeltas(matrix, deltas, tz)` | the matrix math inside `applyPreference(...)` |
| `recomputeConflicts(projected)` | `recomputeConflicts(...)` |
| `toEdfTask(task, prefs)` | `toEdf(...)` (period-ceiling derivation) |

The services now delegate to these; behavior is byte-for-byte unchanged (guarded by the
existing scheduler specs). `EVENT_REWARD` is also used by `TasksService` (CREATE/COMPLETE)
and `AbandonedTasksService` (ABANDON).

### 7.2 In-memory engine — `backend/src/simulation/batched/`

- `engine.ts` — `PersonaState` reproduces the production lifecycle in memory
  (`create`/`reschedule`(pin)/`resize`/`resolveOverflow`/`complete`/`sweep`), each emitting
  the same events + matrix updates via the §7.1 builders, plus the EDF cascade
  (`scheduleAll`) and overflow helpers. Holds one user's tasks/events/tags + matrix.
- `writer.ts` — `bulkWrite()` flushes users → tags → tasks → the implicit `_TagToTask`
  join (a chunked raw `INSERT`, since `createMany` can't express implicit M2M) → events,
  all in 50k-row chunks. The runner flushes **per persona** to bound memory.
- Persona seeding is split so both modes draw an identical RNG stream:
  `persona.factory.ts:buildPersonaRecord()` builds the `User` row + `Persona` in memory
  (UUID minted up front); `seedPersona()` (service mode) wraps it and persists.

### 7.3 One concurrency-safety change to production

`AbandonedTasksService.sweep(now, userId?)` gained an optional `userId` scope. The cron
still sweeps everyone (`userId` omitted); the simulator scopes each sweep to its own
persona so the service path can drive personas concurrently without two sweeps
double-abandoning a shared row. Default behavior is unchanged.

### 7.4 CLI

`sim:run` accepts `--mode=batched|service` (default `batched`), `--concurrency=<n>`
(service mode persona parallelism; default 8), plus the existing `--seed`, `--start`,
`--days`, `--personas`. Seed the full year with:

```
pnpm --filter backend sim:reset      # destructive; sim DB only
pnpm --filter backend exec -- dotenv -e .env.sim -- \
  node dist/simulation/run.js --days=365 --start=2025-06-19 --mode=batched
```

`eval/count.ts` (`node dist/simulation/eval/count.js`) prints a quality snapshot
(status/event counts, timezones, night-owl windows, tags-per-task histogram, max
conflict-stack depth, create-before-adjust violations).

### 7.5 Behavioral realism (strategy §4–§7 calibration)

The persona/behaviour model was tuned for human realism:

- **Night-owl wrap window.** The `night_owl` archetype now works **18:00 → 03:00 next
  day** (`workStart > workEnd`); arrivals/peaks live in the night hours. The pure
  scheduler already supports wrap windows (`slot.ts:workWindowFor`); the generator's
  arrival span uses `workWindowMinutes` so post-midnight arrivals roll correctly.
- **Real timezones only.** No persona is seeded in `UTC` anymore.
- **Creation precedes adjustments.** Each task's MOVE/RESIZE events are stamped on a
  per-task action clock strictly *after* its CREATE (a human creates, then nudges).
- **Done-but-unmarked backlog.** A persona marks only `markCompleteRate` of the work it
  actually finishes; the rest lingers as PENDING (revisited later) — so the board shows a
  realistic pile of completed-but-unticked tasks.
- **Shallow conflicts.** Next-day reschedules spread across feasible slots instead of all
  piling on work-start, capping the conflict-stack depth at ~2–3 (was 4–5).
- **Intermediate fidgeting.** A few extra in-day small moves / minor resizes (gated by
  `editPropensity`) add realistic MOVE/RESIZE telemetry noise without manufacturing
  conflicts.
- **Richer tags.** Per-task tag count is Gaussian, clamped to **0–10** (mean ~2.6); the
  vocabulary blends the persona's signal tags, its specific **project tags** (`project-x`,
  `acme-corp`, …), and the global noise pool.
- **More + overdue deadlines.** `deadlineProb` is higher across archetypes, a slice of
  deadline tasks arrive already past-due, and the abandon sweep is held back during the
  held-out tail so a realistic **overdue PENDING** backlog survives at snapshot.
