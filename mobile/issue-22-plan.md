# Issue #22 — Mobile Day View Implementation Plan

## Overview

Build the Day View screen for the mobile app — a gesture-first 24h scrollable timeline.
This requires two tracks of work:

1. **Extract** pure calendar utilities from `frontend/src/utils/` into `@zenflow/core` so both web and mobile share them
2. **Build** the Day View components in `mobile/` using those shared utilities

**Branch:** `feat/issue-22-mobile-day-view`

---

## Step 1: Add Event/DaySegment types to `@zenflow/shared`

**File:** `packages/shared/src/schedule.ts` (new file)

Add the `Event` and `DaySegment` interfaces. These are pure data shapes — no imports needed except from the same package (`Task`, `TaskStatus`, `TaskCardState`).

```ts
// Event = a positioned calendar block (one scheduled task)
// DaySegment = an Event clamped to a single day (for cross-midnight splitting)
```

Then re-export from `packages/shared/src/index.ts`.

**Why:** Both `@zenflow/core`'s extracted functions and both apps need these types. Adding new types doesn't change existing code — just requires `pnpm shared:build`.

**Impact:** Zero breaking changes. Only adds new exports.

---

## Step 2: Extract utilities to `@zenflow/core`

Add 4 new files to `packages/core/src/`:

| New file | What it exports | Source |
|----------|----------------|--------|
| `constants.ts` | `TIME_GRANULARITY`, `WEEK_STARTS_ON` | `frontend/src/utils/constants.ts` |
| `zones.ts` | `getDayZones`, `HOUR_PX`, `DAY_PX`, `DEFAULT_WORK_PREFS` | `frontend/src/utils/zones.ts` |
| `task-card.ts` | `deriveState`, `withOverlap`, `TASK_CARD_CLASSES` | `frontend/src/lib/task-card.ts` |
| `blocks.ts` | `taskToBlock`, `tasksToBlocks`, `eventsForDay`, `crossesMidnight` | `frontend/src/utils/blocks.ts` |
| `overlap.ts` | `getOverlapLayout`, `BlockLayout` | `frontend/src/utils/overlap.ts` |

Update `packages/core/src/index.ts` to re-export all of them.

**Dependency chain:**
```
@zenflow/shared  ←  @zenflow/core  ←  frontend / mobile
       ↑                   ↑
  Event, DaySegment   constants, zones, task-card, blocks, overlap
  DAILY_HORIZON       TIME_GRANULARITY, WEEK_STARTS_ON
  Task, TaskStatus    deriveState, getDayZones, eventsForDay, ...
  TaskCardState       HOUR_PX, DAY_PX, DEFAULT_WORK_PREFS
```

No circular dependencies. `@zenflow/core` depends on `@zenflow/shared` (already does) and `date-fns`/`date-fns-tz` (already peers).

**After this step:** run `pnpm core:build` to verify it compiles.

---

## Step 3: Update web frontend imports

Change all 21+ import sites in `frontend/src/` from local paths to `@zenflow/core`:

| Old import | New import |
|-----------|-----------|
| `from "@/utils/constants"` | `from "@zenflow/core"` |
| `from "@/utils/zones"` | `from "@zenflow/core"` |
| `from "@/utils/blocks"` | `from "@zenflow/core"` |
| `from "@/utils/overlap"` | `from "@zenflow/core"` |
| `from "@/lib/task-card"` | `from "@zenflow/core"` |
| `from "@/types/schedule"` | `from "@zenflow/shared"` (for `Event`, `DaySegment`) |

**Files to update:**

- `frontend/src/components/calendar/day-view.tsx`
- `frontend/src/components/calendar/day-grid.tsx`
- `frontend/src/components/calendar/day-column-background.tsx`
- `frontend/src/components/calendar/day-cell.tsx`
- `frontend/src/components/calendar/scheduled-block-item.tsx`
- `frontend/src/components/calendar/week-view.tsx`
- `frontend/src/components/calendar/week-grid.tsx`
- `frontend/src/components/calendar/month-view.tsx`
- `frontend/src/components/calendar/month-grid.tsx`
- `frontend/src/components/calendar/month-cell.tsx`
- `frontend/src/components/calendar/header.tsx`
- `frontend/src/components/calendar/layout.tsx`
- `frontend/src/components/calendar/sidebar.tsx`
- `frontend/src/components/calendar/view-mode-select.tsx`
- `frontend/src/components/ui/time-picker.tsx`
- `frontend/src/components/tasks/duration-input.tsx`
- `frontend/src/components/tasks/form/deadline-chip-field.tsx`
- `frontend/src/hooks/use-view-shortcuts.ts`
- `frontend/src/utils/navigation.ts`

**Delete after extraction:**
- `frontend/src/lib/task-card.ts`
- `frontend/src/utils/constants.ts`
- `frontend/src/utils/zones.ts`
- `frontend/src/utils/blocks.ts`
- `frontend/src/utils/overlap.ts`
- `frontend/src/types/schedule.ts`

