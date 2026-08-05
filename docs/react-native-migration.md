> **What this doc is:** A phased migration plan to add a native iOS/Android app (`mobile/`) to the
> Zenflow monorepo alongside the existing web `frontend/`. The web app is **not retired** — both coexist.
> **Who should read it:** Any engineer implementing the mobile app, the UI/UX designer running Figma,
> and the solution architect deciding where shared logic lives.
> **Prerequisites:** Read [CLAUDE.md](../CLAUDE.md) (invariants §1–§7) and
> [frontend/README.md](../frontend/README.md) before touching calendar or timezone logic.
> **Related:** [heuristic.md](heuristic.md) (scheduling invariants that calendar logic must preserve)
> **Correction (2026-07-16):** an earlier revision of this doc claimed the scaffold had moved to
> **uniwind**. That was never actually true — the scaffolded project (cloned from React Native
> Reusables' `minimal-nativewind` template) uses **NativeWind v4** throughout
> (`tailwind.config.ts`, `global.css`, `useColorScheme` from `"nativewind"`); there is no `uniwind`
> or `culori` dependency anywhere in `mobile/`. NativeWind v4 already renders the Warm Sunrise
> tokens correctly, so the plan keeps it rather than migrating to uniwind for no functional gain.
> One consequence: NativeWind's underlying `StyleSheet`/RN Navigation chrome **cannot** consume
> OKLch directly, so the manual OKLch → hex/HSL `tokens.ts` translation step this doc originally
> described **is** needed after all (see Phase 1 step 3). The rest of the plan (phases, calendar
> redesign, file structure) is still the target — only the styling library and its consequences
> differ from the previous revision of this note.

---

## Terminology

| Term | Plain definition |
|------|-----------------|
| `mobile/` | The new Expo + React Native package, added at repo root alongside `frontend/` |
| `packages/core/` | New workspace package `@zenflow/core` — pure utilities extracted from `frontend/src/utils/` |
| Expo Router | File-based navigation for React Native (mirrors React Router's mental model; routes are files) |
| NativeWind | Tailwind CSS compiled to RN `StyleSheet` objects at build time — no DOM dependency |
| Reanimated | `react-native-reanimated` — worklet-based 60 fps gesture/animation library replacing dnd-kit |
| RNGH | `react-native-gesture-handler` — native recognizers (pan, long-press, pinch) |
| Bottom Sheet | `@gorhom/bottom-sheet` — native slide-up panel; replaces every Radix Dialog/Sheet |
| EAS Build | Expo Application Services — cloud native builds for App Store / Play Store |
| OKLch | The color space used in Tailwind v4 design tokens; **not** supported in RN `StyleSheet` directly and NativeWind has no built-in conversion, so `mobile/global.css` / `tailwind.config.ts` carry a hand-translated hex copy instead |
| Wall-clock rule | All calendar `Date`s carry user-tz local fields — enforced by `tz.ts` helpers (CLAUDE.md §5) |

---

## Context

The existing `frontend/` is a desktop-first React PWA. Calendar interactions (drag, resize,
multi-column conflict layout) rely on `@dnd-kit` pointer events and absolute CSS percentages —
both incompatible with React Native's gesture system and numeric `StyleSheet` layout engine.
Users have filed complaints specifically about the calendar on mobile web: no tap-to-create,
accidental touch drags, resize handles too small for fingers.

This plan:
1. Adds `mobile/` — a dedicated Expo app with native gesture-first calendar UX.
2. Extracts portable pure-function utilities into `packages/core/` so both apps share one copy.
3. Keeps `frontend/` and the backend unchanged; the API contract (`@zenflow/shared`) is untouched.

---

## Portable vs. Mobile-Specific Inventory

### Portable — reuse as-is or with minimal adaptation

| Artifact | Current location | Where it goes |
|----------|-----------------|---------------|
| All shared types (`Task`, `User`, `ViewMode`, `CreateTaskInput`, …) | `packages/shared/src/` | Already shared; add as `mobile/` workspace dep |
| Timezone helpers (`zonedNow`, `zonedDate`, `zonedWallClockToUtc`, `isZonedToday`, `tzAbbrev`) | `frontend/src/utils/tz.ts` | Extract → `packages/core/src/tz.ts` |
| Time formatting (`minutesToTime`, `timeToMinutes`, `formatMinutes`, `snapToNearestLaterQuarterHour`) | `frontend/src/utils/time.ts` | Extract → `packages/core/src/time.ts` |
| Conflict-detection + overlap layout (`getOverlapLayout`, `BlockLayout`) | `frontend/src/utils/overlap.ts` | Extract → `packages/core/src/overlap.ts` |
| Cross-midnight task splitting (`eventsForDay`, `DaySegment`) | `frontend/src/utils/blocks.ts` | Extract → `packages/core/src/blocks.ts` |
| Date navigation (`shiftDateByView`) | `frontend/src/utils/navigation.ts` | Extract → `packages/core/src/navigation.ts` |
| Constants (`DAILY_HORIZON`, `SLOT_MINUTES`, `WEEK_STARTS_ON`) | `frontend/src/utils/constants.ts` + `packages/shared/src/view.ts` | Use from `@zenflow/shared`; remove frontend duplication |
| Task state derivation (fluid/fixed/overdue/conflict/completed) | `frontend/src/lib/task-card.ts` | Port to `mobile/src/lib/task-card.ts` — same logic, different style output (RN objects, not CSS strings) |
| Zod task/user validation schemas | `frontend/src/utils/tasks.ts` | Port to `mobile/src/utils/tasks.ts` — identical |
| `react-hook-form` + Zod form setup | `frontend/src/hooks/use-task-form.ts` | Works in RN — port hook directly |
| Axios API layer (all endpoints) | `frontend/src/api/` | Port to `mobile/src/api/` — same functions; swap `VITE_API_URL` for Expo config var |
| `date-fns` + `date-fns-tz` | `frontend/package.json` | Both work in RN — add to `mobile/package.json` |
| Zustand user store | `frontend/src/hooks/use-user-store.ts` | Port as-is — Zustand works in RN |

### Must be replaced — mobile-specific implementations needed

| Artifact | Web version | React Native replacement | Notes |
|----------|-------------|--------------------------|-------|
| Drag & drop | `@dnd-kit/core` + pointer sensors | `react-native-gesture-handler` `PanGestureHandler` + `react-native-reanimated` | dnd-kit is DOM-only |
| Resize handles | Pointer-driven 10px strips at block edges | Long-press task → bottom-sheet "Change duration" slider | 10px handles untouchable on phone |
| All Radix UI primitives | `@radix-ui/*` (20+ packages) | `@gorhom/bottom-sheet` (sheet/dialog), React Native Reusables + `@rn-primitives/*` (dropdown), RN built-ins (tabs) | Radix is DOM-only |
| Rich text note editor | Tiptap / ProseMirror | Native `TextInput` multiline (Phase 1, superseded); `@10play/tentap-editor` **(wired, see Phase 5 update below)** | Tiptap has no RN port — tentap runs it in a `react-native-webview` WebView with a native bridge instead |
| Navigation | React Router v7 | Expo Router (file-based, same mental model) | |
| CSS layout + OKLch design tokens | Tailwind v4 Vite plugin | NativeWind v4 (Tailwind v3-config-driven, compiled to RN `StyleSheet`); OKLch tokens hand-translated to hex once in `tailwind.config.ts` / `global.css` | RN `StyleSheet` rejects OKLch directly — NativeWind has no built-in OKLch→native conversion, unlike uniwind |
| `position: absolute` % values | `top/left/width/height` as `%` strings | Same math; output numeric dp values (`(min / 1440) × totalHeight`) | |
| Cookie session management | Browser HTTP-only cookies (automatic) | `@react-native-cookies/cookies` + axios interceptor + `expo-secure-store` | |
| File uploads | `<input type="file">` multipart | `expo-image-picker` + `expo-document-picker` + `expo-file-system` | |
| Toast notifications | Sonner | `react-native-toast-message` | |
| Icons | `lucide-react` | `lucide-react-native` (drop-in name parity) | |
| Keyboard shortcuts | `useViewShortcuts` (d/w/m, arrows) | Remove; replace with tab bar + swipe navigation | Not applicable on mobile |
| PWA offline / service worker | `vite-plugin-pwa` | `expo-updates` OTA | |
| Dark mode | `next-themes` + CSS `prefers-color-scheme` | NativeWind's `dark:` variant + `useColorScheme()` from `nativewind`, mirrored to `next-themes` on web builds | |

---

## Monorepo Structure After Migration

```
zenflow/
├── frontend/              # Unchanged React PWA (web)
├── mobile/                # NEW — Expo + React Native app (iOS + Android)
│   ├── app/               # Expo Router file-based routes
│   │   ├── _layout.tsx         # Root layout: theme provider, auth gate
│   │   ├── (auth)/
│   │   │   ├── _layout.tsx
│   │   │   └── login.tsx       # 2-stage OTP flow
│   │   ├── (onboarding)/
│   │   │   ├── _layout.tsx
│   │   │   └── [step].tsx      # Steps 0–5
│   │   └── (app)/
│   │       ├── _layout.tsx     # Bottom tab bar (Day | Week | Month | Settings)
│   │       ├── index.tsx       # Day view (default tab)
│   │       ├── week.tsx        # Week view
│   │       ├── month.tsx       # Month view
│   │       └── settings.tsx    # Settings + profile preferences
│   ├── components/
│   │   ├── calendar/
│   │   │   ├── day-timeline.tsx       # Vertical scrollable 24h grid
│   │   │   ├── week-pager.tsx         # Horizontal swipeable day pages
│   │   │   ├── month-grid.tsx         # Month calendar grid
│   │   │   ├── task-block.tsx         # Animated task card (port of scheduled-block-item)
│   │   │   ├── now-indicator.tsx
│   │   │   ├── work-zone-overlay.tsx
│   │   │   └── time-gutter.tsx
│   │   ├── tasks/
│   │   │   ├── create-task-sheet.tsx  # Bottom sheet (port of create-task-dialog)
│   │   │   ├── edit-task-sheet.tsx    # Bottom sheet (port of edit-task-dialog)
│   │   │   ├── task-form.tsx          # Ported form fields
│   │   │   └── overflow-sheet.tsx     # Overflow resolution bottom sheet
│   │   ├── onboarding/step-*.tsx
│   │   ├── settings/preferences-form.tsx
│   │   └── ui/                        # NativeWind / React Native Reusables primitive components
│   ├── hooks/
│   │   ├── use-user-store.ts          # Zustand (same as web)
│   │   ├── use-task-form.ts           # Ported RHF hook
│   │   ├── use-calendar-gesture.ts    # NEW: pan + long-press + pinch orchestration
│   │   └── use-haptics.ts             # expo-haptics wrapper
│   ├── lib/
│   │   ├── task-card.ts               # Same state logic → RN style objects
│   │   └── api-client.ts              # Cookie-aware axios instance
│   ├── src/api/                       # Ported from frontend/src/api/
│   ├── global.css                     # NativeWind v4 theme source (Warm Sunrise tokens as hex) — already scaffolded
│   ├── app.config.ts                  # Expo config (EXPO_PUBLIC_API_URL, bundle ID, etc.)
│   ├── babel.config.js
│   ├── package.json
│   └── tsconfig.json
│
├── packages/
│   ├── shared/             # @zenflow/shared — existing, unchanged
│   └── core/               # NEW — @zenflow/core: pure portable utilities
│       ├── src/
│       │   ├── index.ts
│       │   ├── tz.ts           # from frontend/src/utils/tz.ts
│       │   ├── time.ts         # from frontend/src/utils/time.ts
│       │   ├── overlap.ts      # from frontend/src/utils/overlap.ts
│       │   ├── blocks.ts       # from frontend/src/utils/blocks.ts
│       │   └── navigation.ts   # from frontend/src/utils/navigation.ts
│       ├── package.json        # name: "@zenflow/core", no DOM deps, peerDeps: date-fns, date-fns-tz
│       └── tsconfig.json
│
├── backend/               # Unchanged
└── pnpm-workspace.yaml    # Add "packages/core" and "mobile"
```

---

## Technology Stack — `mobile/`

```json
{
  "expo": "~52.x",
  "expo-router": "~4.x",
  "react-native": "0.76.x",
  "react-native-gesture-handler": "~2.20.x",
  "react-native-reanimated": "~3.16.x",
  "nativewind": "^4.1.x",
  "tailwindcss": "^3.4.x",
  "react-hook-form": "^7.x",
  "zod": "^3.x",
  "zustand": "^5.x",
  "axios": "^1.x",
  "date-fns": "^4.x",
  "date-fns-tz": "^3.x",
  "expo-haptics": "~56.x",
  "expo-secure-store": "~56.x",
  "expo-image-picker": "~16.x",
  "expo-document-picker": "~12.x",
  "expo-file-system": "~18.x",
  "@gorhom/bottom-sheet": "^5.x",
  "react-native-toast-message": "^2.x",
  "lucide-react-native": "^1.21.x",
  "@react-native-cookies/cookies": "^5.x"
}
```

(Actual installed versions in `mobile/package.json` are the source of truth — this is
illustrative, not pinned.)

**Design tokens.** The "Warm Sunrise" palette uses OKLch (see `frontend/src/index.css`).
NativeWind v4's `StyleSheet` output can't consume OKLch directly, so `mobile/global.css`
and `mobile/tailwind.config.ts` carry a one-time hand-translated **hex** copy of every
token (light + dark), diffed by eye against the OKLch source whenever the web palette
changes. `mobile/lib/constants.ts` keeps a further hex mirror (`NAV_THEME`) of just the
handful of colors React Navigation's native header/tab-bar chrome needs, since that chrome
takes plain color props, not `className`. Everything else should read tokens via
`className`; never hardcode hex values in component files outside these two token
sources.

---

## Calendar Redesign — Native Gesture-First

This is the primary motivation for the mobile app. Each view is redesigned around touch, not pointer.

### Day View

| Axis | Web behavior | Native replacement |
|------|--------------|--------------------|
| Layout | 1536px tall absolute CSS grid | `ScrollView` wrapping a `View` of height `24 × hourHeight` (default 64 dp/hr) |
| Zoom | N/A | `PinchGestureHandler` adjusts `hourHeight` shared value (48–96 dp range); labels reflow live |
| Task position | `top`/`height` as `%` strings | `top = (startMin / 1440) × totalHeight`, `height = (durationMin / 1440) × totalHeight` (numeric dp) |
| Create task | Click empty cell | Long-press (300 ms) on time slot → haptic confirm → `CreateTaskSheet` pre-filled with tapped time |
| Move task | dnd-kit `PointerSensor` drag | `PanGestureHandler` on `TaskBlock`; `Animated.View` follows finger; snaps to 15-min grid on `onEnd` |
| Resize task | 10px top/bottom handle strips | Long-press task → `EditTaskSheet` with duration slider (15-min steps) |
| Conflict layout | Horizontal column split via `getOverlapLayout` | Same algorithm from `@zenflow/core`; apply column fractions as numeric dp widths |
| Now indicator | Red dot + gradient line, CSS absolute | `Animated.View` positioned at `(nowMin / 1440) × totalHeight`; refreshed every 60 s |
| Work zones | CSS tinted bands | `View` overlays at work-hour dp offsets; same zone computation from `@zenflow/core` |
| Scroll-to-now | None (manual) | `scrollRef.current.scrollTo({ y: nowOffset - screenH / 2 })` on mount |

**Micro-states (must be in Figma):**
- Empty day — ghost "Long press to add" hint at current-time slot
- Long-press active — ghost block appears at pressed time, subtle scale on finger
- Drag in progress — block lifts (shadow + 1.02 scale), amber snap-grid indicator every 15 min, haptic pulse on each snap
- Conflict — two blocks side-by-side, amber tint, "Overlap" badge
- Create flow — ghost block preview while sheet is opening
- Pinch zoom — hour label spacing changes live

### Week View

| Axis | Web behavior | Native replacement |
|------|--------------|--------------------|
| Layout | 7-column CSS grid, horizontal scroll below `lg` | `FlatList` horizontal, `snapToInterval = screenWidth`, `decelerationRate="fast"` |
| Per-day content | One day column with 24h grid | Full `DayTimeline` instance per page |
| Day peek | N/A | Adjacent day visible at ±20 dp edge — swipe affordance |
| Cross-day drag | Free 2D mouse drag | Block dragged to screen edge → auto-scroll `FlatList` to next/prev day page |
| Week header | Sticky top bar with 7 day labels | 7 `TouchableOpacity` chips; tap jumps `FlatList.scrollToIndex` |
| Vertical scroll sync | Independent per column | Shared `Reanimated.ScrollView` `contentOffset.y` across pages via shared value |

**Micro-states:**
- Normal week — today chip highlighted, other days neutral
- Swipe transition — next day peeks at right edge with slight parallax
- Cross-day drag — block snaps to next-day column when dragged to right edge

### Month View

| Axis | Web behavior | Native replacement |
|------|--------------|--------------------|
| Layout | CSS `grid auto-rows-fr`, min 110px per cell | `FlatList` of 7-column week rows; fixed `cellHeight` |
| Month navigation | Header prev/next buttons | Outer horizontal `FlatList`, `snapToInterval = screenWidth`, paginated by month |
| Task overflow | "+N more" popover | Tap "+N more" → `@gorhom/bottom-sheet` listing all tasks for that day |
| Day tap | No special action | `router.push('/?date=YYYY-MM-DD')` → day view for that date |
| Task drag | Day-to-day, preserve time | Long-press task → drag to target cell; haptic on cell entry; release → PATCH `/tasks/:id/reschedule` |
| Today highlight | Top border + "Today" badge | Bold date number + accent top border + colored chip |

**Micro-states:**
- Normal cells: work day / weekend / outside-month (dimmed)
- Today cell
- Cell with 1, 2, or 3 task pills
- "+N more" overflow → bottom sheet open
- Drag task in flight — target cell glows

---

## Auth on Mobile

Cookie-based OTP sessions require no backend changes. Adapt the axios client in `mobile/src/lib/api-client.ts`:

1. **Cookie jar.** Use `@react-native-cookies/cookies` with a custom axios adapter so the `Set-Cookie`
   header from `POST /auth/otp/verify` persists and is sent on subsequent requests.
2. **Session cache.** On successful `verifyOtp`, write the `User` object to `expo-secure-store` so
   the app can skip the `/auth/me` round-trip on cold resume.
3. **Timezone header.** The `x-timezone` header on `verifyOtp` must use
   `Intl.DateTimeFormat().resolvedOptions().timeZone` — this API is available in Hermes (the default
   RN JS engine).

---

## Figma Design Scope

Run `/ui-ux` to spawn the `ui-ux-designer` agent. It must produce Figma frames for every item below,
each in **light + dark** variants. Micro-states are separate frames, not overlays.

### Screen frames

| Screen | Micro-state variants |
|--------|---------------------|
| App icon + splash | — |
| Login — email stage | Empty, filled, error, loading |
| Login — OTP stage | Empty, partial fill (3/6 digits), auto-submit loading, invalid code error |
| Onboarding step 0: Welcome | — |
| Onboarding step 1: Work hours | Default, invalid window error |
| Onboarding step 2: Work days | Default, single day selected |
| Onboarding step 3: Role | Default, one role selected, "Skip" tapped |
| Onboarding step 4: Duration mode | Each of the 3 modes selected |
| Onboarding step 5: Summary | Review state, confirm loading |
| Day view | Empty; with tasks; "Long press to add" ghost hint |
| Day view — drag in progress | Block elevated + shadow, 15-min snap grid indicator |
| Day view — conflict | Two side-by-side blocks, amber tint |
| Day view — pinch zoom | Expanded hour density |
| Week view | Normal Mon–Sun, today highlighted |
| Week view — swipe transition | Next day peeking at right edge |
| Month view | Normal; today cell highlighted |
| Month view — overflow cell | "+3 more" bottom sheet expanded |
| Create task sheet | Empty, filled, fixed-time toggle on |
| Edit task sheet | All fields populated, tags shown |
| Duration slider sheet | Slider at current value, 15-min step labels |
| Overflow resolution sheet | Two options (`outsideHours` / `nextAvailable`) |
| Settings screen | Preferences form (work hours, days, timezone, duration mode) |

### Task card states frame

One frame showing all 5 states side-by-side (fluid, fixed, overdue, conflict, completed) with
labels explaining the state trigger.

### Design token frame

One shared frame mapping Warm Sunrise OKLch tokens → hex/RGB equivalents in light and dark,
showing typography scale (Geist), spacing scale, and border-radius.

---

## Phase Plan

### Phase 0 — Extract `@zenflow/core` (1–2 days)

1. Create `packages/core/package.json` (`name: "@zenflow/core"`, zero DOM dependencies; `peerDeps`: `date-fns`, `date-fns-tz`).
2. Copy `tz.ts`, `time.ts`, `overlap.ts`, `blocks.ts`, `navigation.ts` from `frontend/src/utils/` into
   `packages/core/src/` — **no logic changes**, only import paths updated.
3. Add a barrel `packages/core/src/index.ts` re-exporting all public symbols.
4. Update all `frontend/src/` imports that reference these five files to `@zenflow/core`.
5. Add `"packages/core"` entry to `pnpm-workspace.yaml`.
6. Add `"core:build": "pnpm --filter @zenflow/core build"` to root `package.json`.
7. Verify: `pnpm --filter frontend typecheck` green; `pnpm --filter frontend test` green.

### Phase 1 — Scaffold `mobile/` + Auth + Onboarding (3–4 days)

1. ~~Run `npx create-expo-app@latest mobile --template expo-router`~~ **Done, differently:**
   scaffolded from React Native Reusables' `minimal-nativewind` template (cloned via
   `git sparse-checkout` from `founded-labs/react-native-reusables-templates`) instead —
   it already had NativeWind v4 + RN Reusables + the Metro/babel/root-layout wiring done
   correctly, so there was nothing left to configure by hand.
2. **Done:** NativeWind v4 is configured (`tailwind.config.ts` + `metro.config.js`
   `withNativeWind` wrapper); this is the plan's originally-intended styling library, so
   no substitution was needed here after all (see the correction note at the top of this
   doc — an earlier revision of this doc incorrectly said uniwind replaced it).
3. `mobile/global.css` and `mobile/tailwind.config.ts` carry a hand-translated hex copy of
   the Warm Sunrise OKLch tokens (NativeWind can't consume OKLch at build time). `mobile/lib/constants.ts`
   is the further hex mirror for React Navigation's native chrome colors only.
4. Add `@zenflow/shared` and `@zenflow/core` as workspace deps (`pnpm --filter mobile add @zenflow/shared @zenflow/core`).
5. Port `frontend/src/api/` → `mobile/src/api/`; replace `VITE_API_URL` with `process.env.EXPO_PUBLIC_API_URL`.
6. Create `mobile/src/lib/api-client.ts`: axios instance with `@react-native-cookies/cookies` jar.
7. Implement `app/(auth)/login.tsx` — 2-stage OTP form (port logic from `frontend/src/pages/login.tsx`).
   **Stage 1 (email) scaffolded** as a local-state-only screen (no API call yet) to prove
   the Expo/NativeWind/RN Reusables/theme setup works. Stage 2
   (code entry) and the actual OTP request/verify calls are still open, blocked on step 6.
8. **Done, differently:** `app/(onboarding)/index.tsx` — a single screen holding `step` as
   component state (0–4), not a `[step].tsx` dynamic route. A route-per-step would force
   `workStart`/`workEnd`/`workDays`/`durationMode` to round-trip through route params or a
   store between screens for no benefit; frontend's own `onboarding.tsx` is already one
   component with a `step` state variable, so this ports that shape directly instead of
   fragmenting it. Validation ported from `frontend/src/pages/onboarding.tsx` +
   `components/settings/preferences-fields.tsx` + `duration-mode-field.tsx`.
9. Implement root `app/_layout.tsx` auth gate using Expo Router `<Redirect>` (replaces `WithAuth` HOC).
10. Implement `app/(app)/_layout.tsx` with 4-tab bar (Day | Week | Month | Settings).

### Phase 2 — Day View (1 week)

1. `DayTimeline`: `ScrollView` wrapping an absolute-positioned `View` of `height = 24 × hourHeight`.
2. `TimeGutter`: hour label `Text` nodes at `top = hour × hourHeight` offsets.
3. `WorkZoneOverlay`: tinted `View`s at work-hour offsets using zone logic from `@zenflow/core`.
4. `NowIndicator`: red `Animated.View`; `setInterval` every 60 s to recompute `top`.
5. `TaskBlock`: `Animated.View` with absolute positioning; state → styles via ported `task-card.ts`;
   `PanGestureHandler` for drag-to-move; long-press triggers `EditTaskSheet`.
6. Overlap layout: call `getOverlapLayout` from `@zenflow/core`; apply column fractions as dp widths.
7. Long-press on `TimeGutter` cell → open `CreateTaskSheet` pre-filled with snapped start time.
8. `PinchGestureHandler` on `DayTimeline`: adjust `hourHeight` shared value (clamp 48–96).
9. Auto-scroll to current time on mount.
10. Haptic feedback (`expo-haptics`) on: 15-min drag snap, task create, task complete.

### Phase 3 — Week View (1 week)

1. `WeekPager`: horizontal `FlatList`, `snapToInterval = Dimensions.get('window').width`, lazy-renders ±3 days.
2. Each page renders a `DayTimeline` for that specific date.
3. `WeekHeader`: 7 chip row; tap chip → `FlatList.scrollToIndex`.
4. Vertical scroll sync: extract scroll offset to a Reanimated `SharedValue`; broadcast to all mounted pages.
5. Cross-day drag: when `PanGestureHandler` `translationX` exceeds threshold → advance `FlatList` page.

### Phase 4 — Month View — done (GitHub issue #21)

What shipped, differently from this section's original plan:

1. `MonthGrid` (`components/calendar/month-grid.tsx`): 7-column Monday-first `FlatList`
   (`numColumns={7}`, `scrollEnabled={false}` — a page is always sized to its own row count, no
   internal scroll), weekday header row, weekend columns tinted. `MonthGridSkeleton` in the same
   file matches its row/cell geometry exactly (fixed `CELL_HEIGHT`) so the loading→loaded swap
   never shifts layout.
2. Month pagination: `components/calendar/month-pager.tsx` — an outer horizontal `FlatList`
   holding a sliding 3-month window (prev/current/next, recentered on every page change) rather
   than `snapToInterval`/an unbounded list. **Confirmed live on an Android emulator:**
   `initialScrollIndex` alone was not reliable enough to trust — the FlatList could still visually
   sit on the "prev" page for a beat after mount while the header (driven by React state, not
   scroll position) already read the center page; if that late self-correction fired through
   `onMomentumScrollEnd` it read as a user swipe and silently changed the header with no input.
   Fixed with an explicit forced re-center on the FlatList's own first `onLayout` plus a
   `didDragRef` gate that ignores any `onMomentumScrollEnd` not preceded by a real
   `onScrollBeginDrag` — see that file's doc comments.
3. `MonthCell` (`components/calendar/month-cell.tsx`): today gets an accent top border + filled
   date chip; up to 2 pills (`splitCellTasks` in `lib/month-date-math.ts`, unit-tested), "+N more"
   overflow pill; outside-month days dimmed, no pills, not tappable/a drag target.
4. Day tap → `router.push({ pathname: "/(app)", params: { date: <ISO> } })` — `app/(app)/index.tsx`
   (Day View) now reads an optional `date` query param via `useLocalSearchParams` instead of
   always defaulting to `zonedNow(tz)`, added specifically for this deep link.
5. "+N more" → `components/calendar/task-list-sheet.tsx`'s `TaskListSheet`, built on the existing
   `@/components/ui/bottom-sheet` host (Phase 5's task sheets already established it — no new
   sheet infra needed, per this phase's original "coordinate rather than build your own" note).
6. Task drag: a single `Gesture.Pan().activateAfterLongPress(350)` per pill (RNGH v2's built-in
   long-press-then-pan primitive, not a separate `LongPressGestureHandler`+`PanGestureHandler`
   pair) → `components/calendar/month-page.tsx` computes the drop-target cell from the grid's
   measured on-screen rect (`measureInWindow`) + the gesture's `absoluteX`/`absoluteY` → optimistic
   move + `PATCH /tasks/:id/reschedule` (`rescheduleTask`, same endpoint Day View's reschedule
   would use) with rollback + a destructive toast on failure. No `scope: "one" | "following"`
   parameter exists on that endpoint — each recurring occurrence is already its own materialized
   `Task` row (CLAUDE.md §4), so the phase's original open question about drag scope doesn't apply.

**Verified live (Android emulator only — no iOS device available):** the screen mounts, chevron
pagination, weekend tinting, outside-month dimming, the loading skeleton, and the header/pager
sync fix above, all against a real (empty, since no backend was running in that environment)
`GET /tasks?view=month` response. **Not verified live:** an end-to-end drag-to-reschedule against
real task data, the overflow sheet's actual content, and tap-to-Day-View's full round trip — flag
these for a follow-up on-device pass with the backend stack up.

### Phase 5 — Task Forms + Settings (1 week)

**Settings half: done**, ahead of this doc catching up — `app/(app)/settings.tsx` already
ships the full preferences form (profile, working hours, work days, timezone, duration mode,
insights, dark mode, sign-out); see `mobile/README.md`'s screens table.

**Task Forms half: done** (GitHub issue #20 — `CreateTaskSheet`/`EditTaskSheet`/
`ChangeDurationSheet`). What actually shipped, differently from this section's original plan:

1. `CreateTaskSheet` / `EditTaskSheet` / `ChangeDurationSheet`, all on `@gorhom/bottom-sheet`
   **v5** (bumped from the `^4.6.4` the scaffold started on — no breaking changes hit beyond a
   couple of TS-only fallout fixes: `BottomSheetModal` became a generic type alias in v5, so the
   two `components/{ui,primitives/bottomSheet}/bottom-sheet.native.tsx` ref wrappers now type
   against `BottomSheetModalMethods` instead of `React.ElementRef<typeof BottomSheetModal>`).
2. `taskSchema` (+ `TaskFormValues`/`EditTaskFormValues`/`placementQualifier`) is **hoisted to
   `@zenflow/core`** (`packages/core/src/tasks.ts`) rather than ported to a second `mobile/`
   copy — resolves this doc's original "Portable" table entry for `frontend/src/utils/tasks.ts`
   the other direction from what it said (port to `mobile/src/utils/tasks.ts` — identical) once
   a second consumer actually needed it: cross-app-to-app imports outside a shared package would
   be unusual for this monorepo, so it's shared instead of forked. `frontend/` was **not**
   repointed at the hoisted copy in the same change (out of that issue's stated scope — its own
   `frontend/src/utils/tasks.ts` still carries a parallel definition that must be kept in sync
   by hand until a follow-up consolidates it), so this is a deliberate, temporary fork of one
   file, not the intended end state.
3. Fields, in mockup order (`mockups/task-sheets.html`): Title (plain input, no suggestion
   dropdown — unlike the web `TitleField`, out of the mockup's scope) → Duration (a −/+ 15-min
   stepper, `components/tasks/form/duration-stepper.tsx` — **shown in both the create and edit
   sheets**, unlike the web dialog which hides duration entirely in edit mode; mobile has no
   drag-resize handles, so the edit sheet's stepper submits via a second `PATCH
   /tasks/:id/resize` call alongside the metadata `PATCH /tasks/:id`, since `UpdateTaskInput`
   has no `durationMinutes` field) → Deadline (`DeadlineChipRow`, a straight port of
   `deadline-chip-field.tsx`'s chip logic against `GET /tasks/deadline-options`) → Tags
   (`TagAutocomplete`, custom dropdown — see below) → Description (`DescriptionField`, see
   below). No fixed-time toggle and no `OverflowSheet`: both are obsolete against the current
   `@zenflow/shared` contract — the `overflow` envelope was already removed from
   `CreateTaskResponse` before this phase started (every create/update now always resolves to a
   concrete placement; see `frontend/src/utils/tasks.ts`'s `placementQualifier` doc comment),
   so there's nothing left for an overflow sheet to display.
4. Tag autocomplete does **not** use `components/ui/combobox.tsx` (nested nav-style bottom
   sheet — wrong shape for an inline, type-as-you-go dropdown) or cmdk (no RN port). It's a
   from-scratch matcher (`mobile/lib/tag-match.ts`) — and along the way fixes
   `mockups/feedback.md` item 5 ("tag autocomplete is strange when the prefix is far from the
   remaining text"): the web version's bug is cmdk's default fuzzy scorer matching scattered
   characters anywhere in a name; this port only ever matches contiguous prefix/substring
   occurrences.
5. Description editor **update (post-#20 follow-up):** the Phase-1-style plain `TextInput` +
   raw-HTML-tag toolbar described below has been replaced by a real WYSIWYG editor on
   `@10play/tentap-editor` (this doc's own Phase 2 richtext plan, brought forward) —
   `components/tasks/form/description-field.tsx` now renders `RichText`/`useEditorBridge` from
   the package, with a floating toolbar (still visually a dark rounded pill, matching the old
   selection-bubble style) driving the same tool set as the web toolbar
   (`common/editor/toolbar.tsx`): Bold, Italic, Underline, Highlight, Blockquote marks; a Link
   insert control; Bulleted / Numbered lists. The stored `note` stays a plain HTML string (same
   shape the web `NoteEditor` produces/reads, since it round-trips through the same
   `@zenflow/shared` field), bridged through `useEditorBridge`'s async `getHTML()`/`setContent()`
   rather than a synchronous DOM. "Upload file" is still a stub (toasts "not available yet"; no
   `expo-image-picker`/`expo-document-picker` wiring — unchanged scope).
   - **Tool-parity gap:** the toolbar is a floating pill, absolutely positioned to straddle the
     editor's own top edge and shown/hidden by the bridge's `isFocused` state (plus while the
     link-entry row is open) — not a bubble anchored to the exact text-selection caret position
     like web's Tiptap bubble menu. `tentap-editor`'s `CoreEditorState` bridge state exposes a
     `selection: { from, to }` text *offset* pair but no WebView-internal screen *coordinates* for
     it, so there's nothing to anchor a true per-caret bubble to from native; showing/hiding on
     focus (not on "has a non-empty selection", which would incorrectly hide Upload whenever
     nothing's selected) is the closest reasonable approximation given that constraint. Marks/lists
     can be toggled with or without an active text selection (typing continues in that style),
     which is arguably more correct WYSIWYG behavior than a selection-required toolbar anyway.
     Embedded image/video nodes (matching web's `common/editor/video-block.tsx`/`audio-block.tsx`)
     are an explicit non-goal for now: `tentap-editor`'s `bridgeExtensions` API ships only a bare
     `ImageBridge.setImage(src)`, no video/audio bridge and no attrs for `controls`/sizing the way
     the web nodes have, and there's no ergonomic extension point to register a *new* custom Tiptap
     node from the native side without patching the package's bundled WebView JS — "Upload file"
     stays a stub toast.
   - **Dependency resolution:** pinned to the Tiptap-v3-based `@10play/tentap-editor@^1.0.1` line
     rather than the older (still maintained) `0.7.x`/Tiptap-v2 line, specifically so its
     `@tiptap/*` transitive deps share a major version with `frontend/`'s own hoisted Tiptap v3
     copies under the root `.npmrc`'s broad hoist — installing `0.7.x` produced hard
     `unmet peer @tiptap/core@^2.7.0: found 3.26.0` conflicts against `frontend/`'s Tiptap v3.
     `react-native-webview` is pinned to `13.12.5`, the version Expo SDK 52's own
     `bundledNativeModules.json` lists as compatible. See `mobile/README.md`'s tech-stack table
     and "Known pitfalls" section.
   - **Native rebuild caveat:** both packages are native modules (WebView + its RN bridge) —
     using this on-device needs a dev-client rebuild (`expo run:android`/`ios`), not just a JS
     reload. **Not verified in the environment this was implemented in** (no device/emulator
     available there) — typecheck is clean and the API usage was checked against the installed
     package's own compiled `.d.ts`, but the actual on-device WebView round-trip is unverified.
   - The description below (this doc's original Phase 5 write-up) is kept for history but is no
     longer accurate about the description editor's implementation:

   ~~Description editor is a plain multiline `TextInput` (this doc's own Phase 1 fallback,
   "Native `TextInput` multiline") with a **floating selection-bubble toolbar** bolted on — full
   tool set from `common/editor/toolbar.tsx` (Bold/Italic/Underline/Highlight/Blockquote/Link/
   Upload/Bullets/Numbering), wrapping the selection in the same HTML tags Tiptap would emit so
   the stored `note` stays renderable by the web `NoteEditor`. This is **not** WYSIWYG — the raw
   tags are visible while editing, not a live-rendered preview — real parity needs this doc's
   Phase 2 richtext plan (`@10play/tentap-editor`), not attempted here. "Upload file" is a stub
   (toasts "not available yet"; no `expo-image-picker`/`expo-document-picker` wiring).~~
6. Placement toast: **not** `react-native-toast-message` — the scaffold already had its own
   `ToastProvider`/`useToast` (`components/ui/toast.tsx`), used app-wide (e.g.
   `app/(app)/settings.tsx`), so the sheets use that instead of adding a second toast library.
   Only the plain success/conflict copy is ported (`mobile/lib/task-toasts.ts`, mirrors
   `create-task-dialog.tsx`'s one-line `toast.success`/`toast.warning`) — the richer Phase-2
   rationale toast (preferred-window / top-cells breakdown) is out of scope; only the toast
   *surface*, not the scheduling intelligence behind it, was asked for.
7. Gesture wiring is **partial**, blocked on Phase 2/3/4 (the day/week/month screens are still
   the placeholder stubs below — there's no positioned grid yet to long-press a *slot* against).
   `app/(app)/index.tsx` got the minimal substitute the sheets needed to be exercisable end to
   end: today's tasks as a plain list, tap → `EditTaskSheet`, long-press a row →
   `ChangeDurationSheet`, long-press the empty area (or the FAB) → `CreateTaskSheet` pre-filled
   with "now" snapped to the next 15-minute mark. True per-pixel slot targeting, drag-to-move,
   pinch-zoom, and the now-indicator/work-zone overlays remain Phase 2 work.
   - **Bug fix (post-#20 follow-up):** the FAB (and, latently, the long-press-empty-area
     gesture) didn't reliably open `CreateTaskSheet` — `components/ui/bottom-sheet.native.tsx`'s
     `BottomSheetContent` exposed the caller's forwarded `ref` via
     `useImperativeHandle(ref, () => sheetRef.current ?? {}, [sheetRef.current])`, but
     `sheetRef.current` is a plain mutable ref, not reactive state, so that dependency array only
     re-evaluates on a render this component happens to re-run for an unrelated reason.
     `@gorhom/bottom-sheet` attaches the real `BottomSheetModal` instance to `sheetRef` slightly
     after the component's first commit, so the imperative handle's first (and often only) run
     captured it as still `null` and returned the `{}` stub, leaving the caller's
     `ref.current?.present()` a silent no-op forever for any sheet that didn't happen to
     re-render again shortly after mount (`EditTaskSheet` did, via its `getTaskDetails().then(
     setTask)`, which is why tap-to-edit worked while the FAB/empty-area create path didn't).
     Fixed by assigning both refs in a single merged callback ref instead, which fires exactly
     when React attaches/detaches the real instance regardless of timing.
   - **Bug fix #2 (post-#20 follow-up, sheets still didn't open after the merged-ref fix
     above):** the actual remaining cause was `CreateTaskSheet`/`EditTaskSheet`/
     `ChangeDurationSheet` being externally controlled by an `open: boolean` + `onOpenChange`
     prop pair (state living in `app/(app)/index.tsx`), bridged through a
     `useControlledBottomSheet(open)` hook that called `ref.current?.present()`/`.dismiss()`
     inside a `useEffect` keyed on `open` — i.e. one render tick *after* the triggering press
     handler, not synchronously inside it. Every other working sheet in the app
     (`components/ui/time-picker.tsx`, `components/settings/duration-mode-picker-row.tsx`,
     `components/settings/timezone-picker-row.tsx`) calls `useBottomSheet()`'s `open`/`close`
     directly inside the press handler instead — that synchronous-call shape turned out to be
     the real difference (an earlier hypothesis blaming `@10play/tentap-editor`'s WebView mount
     was ruled out: the sheets still didn't open with the editor removed entirely). Fixed by
     converting all three sheets to `forwardRef` components with an imperative `open(...)`
     handle, using `useBottomSheet()` internally and calling `.open()`/`.close()` synchronously
     everywhere the old code called `onOpenChange(true)`/`(false)`; callers hold a
     `useRef<XSheetHandle>` and call `.open(...)` directly inside the triggering `Pressable`'s
     handler. `hooks/use-controlled-bottom-sheet.ts` was deleted. See `mobile/README.md`'s
     "Known pitfalls" section for the write-up future sheet authors should read.
   - **`week.tsx`/`month.tsx` (post-#20 follow-up):** both stub screens now also render a
     `CreateTaskFab` (`components/tasks/create-task-fab.tsx`, factored out of `index.tsx`'s FAB +
     `CreateTaskSheet` pairing) so task creation isn't Day-only, even though neither has a real
     task list yet — `onCreated` is a plain success toast there instead of a list `refetch`.
   - **Task form moved off bottom sheets onto its own screen (post-#20 follow-up):**
     `CreateTaskSheet`/`EditTaskSheet` are gone — the form now lives at `app/task/new.tsx` /
     `app/task/[id]/edit.tsx`, pushed as `presentation: "modal"` Stack screens instead of
     presented via `@gorhom/bottom-sheet`. `ChangeDurationSheet` is untouched (still a sheet).
     See `mobile/README.md`'s "The task create/edit form is a full screen, not a bottom sheet"
     for the callback-threading and typed-routes fallout.

### Phase 6 — Polish + EAS (ongoing)

1. Haptic tuning: `Haptics.impactAsync(Medium)` on snap, `Light` on hover, `Success` on complete, `Error` on conflict.
2. Dark mode: NativeWind's `dark:` classes, synced with `useColorScheme()` from `"nativewind"` + token-aware RN styles.
3. `eas.json`: `development` (dev client), `preview` (internal TestFlight/Play), `production` profiles.
4. E2e tests: Maestro flows for login → create task → verify in day view.

---

## Verification Strategy

### After Phase 0

- `pnpm --filter frontend typecheck` passes (no broken imports after core extraction).
- `pnpm --filter frontend test` passes (utility unit tests still green).
- Confirm `@zenflow/core` has zero DOM-only imports (`document`, `window`, `HTMLElement`).

### After each Phase 1–5 increment

- Run backend Docker stack: `docker compose up -d`.
- `expo start --ios` (iOS Simulator) and `expo start --android` (Android Emulator).
- Golden path: cold launch → OTP login → onboarding → create task → verify it appears on calendar.
- Verify cookie session round-trip using React Native Debugger network inspector.

### Calendar gesture checklist

- [ ] Day view: long-press creates task at correct 15-min-snapped slot
- [ ] Day view: drag task snaps to 15-min grid on release; API call uses `zonedWallClockToUtc` (CLAUDE.md §5)
- [ ] Day view: pinch-zoom adjusts hour density without repositioning task blocks
- [ ] Day view: conflicting tasks render side-by-side (not overlapping)
- [ ] Day view: cross-midnight task renders as head + tail across two scroll positions
- [ ] Week view: swipe left/right advances by one day; today chip highlighted
- [ ] Week view: drag task across screen edge moves it to adjacent day
- [ ] Month view: tap any day cell navigates to day view for that date
- [ ] Month view: "+N more" bottom sheet lists all tasks for that day

### API contract (no backend changes expected)

- `GET /api/v1/tasks?view=day&date=YYYY-MM-DD` returns correct tasks.
- `PATCH /api/v1/tasks/:id/reschedule` body uses ISO-8601 UTC derived via `zonedWallClockToUtc`.
- `POST /api/v1/auth/otp/verify` sets `Set-Cookie` header; subsequent requests include it automatically via cookie jar.
- All responses follow envelope `{ success, message, data }` — no changes needed.
