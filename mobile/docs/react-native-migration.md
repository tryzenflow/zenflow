> **What this doc is:** A phased migration plan to add a native iOS/Android app (`mobile/`) to the
> Zenflow monorepo alongside the existing web `frontend/`. The web app is **not retired** — both coexist.
> **Who should read it:** Any engineer implementing the mobile app, the UI/UX designer running Figma,
> and the solution architect deciding where shared logic lives.
> **Prerequisites:** Read [CLAUDE.md](../CLAUDE.md) (invariants §1–§7) and
> [frontend/README.md](../frontend/README.md) before touching calendar or timezone logic.
> **Related:** [heuristic.md](heuristic.md) (scheduling invariants that calendar logic must preserve)

---

## Terminology

| Term | Plain definition |
|------|-----------------|
| `mobile/` | The new Expo + React Native package, added at repo root alongside `frontend/` |
| `packages/core/` | New workspace package `@zenflow/core` — pure utilities extracted from `frontend/src/utils/` |
| Expo Router | File-based navigation for React Native (mirrors React Router's mental model; routes are files) |
| NativeWind v4 | Tailwind CSS utility classes compiled for React Native's `StyleSheet` — no DOM dependency |
| Reanimated | `react-native-reanimated` — worklet-based 60 fps gesture/animation library replacing dnd-kit |
| RNGH | `react-native-gesture-handler` — native recognizers (pan, long-press, pinch) |
| Bottom Sheet | `@gorhom/bottom-sheet` — native slide-up panel; replaces every Radix Dialog/Sheet |
| EAS Build | Expo Application Services — cloud native builds for App Store / Play Store |
| OKLch | The color space used in Tailwind v4 design tokens; **not** supported in RN `StyleSheet` |
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
| All Radix UI primitives | `@radix-ui/*` (20+ packages) | `@gorhom/bottom-sheet` (sheet/dialog), NativeWind (dropdown), RN built-ins (tabs) | Radix is DOM-only |
| Rich text note editor | Tiptap / ProseMirror | Native `TextInput` multiline (Phase 1); `@10play/tentap-editor` (Phase 2) | Tiptap has no RN port |
| Navigation | React Router v7 | Expo Router v4 (file-based, same mental model) | |
| CSS layout + OKLch design tokens | Tailwind v4 Vite plugin | NativeWind v4 + `tokens.ts` (OKLch → hex/RGB) | RN `StyleSheet` rejects OKLch |
| `position: absolute` % values | `top/left/width/height` as `%` strings | Same math; output numeric dp values (`(min / 1440) × totalHeight`) | |
| Cookie session management | Browser HTTP-only cookies (automatic) | `@react-native-cookies/cookies` + axios interceptor + `expo-secure-store` | |
| File uploads | `<input type="file">` multipart | `expo-image-picker` + `expo-document-picker` + `expo-file-system` | |
| Toast notifications | Sonner | `react-native-toast-message` | |
| Icons | `lucide-react` | `lucide-react-native` (drop-in name parity) | |
| Keyboard shortcuts | `useViewShortcuts` (d/w/m, arrows) | Remove; replace with tab bar + swipe navigation | Not applicable on mobile |
| PWA offline / service worker | `vite-plugin-pwa` | `expo-updates` OTA | |
| Dark mode | `next-themes` + CSS `prefers-color-scheme` | `useColorScheme()` + NativeWind `dark:` variant | |

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
│   │   └── ui/                        # NativeWind primitive components
│   ├── hooks/
│   │   ├── use-user-store.ts          # Zustand (same as web)
│   │   ├── use-task-form.ts           # Ported RHF hook
│   │   ├── use-calendar-gesture.ts    # NEW: pan + long-press + pinch orchestration
│   │   └── use-haptics.ts             # expo-haptics wrapper
│   ├── lib/
│   │   ├── task-card.ts               # Same state logic → RN style objects
│   │   └── api-client.ts              # Cookie-aware axios instance
│   ├── src/api/                       # Ported from frontend/src/api/
│   ├── src/tokens.ts                  # OKLch → hex/RGB design token translation
│   ├── app.json                       # Expo config (APP_API_URL, bundle ID, etc.)
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
  "expo": "~53.x",
  "expo-router": "~4.x",
  "react-native": "0.79.x",
  "react-native-gesture-handler": "~2.21.x",
  "react-native-reanimated": "~3.17.x",
  "nativewind": "^4.1.x",
  "tailwindcss": "^4.x",
  "react-hook-form": "^7.x",
  "zod": "^3.x",
  "zustand": "^5.x",
  "axios": "^1.x",
  "date-fns": "^4.x",
  "date-fns-tz": "^3.x",
  "expo-haptics": "~14.x",
  "expo-secure-store": "~14.x",
  "expo-image-picker": "~16.x",
  "expo-document-picker": "~12.x",
  "expo-file-system": "~18.x",
  "@gorhom/bottom-sheet": "^5.x",
  "react-native-toast-message": "^2.x",
  "lucide-react-native": "latest",
  "@react-native-cookies/cookies": "^5.x"
}
```

**Design token translation.** The "Warm Sunrise" palette uses OKLch — unsupported in RN `StyleSheet`.
Maintain `mobile/src/tokens.ts` mapping every `--brand-*`, `--background`, `--foreground`, `--card`,
`--muted`, `--border`, `--destructive` token to light/dark hex pairs. Use this as the single source of
truth for RN styles; never hardcode hex values in component files.

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

1. Run `npx create-expo-app@latest mobile --template expo-router` at repo root.
2. Configure NativeWind v4 (`babel.config.js` preset, `tailwind.config.js` with `content` pointing at `app/**` and `components/**`).
3. Add `mobile/src/tokens.ts`: convert all OKLch design tokens to hex/RGB light/dark pairs.
4. Add `@zenflow/shared` and `@zenflow/core` as workspace deps (`pnpm --filter mobile add @zenflow/shared @zenflow/core`).
5. Port `frontend/src/api/` → `mobile/src/api/`; replace `VITE_API_URL` with `process.env.EXPO_PUBLIC_API_URL`.
6. Create `mobile/src/lib/api-client.ts`: axios instance with `@react-native-cookies/cookies` jar.
7. Implement `app/(auth)/login.tsx` — 2-stage OTP form (port logic from `frontend/src/pages/login.tsx`).
8. Implement `app/(onboarding)/[step].tsx` — 6-step wizard (port validation from `frontend/src/pages/onboarding.tsx`).
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

### Phase 4 — Month View (3–4 days)

1. `MonthGrid`: renders 7-column rows via `FlatList`; `numColumns={7}`.
2. Month pagination: outer horizontal `FlatList`, `snapToInterval = screenWidth`.
3. `MonthCell`: task pills (max 2), "+N more" `TouchableOpacity`.
4. Day tap → `router.push('/(app)/?date=YYYY-MM-DD')`.
5. "+N more" → `@gorhom/bottom-sheet` `TaskListSheet` for that day.
6. Task drag: `LongPressGestureHandler` → `PanGestureHandler` → compute target cell → PATCH `/tasks/:id/reschedule`.

### Phase 5 — Task Forms + Settings (1 week)

1. `CreateTaskSheet` / `EditTaskSheet` via `@gorhom/bottom-sheet` v5.
2. Port all `task-form.tsx` fields: title, duration input (15-min stepper), deadline picker, tag selector, note `TextInput`, fixed-time toggle.
3. `OverflowSheet`: display `outsideHours` and `nextAvailable` options from `CreateTaskResponse.overflow`.
4. Duration suggestion toast via `react-native-toast-message` (port of `rationale-toast.tsx`).
5. `SettingsScreen`: work hours time pickers, work days toggle row, timezone picker, duration mode selector.

### Phase 6 — Polish + EAS (ongoing)

1. Haptic tuning: `Haptics.impactAsync(Medium)` on snap, `Light` on hover, `Success` on complete, `Error` on conflict.
2. Dark mode: `useColorScheme()` + NativeWind `dark:` classes + token-aware RN styles.
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
