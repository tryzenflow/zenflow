# Architectural Decision Records

Records of significant design decisions, the alternatives considered, and the rationale for the choice made.

---

## ADR-001: 15-Minute Block Unit

**Status:** Accepted  
**Date:** 2026-01

**Context:** Scheduling granularity is the primary UX lever. Too fine (5 min) creates micro-management pressure. Too coarse (1 hour) prevents accurate planning.

**Decision:** All task durations are enforced as multiples of 15 minutes at both the API (validation) and UI (snap-to-grid) layers.

**Rationale:** 15 minutes is the smallest unit where humans feel meaningful progress without anxiety. 48 slots/day (half-hour for penalty matrix storage) vs. 96 (quarter-hour) makes the penalty array half the size with negligible accuracy loss.

**Rejected alternative:** 30-minute blocks — too coarse for small maintenance tasks (e.g., a 15-minute log rotation becomes a padded 30-minute slot).

---

## ADR-002: No Earliest Start Date

**Status:** Accepted  
**Date:** 2026-01

**Context:** Traditional calendars allow setting a "not before" date for tasks, leading to large backlogs of deferred tasks that clutter the view without being actionable.

**Decision:** Tasks added to Zenflow are assumed immediately executable from `max(now, user.work_start)`. No "earliest start date" field.

**Rationale:** Removes the cognitive burden of a task backlog. If a task truly cannot start now, the user should not add it yet. Forces intentionality about what's actually on the user's plate.

**Rejected alternative:** Optional `earliest_start` — adds form complexity and reintroduces backlog anxiety.

---

## ADR-003: EDF as Base Scheduling Algorithm

**Status:** Accepted  
**Date:** 2026-01

**Context:** Phase 1 needs a deterministic, explainable scheduling algorithm that users can intuitively understand ("tasks with closer deadlines go first").

**Decision:** Earliest-Deadline First (EDF) is the foundational engine. Tasks without deadlines are treated as buffer tasks with a soft deadline equal to the end of the current view horizon.

**Rationale:** EDF is O(n log n) (sort), deterministic, optimal for single-processor scheduling under the deadline minimization criterion, and explainable. Users can predict the engine's behavior without learning ML concepts.

**Rejected alternatives:**
- Shortest-Job-First — ignores deadlines, wrong optimization target.
- Manual only — no value proposition for the product.

---

## ADR-004: PostgreSQL text[] for Tags (No Tag Table)

**Status:** Accepted  
**Date:** 2026-01

**Context:** Tasks have multiple tags. Options are: normalized tag table + junction table, JSON column, or native PostgreSQL array.

**Decision:** Tags stored as `text[]` on the `tasks` table via Prisma's `String[]` type.

**Rationale:** Tags in Zenflow are free-form labels, not structured entities. A normalized tag table with foreign keys adds join overhead at query time and schema complexity at migration time. PostgreSQL's `text[]` supports GIN-indexed containment queries (`@>`) efficiently. The multi-hot encoding for ML purposes is computed at runtime from a global tag pool — not from a normalized table.

**Trade-off:** Harder to rename a tag across all tasks (requires a table scan + update). Accepted given tags are low-cardinality and rarely renamed.

---

## ADR-005: FastAPI for the Bandit Microservice

**Status:** Accepted  
**Date:** 2026-01

**Context:** The contextual bandit (LinUCB) requires a Python ML runtime. The main API is NestJS (TypeScript).

**Decision:** A separate FastAPI microservice handles all bandit predictions. NestJS calls it via internal HTTP.

**Rationale:** Python's ML ecosystem (numpy, scipy, sklearn, LightFM) is irreplaceable for the bandit and Phase 4 collaborative filtering. FastAPI's async model handles concurrent prediction requests efficiently. Keeping it separate avoids polluting the NestJS process with Python dependencies.

**Trade-off:** Added network hop (~10ms) per prediction. Acceptable given NFR-02 (< 150ms P95 total).

---

## ADR-006: Penalty Matrix as Flat Array (Not 2D Structure)

**Status:** Accepted  
**Date:** 2026-01

**Context:** The 7×48 penalty matrix could be stored as a 2D array, a JSONB object, or a flat integer array.

**Decision:** Flat `int[]` array of 336 integers, stored in the `users` table. Coordinate formula: `index = (day × 48) + time_block`.

**Rationale:** Flat arrays enable O(1) point reads and writes without object deserialization overhead. Stored directly on the user row, fetched in the same query as user preferences — no additional join. PostgreSQL's array element update (`penalty_matrix[i] = penalty_matrix[i] + 1`) is a single-field atomic update.

---

## ADR-007: Conservative Max-Bias Strategy for Multi-Tag Duration

**Status:** Accepted  
**Date:** 2026-01

**Context:** A task with multiple tags (e.g., `#backend` ×1.2, `#critical` ×1.5) could have its duration compounded multiplicatively (×1.8) or additively (×1.35), or resolved by max (×1.5).

**Decision:** Use the maximum single-tag multiplier.

**Rationale:** Multiplicative compounding causes explosive duration inflation (a 3-tag task could balloon to 3× estimated). Additive compounding is arbitrary. The conservative max provides a meaningful schedule buffer without over-padding — it respects the most significant known bias while avoiding combinatorial explosion.

---

## ADR-008: View-Scoped Recurrence

**Status:** Accepted  
**Date:** 2026-01

**Context:** Recurrence is notoriously complex. Options: full iCalendar RRULE support, simple weekly/monthly presets, or view-scoped presets.

**Decision:** Recurrence is only configurable when the user is in Week or Month view. Day view hides recurrence options entirely. The resulting `rrule` string (RFC 5545) is stored and used to expand instances within the active view window.

**Rationale:** Day view's single-day horizon makes recurrence meaningless — it would generate one instance anyway. View-scoping reduces cognitive load: users configure recurrence in the context where they can see it working across multiple days/weeks. RFC 5545 storage ensures forward compatibility with calendar sync (iCal export).

---

## ADR-009: NestJS for the API Layer

**Status:** Accepted  
**Date:** 2026-01

**Context:** Backend API choices: Express, Fastify, NestJS, or a fully managed BaaS.

**Decision:** NestJS with TypeScript.

**Rationale:** NestJS provides opinionated module/controller/service architecture that maps cleanly to Zenflow's domain (UsersModule, TasksModule, BanditModule). Built-in support for CQRS patterns for the telemetry pipeline. First-class Prisma integration. Decorators reduce boilerplate for auth guards and validation pipes. TypeScript end-to-end from API contracts to frontend.

---

## ADR-010: Stone + Violet Design System

**Status:** Accepted  
**Date:** 2026-06

**Context:** Initial prototype used Indigo as the accent color. User feedback: Indigo feels too corporate/generic for a "Zen" focus app.

**Decision:** Replace Indigo with Violet accent (hue ~302) on a Stone base. See [Design System](design-system.md) for full rationale and token values.

**Rationale:** Violet is warmer than Indigo, carries mindfulness associations, and is more distinctive in the productivity tool market. Stone base provides calm, warm neutrals versus Zinc's cool/clinical gray.

**Rejected alternatives:**
- Green accent — too health/wellness; risks nature app perception.
- Blue accent — generic; indistinguishable from most SaaS.
- Mauve base — too warm/saturated for a dense calendar grid.
