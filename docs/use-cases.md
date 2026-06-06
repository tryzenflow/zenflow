# Use Cases

Structured actor-goal specifications. Actor is always **User** unless noted. System-initiated use cases use **System** as actor.

---

## UC-01: Register and Onboard

**Actor:** User  
**Precondition:** User has no account.  
**Trigger:** User visits the app for the first time.

**Main Flow:**
1. User submits registration form (email, password).
2. System creates user record, generates session token.
3. System redirects to Onboarding Wizard (SCR-01).
4. User sets work start/end hours.
5. User selects work days.
6. User selects a role archetype.
7. System stores preferences, seeds penalty matrix (zeros), assigns archetype.
8. System redirects to Day View (SCR-02).

**Postcondition:** User account exists with preferences; EDF engine is ready to accept tasks.

**Alternate:** Step 1 fails (email taken) → System shows validation error; user corrects.

---

## UC-02: Create a Flexible Task

**Actor:** User  
**Precondition:** User is authenticated and onboarded.

**Main Flow:**
1. User clicks "+ Add Task" or presses `N`.
2. Task Creation Panel (SCR-05) slides open.
3. User enters title.
4. User selects duration (e.g., 45 min).
5. Type remains "Flexible" (default).
6. User optionally sets deadline and tags.
7. User clicks "Create Task."
8. System applies estimation bias (if applicable) and rounds duration up to nearest 15-min multiple.
9. System queries FastAPI bandit (Phase 3+) or runs pure EDF (Phase 1–2) to assign `scheduled_start_time`.
10. System writes task + CREATE event to database.
11. Task card appears on calendar at assigned slot.
12. Panel closes.

**Postcondition:** Task is in PENDING state with a `scheduled_start_time` within the active view horizon.

**Alternate (Conflict):** No slot is available before deadline → task enters Conflict state (amber), surfaces in Agenda Queue. User is prompted to resolve manually.

---

## UC-03: Create a Fixed Task

**Actor:** User  
**Precondition:** User is authenticated and onboarded.

**Main Flow:**
1. User opens Task Creation Panel.
2. User toggles Type to "Fixed."
3. Start time picker appears; user selects a time (e.g., 02:00 PM).
4. User fills remaining fields.
5. User clicks "Create Task."
6. System stores task with `fixed: true`, `start_time: 840` (14 × 60).
7. System treats this slot as an immutable anchor for all future cascade operations.

**Postcondition:** Fixed task is placed at exactly the chosen start time; it cannot be moved by the engine.

---

## UC-04: Create a Recurring Task

**Actor:** User  
**Precondition:** User is in Week or Month view.

**Main Flow (Week view):**
1. User opens Task Creation Panel.
2. Recurrence section is visible (hidden in Day view).
3. User selects "Every X days" (e.g., every 2 days) or "Specific days" (e.g., Mon, Wed, Fri).
4. System generates an RFC 5545 `rrule` string and stores it on the task.
5. System expands the recurrence into discrete single-instance tasks within the active week.
6. Each instance appears as an independent task card on its respective day column.

**Postcondition:** Multiple task cards exist on the calendar, each linked by the same `rrule` root.

---

## UC-05: View Day Schedule

**Actor:** User  
**Precondition:** At least one task exists.

**Main Flow:**
1. User is on Day View (SCR-02).
2. System renders tasks for the current day sorted by `scheduled_start_time`.
3. Task cards are positioned using: `top = (start_offset_minutes / total_work_minutes) × 100%` and `height = (duration_minutes / total_work_minutes) × 100%`.
4. The "Now" line is overlaid at the current time.

---

## UC-06: Manually Move a Task

**Actor:** User  
**Precondition:** Task is visible on the calendar.

**Main Flow:**
1. User mouse-down on a task card (cursor: grab).
2. User drags card to a new 15-minute slot.
3. System snaps card to nearest 15-min boundary on release.
4. System checks for conflict with fixed tasks.
5. If no conflict: System updates `scheduled_start_time`, writes MOVE event, increments `penalty_matrix[old_slot_index]`.
6. If conflict with fixed task: System triggers Cascading Realignment — moves "Index Refactor" to next available slot instead; writes MOVE event for the displaced task.

**Postcondition:** Task is at the user-chosen position; penalty matrix is updated; telemetry recorded.

**Alternate (No slot available):** Task enters Conflict state; user is notified.

---

## UC-07: Resize a Task

**Actor:** User  
**Precondition:** Task is visible on calendar.

**Main Flow:**
1. User hovers bottom edge of task card; resize cursor appears.
2. User drags edge up or down.
3. System snaps to nearest 15-min boundary.
4. System writes RESIZE event with old and new `duration_minutes`.
5. `estimation_bias` table is updated asynchronously by the daily cron.

**Postcondition:** Task has a new `duration_minutes`; RESIZE telemetry recorded.

---

## UC-08: Complete a Task

**Actor:** User

**Main Flow:**
1. User clicks the completion checkbox/button on a task card or in the Task Detail Panel (SCR-06).
2. System sets `status = DONE`.
3. System writes COMPLETE event with `reward_score = 1.0`.
4. Task card enters Completed visual state (muted, strikethrough, emerald left border).

**Postcondition:** Task is DONE; EDF engine will not route around it in future scheduling passes.

---

## UC-09: Resolve a Conflict

**Actor:** User  
**Precondition:** A task is in Conflict state (no slot before deadline).

**Main Flow:**
1. Conflict task appears amber in the Agenda Queue sidebar.
2. System offers "Find Better Slot Automatically" action.
3. User clicks the action.
4. System re-evaluates: extends horizon (e.g., into next day), finds first available slot, reschedules.
5. If no slot in extended horizon: System prompts user to extend deadline or reduce duration.

**Alternate (Manual):** User drags the conflict task to a preferred slot manually.

---

## UC-10: Calculate Estimation Bias (System)

**Actor:** System (daily cron, ~00:05 UTC)  
**Precondition:** COMPLETE events exist with at least 5 samples per tag per user.

**Main Flow:**
1. System queries `task_events` for all COMPLETE events since last cron run.
2. For each user × tag pair: calculates `bias = mean(actual_duration / estimated_duration)`.
3. System upserts `estimation_bias` records.
4. Bias becomes active in next task creation cycle.

---

## UC-11: Seed New User from Archetype (System)

**Actor:** System  
**Trigger:** Onboarding completes; `role_archetype_id` is set.  
**Precondition:** Phase 4 is active.

**Main Flow:**
1. System looks up the archetype's baseline `penalty_matrix` and bandit `weight_matrix` from aggregate cluster data.
2. System writes these baseline values to the user's `penalty_matrix` (stored in users table) and `bandit_models` records.
3. All subsequent scheduling for this user starts from the archetype baseline rather than zeros.

**Postcondition:** New user receives intelligent scheduling from day one.