**After this step:** run `pnpm shared:build && pnpm --filter frontend typecheck` to verify nothing broke.

---

## Step 4: Add missing mobile dependencies

```bash
pnpm --filter mobile add expo-haptics
```

Verify `@zenflow/core` is already a dependency (it is — `"@zenflow/core": "workspace:*"` in mobile/package.json).

---

## Step 5: Build Day View — static rendering

### New files in `mobile/`

```
mobile/lib/
├── constants.ts        ← re-export from @zenflow/core
├── zones.ts            ← re-export from @zenflow/core
├── blocks.ts           ← re-export from @zenflow/core
├── overlap.ts          ← re-export from @zenflow/core
└── task-card.ts        ← re-export from @zenflow/core

mobile/components/calendar/
├── time-gutter.tsx          ← 24 hour labels (12 AM → 11 PM), left column
├── work-zone-overlay.tsx    ← grey tint for non-work hours
├── now-indicator.tsx        ← amber line + dot, live-updating
├── task-block.tsx           ← single task card (4 states + compact mode)
└── day-timeline.tsx         ← ScrollView: zones + gutter + now-line + task blocks
```

### Component details

**`time-gutter.tsx`:** Renders 24 `<View>` rows, each 64dp tall, with a `<Text>` label ("12 AM", "1 AM", ..., "11 PM") aligned to the top-right of each row. Uses `minutesToTime()` from `@zenflow/core`.

**`work-zone-overlay.tsx`:** Takes user prefs, calls `getDayZones()` from `@zenflow/core`, renders absolutely-positioned `<View>` elements with `bg-muted/40` for non-work gaps. Handles cross-midnight wrap.

**`now-indicator.tsx`:** Takes the current time, computes `top = (minutesOfDay / 1440) * totalHeight`. Renders an amber horizontal line + dot. Updates every 60 seconds via `setInterval`.

**`task-block.tsx`:** Takes a `DaySegment` + `BlockLayout`. Renders:
- **Compact** (<30 min): single row, title left, time right
- **Normal**: stacked title + time range + tags
- **4 states**: `fluid` (primary border), `overdue` (rose), `conflict` (amber), `completed` (muted + strikethrough)
- Uses `deriveState()` from `@zenflow/core`
- Absolutely positioned: `top = (startMin / 1440) * totalHeight`, `height = (duration / 1440) * totalHeight`
- Width: `left = (column / columns) * 100%`, `width = (1 / columns) * 100%`

**`day-timeline.tsx`:** The main container:
```tsx
<ScrollView ref={scrollRef} onLayout={scrollToNow}>
  <View style={{ height: totalHeight }}>  {/* 24 * hourHeight */}
    <TimeGutter hourHeight={hourHeight} />
    <WorkZoneOverlay ... />
    <NowIndicator ... />
    {segments.map(seg => <TaskBlock ... />)}
  </View>
</ScrollView>
```

### Replace stub

Replace `mobile/app/(app)/index.tsx` with the `DayTimeline` component.

### Wire data fetching

```ts
const [tasks, setTasks] = useState<Task[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(false);

useEffect(() => {
  listTasks("day", date, "PENDING")
    .then(res => setTasks(res.tasks))
    .catch(() => setError(true))
    .finally(() => setLoading(false));
}, [date]);
```

Map through the 4 screen states (loading/error/empty/populated) matching the mockup frames.

---

## Step 6: Build Day View — gestures + interactions

### 6a. Auto-scroll to now

- `useRef<ScrollView>`
- On layout: compute `nowY = (minutesOfDay(now, tz) / 1440) * totalHeight`
- `scrollRef.current.scrollTo({ y: nowY - 100, animated: false })` (offset slightly above center)

### 6b. Pan-to-move (drag a task)

- Wrap each `TaskBlock` in a `Gesture.Pan()` from `react-native-gesture-handler`
- Track `event.translationY` → convert to minutes: `deltaMinutes = translationY / pxPerMin`
- Snap to 15-min grid: `Math.round(deltaMinutes / 15) * 15`
- Use `Animated.View` with `useAnimatedStyle` for live preview during drag
- On release (`:onEnd`):
  - Compute new wall-clock time
  - Call `rescheduleTask(id, zonedWallClockToUtc(newWall, tz).toISOString())`
  - `Haptics.impactAsync(ImpactFeedbackStyle.Light)` on snap

### 6c. Long-press to create

- Add `LongPressGestureHandler` to the timeline's empty areas
- On long press end: compute the pressed time from `y / pxPerMin`, snap to 15-min grid
- Show ghost affordance (dashed border View with "+" icon and "Long press to add" text)
- Navigate to create-task flow (or open a bottom sheet) with the snapped time as default
- Default duration: **45 min** (per mockup spec)

