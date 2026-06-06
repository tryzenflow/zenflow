# Zenflow Wiki

> Focus-First Work Planner — minimize cognitive fatigue, maximize deep work.

---

## Navigation

| Document | Description |
|---|---|
| [Requirements](requirements.md) | Functional and non-functional requirements |
| [Objects](objects.md) | Domain model — entities, value objects, conceptual models |
| [Screens](screens.md) | Screen inventory and navigation map |
| [Use Cases](use-cases.md) | Actor-goal use case specifications |
| [Design System](design-system.md) | Visual language, tokens, component rules |
| [ADR](adr.md) | Architectural decision records |
| [System Design](system-design.md) | Infrastructure and runtime architecture |
| [Database Design](database-design.md) | Schema, indexes, data flow |
| [API Contracts](api-contracts.md) | REST endpoint specifications |
| [Project Structure](project-structure.md) | Monorepo layout and module ownership |
| [Heuristic Progression](heuristic-progression.md) | Intelligence evolution across four phases |

### Mockups

All screens rendered as standalone HTML files using the Zenflow design system.

| Screen | File |
|---|---|
| Onboarding | [mockups/01-onboarding.html](mockups/01-onboarding.html) |
| Day View | [mockups/02-day-view.html](mockups/02-day-view.html) |
| Week View | [mockups/03-week-view.html](mockups/03-week-view.html) |
| Month View | [mockups/04-month-view.html](mockups/04-month-view.html) |
| Task Creation Panel | [mockups/05-task-creation.html](mockups/05-task-creation.html) |
| Task Detail Panel | [mockups/06-task-detail.html](mockups/06-task-detail.html) |

---

## Product Philosophy

Zenflow enforces three constraints that distinguish it from general-purpose calendars:

1. **15-Minute Block Unit** — prevents micro-management anxiety while allowing precise allocation.
2. **Immediate Execution Model** — no "earliest start date"; if a task exists, it's ready now.
3. **Implicit Deadline Optimization** — optional deadlines; no deadline means soft-bounded by the active view window.

## Intelligence Roadmap

```
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4
EDF Core     Heuristic    Contextual   Collaborative
(Pure Logic) (Bias Rules) (LinUCB)     (Archetypes)
```
