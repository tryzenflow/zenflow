# Screens

Screen inventory for Zenflow. Each screen links to its HTML mockup.

---

## Navigation Map

```
 ┌─────────────────────────────────────────────────────┐
 │                    Zenflow App                       │
 │                                                      │
 │  [Not Authenticated] ──► Onboarding Wizard           │
 │                               │                      │
 │                               ▼                      │
 │              ┌────────────────────────────┐          │
 │              │      Dashboard Shell       │          │
 │              │  ┌──────┬──────┬───────┐   │          │
 │              │  │ Day  │ Week │ Month │   │          │
 │              │  └──┬───┴──┬───┴───┬───┘   │          │
 │              │     │      │       │        │          │
 │              │  Day View  │  Month View    │          │
 │              │       Week View             │          │
 │              └────────────────────────────┘          │
 │                          │                           │
 │              [+ Add Task] ──► Task Creation Panel    │
 │              [Task click] ──► Task Detail Panel      │
 └─────────────────────────────────────────────────────┘
```

---

## Screen Catalog

### SCR-01: Onboarding Wizard

**Entry point:** First login after registration.  
**Exit:** Completes onboarding → redirects to Day View.  
**Mockup:** [01-onboarding.html](mockups/01-onboarding.html)

**Steps:**
1. **Welcome** — Product value proposition and CTA to begin.
2. **Work Hours** — Time range pickers for `work_start` and `work_end`.
3. **Work Days** — Checkbox group (Mon–Sun) to select working days.
4. **Role** — Single-select archetype chips (e.g., Engineer, Designer, Manager, Operator) for Phase 4 cold-start seeding.
5. **Done** — Confirmation with a summary of configured preferences.

**Key components:** Step progress indicator, time picker, day selector chip group, role chip group, primary CTA button.

---

### SCR-02: Day View

**Entry point:** Default dashboard after onboarding; Day tab in header.  
**Mockup:** [02-day-view.html](mockups/02-day-view.html)

**Layout:** Tri-panel — left sidebar + top header + main canvas.

**Left Sidebar:**
- Zenflow wordmark
- Day load capacity progress bar (allocated hours / total work hours)
- Agenda Queue — ordered list of today's tasks (name + scheduled time)
- Conflict queue — amber-flagged tasks requiring user resolution

**Top Header:**
- Day / Week / Month view toggle
- Date navigation (← today →)
- Current date label
- System status badge (e.g., "All Tasks Scheduled Optimally")
- "+ Add Task" primary button

**Main Canvas:**
- Time ruler (left gutter, full day — 12 AM to 11 PM or configurable range)
- Task cards positioned absolutely by `scheduled_start_time` and `duration_minutes`
- "Now" indicator line (red dot + horizontal rule)
- Working-hour zone: full contrast (`bg-card`)
- Non-working-hour zones: slightly dimmed (`bg-muted/40`) but fully droppable for one-off exceptions

**Task card states:** Fluid (violet left border), Fixed (dashed border + lock icon), Overdue (red), Conflict (amber), Completed (muted + strikethrough).

---

### SCR-03: Week View

**Entry point:** Week tab in header.  
**Mockup:** [03-week-view.html](mockups/03-week-view.html)

**Layout:** Same tri-panel as Day View.

**Main Canvas:**
- Time ruler (left gutter)
- 5-column grid (Mon–Fri; Sat/Sun hidden unless in `work_days`)
- Day column headers show abbreviated weekday + date
- Today's column highlighted with subtle background tint
- Task cards narrow to fit within day columns

**Recurrence UI:** Tasks with `rrule` show across multiple day columns.

---

### SCR-04: Month View

**Entry point:** Month tab in header.  
**Mockup:** [04-month-view.html](mockups/04-month-view.html)

**Layout:** Same tri-panel.

**Main Canvas:**
- 7-column grid (Mon–Sun header row)
- Days of month fill a 5–6 row grid
- Non-work-day cells (weekend, if not in `work_days`) are subtly dimmed
- Task cards condense to single-line micro-capsules: `HH:MM · Task title`
- Status color is preserved on the left border accent

---

### SCR-05: Task Creation Panel

**Entry point:** "+ Add Task" button; keyboard shortcut `N`.  
**Mockup:** [05-task-creation.html](mockups/05-task-creation.html)

**Behavior:** Slides in from the right as an overlay panel (does not collapse main canvas).

**Form fields:**
| Field | Control | Notes |
|---|---|---|
| Title | Text input | Auto-focused on open |
| Duration | Segmented quick-pick (15m, 30m, 45m, 1h, 2h, custom) | Snaps to 15-min multiples |
| Type | Toggle (Flexible / Fixed) | Fixed reveals start time picker |
| Start time | Time picker | Visible only when Fixed |
| Deadline | Date picker | Optional |
| Tags | Tag input with autocomplete | Multi-select, free-form |
| Recurrence | Conditional section | Hidden in Day view; by-day in Week, by-week in Month |

**Actions:** Cancel (dismiss panel), Create Task (submit → EDF engine).

---

### SCR-06: Task Detail Panel

**Entry point:** Click on any task card.  
**Mockup:** [06-task-detail.html](mockups/06-task-detail.html)

**Behavior:** Same slide-over panel as creation, but pre-populated with existing task data.

**Additional elements vs SCR-05:**
- `scheduled_start_time` display (read-only, set by engine)
- `status` toggle (PENDING → DONE)
- Estimation bias indicator (e.g., `#backend: ×1.2 bias applied`)
- Task history — last N events from `task_events` (created, moved ×2, etc.)
- Delete task (destructive action with confirmation)

---

### SCR-07: Settings (deferred — v1.1)

User preferences: update work hours, work days, timezone, and archetype. This screen is out of scope for Phase 1 but reserved in navigation.