### 6d. Pinch-to-zoom

- Wrap the timeline in `PinchGestureHandler`
- Track `event.scale` → `newHourHeight = clamp(baseHourHeight * scale, 48, 96)`
- Recalculate all positions on the fly
- Use `useAnimatedStyle` for smooth updates

### 6e. Haptics

```ts
import * as Haptics from "expo-haptics";

// On drag snap:
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

// On task create:
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

// On task complete:
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
```

---

## Step 7: Verify + commit

1. `pnpm shared:build` — rebuild shared types (new schedule.ts)
2. `pnpm core:build` — rebuild core (new extracted modules)
3. `pnpm --filter frontend typecheck` — web still compiles
4. `pnpm --filter frontend lint` — web still lints
5. `pnpm --filter mobile typecheck` — mobile compiles
6. `pnpm --filter mobile format` — mobile formats
7. `pnpm --filter backend test` — scheduler tests still pass
8. Manual test: `pnpm --filter frontend dev` → calendar still works
9. Manual test: `pnpm --filter mobile dev:web` → Day View renders

### Commit strategy

```
feat(shared): add Event and DaySegment calendar types
feat(core): extract calendar utilities from frontend
refactor(frontend): import calendar utils from @zenflow/core
feat(mobile): build Day View screen (static rendering + data)
feat(mobile): add Day View gestures (drag, long-press, pinch-zoom, haptics)
```

---

## Open Items

| Item | Resolution |
|------|-----------|
| Long-press ghost default duration | **45 min** (per mockup) |
| `zones.ts` covered by Phase 0? | **Yes** — this plan extracts it now |
| `edf.ts` overdue-at-placement behavior | **Verify** during Step 5 — create a task with a past deadline and confirm it renders as `overdue` immediately |
| Haptics library | **Install** `expo-haptics` in Step 4 |

---

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gesture conflicts (pan vs pinch vs scroll) | High | Build incrementally: static → scroll → pan → pinch. Test each on web before native. |
| NativeWind Tailwind v3 vs web v4 confusion | Medium | Check `mobile/tailwind.config.ts` for available classes. Test on web target first. |
| Web frontend import refactor breaks something | Medium | Run typecheck + lint after each file change. Don't batch all changes. |
| `@zenflow/core` build fails on new modules | Low | Run `pnpm core:build` after each new file added. |

---

## Time Estimate

| Step | What | Time |
|------|------|------|
| 1 | Add types to `@zenflow/shared` | 15 min |
| 2 | Extract utilities to `@zenflow/core` | 30 min |
| 3 | Update web frontend imports | 30 min |
| 4 | Add mobile dependencies | 5 min |
| 5 | Build Day View static + data | 2-3 hours |
| 6 | Build Day View gestures | 3-4 hours |
| 7 | Verify + commit | 30 min |
| **Total** | | **~7-9 hours** |

---

## Progress

| Step | Status | Commit | Notes |
|------|--------|--------|-------|
| 1. Add types to `@zenflow/shared` | DONE | `feat(shared): add Event and DaySegment calendar types` | Created `packages/shared/src/schedule.ts` with Event and DaySegment interfaces, re-exported from index. `pnpm shared:build` passes. |
| 2. Extract utilities to `@zenflow/core` | DONE | `feat(core): extract calendar utilities from frontend` | Created constants.ts, zones.ts, task-card.ts, blocks.ts, overlap.ts in packages/core/src/. Rewrote imports to use local paths and @zenflow/shared. `pnpm core:build` passes. |
| 3. Update web frontend imports | DONE | `refactor(frontend): import calendar utils from @zenflow/core` | Updated 21+ import sites across frontend. Added `@zenflow/core` as a dependency. Deleted 6 extracted files (constants.ts, zones.ts, blocks.ts, overlap.ts, task-card.ts, types/schedule.ts). Also fixed 3 additional files (snap.ts, tasks.ts, time.ts) that imported from the deleted constants. `pnpm --filter frontend typecheck` passes. |
| 4. Add mobile dependencies | DONE | `feat(mobile): add expo-haptics dependency` | Installed expo-haptics@57.0.1. @zenflow/core already a dep. |
| 5. Build Day View static + data | DONE | `feat(mobile): build Day View screen (static rendering + data)` | Created 5 re-export files in mobile/lib/ (constants, zones, blocks, overlap, task-card). Built 5 calendar components (TimeGutter, WorkZoneOverlay, NowIndicator, TaskBlock, DayTimeline). Replaced stub in app/(app)/index.tsx. Data fetching with 4 screen states (loading/error/empty/populated). `pnpm shared:build && pnpm core:build && pnpm --filter frontend typecheck` all pass. Mobile tsc shows only pre-existing errors. |
| 6. Build Day View gestures | TODO | — | — |
| 7. Verify + commit | TODO | — | — |
