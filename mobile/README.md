# Zenflow Mobile

Expo + React Native app for iOS/Android/web — coexists with the web `frontend/`, not a
replacement for it. Part of the [Zenflow monorepo](../README.md).

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Framework | Expo SDK 52, Expo Router (file-based, `app/`), React Native 0.76, React 18 |
| Styling | Tailwind CSS **v3** via **[NativeWind](https://www.nativewind.dev) v4** — compiles `className` to native styles at build time. See [Known pitfalls](#known-pitfalls) — this is a different (and stricter) setup than the web app's Tailwind v4 |
| UI primitives | Hand-rolled shadcn/RN-Reusables-style components in `components/ui/`, backed by our own headless primitives in `components/primitives/` (no `@rn-primitives/*` package dependency), `lucide-react-native` + `phosphor-react-native` icons |
| Fonts | Geist (all weights) loaded locally from `assets/fonts/` via `expo-font` — see [Fonts](#fonts--font-weights) |
| Language | TypeScript (strict, `@/*` → repo-relative alias) |
| State | Zustand (`hooks/use-user-store.ts`, mirrors the web user store) |
| Forms | React Hook Form + Zod (`@hookform/resolvers`) — note-worthy version pin, see [Known pitfalls](#known-pitfalls). `taskSchema`/`TaskFormValues`/`placementQualifier` live in `@zenflow/core` (`packages/core/src/tasks.ts`), shared with `frontend/`'s equivalent (currently a parallel, hand-synced copy — see Phase 5 in `docs/react-native-migration.md`) |
| HTTP | axios (`api/`), cookie-based session — see [Auth & session](#auth--session) |
| Bottom sheets | `@gorhom/bottom-sheet` **v5** |
| Rich text editor | [`@10play/tentap-editor`](https://github.com/10play/10tap-editor) `^1.0.1` — Tiptap/ProseMirror running in a `react-native-webview` WebView with a native RN bridge (the only real way to run Tiptap on RN — it has no native port). Pinned to the Tiptap-**v3**-based `1.0.x` line specifically (not the older, still-maintained `0.7.x`/Tiptap-v2 line) so its `@tiptap/*` transitive deps share a major version with `frontend/`'s own hoisted Tiptap v3 copies — `frontend/src/components/common/editor/{video,audio}-block.tsx` bare-import `@tiptap/core` relying on root hoisting (see the root `.npmrc`'s top comment), and mixing Tiptap v2 (mobile) + v3 (frontend) under one hoisted `node_modules/@tiptap/core` broke that resolution during install (confirmed empirically: installing the `0.7.x` line produced hard `unmet peer @tiptap/core@^2.7.0: found 3.26.0` conflicts). `react-native-webview` is pinned to `13.12.5`, the exact version Expo SDK 52's `bundledNativeModules.json` lists as compatible. **Adding this native module requires a dev-client rebuild** (`expo run:android`/`expo run:ios`) before it works on-device/emulator — not verified in this environment (no device/emulator available here); see `components/tasks/form/description-field.tsx`'s doc comment. |
| Formatter / linter | [Biome](https://biomejs.dev) (not ESLint/Prettier — those are the web app's tooling). **Not currently an installed dependency anywhere in the repo** — `pnpm --filter mobile format` fails with "'biome' is not recognized" until `@biomejs/biome` is added as a devDependency; `pnpm dlx @biomejs/biome@1.5.3 check --apply .` works as a one-off in the meantime (matches the `biome.json` `$schema` version) |

## Project structure

```
mobile/
├── app/                       # Expo Router routes
│   ├── _layout.tsx            # fonts, ThemeProvider, session hydration, AuthGate
│   ├── global.css             # NativeWind theme source (Warm Sunrise tokens, see below)
│   ├── (auth)/login.tsx       # email + OTP code, 2-stage login
│   ├── (onboarding)/index.tsx # work hours / days / timezone / duration-mode wizard
│   └── (app)/                 # tab navigator: index (Day), week, month, settings
│       ├── index.tsx          # Day — still a Phase 2 grid stub, but with the task sheets wired
│       │                      # against a plain task list (tap → edit, long-press → resize,
│       │                      # long-press empty area / FAB → create); see Phase 5 in
│       │                      # docs/react-native-migration.md
│       ├── week.tsx, month.tsx  # placeholder stubs — calendar UI is future work, but each still
│       │                        # renders <CreateTaskFab> so task creation isn't Day-only
│       └── settings.tsx       # fully built: profile, theme, timezone, duration mode, insights
├── api/                       # axios endpoint functions (auth, tasks, tags, users) + base.ts
├── components/
│   ├── ui/                    # shadcn-style components (button, dialog, select, toast, …)
│   ├── primitives/            # headless behavior (portal, slot, useControllableState, …),
│   │                          # each with a `.web.tsx` variant where native/web diverge
│   ├── onboarding/, settings/ # screen-specific composite components
│   ├── tasks/                 # CreateTaskSheet / EditTaskSheet / ChangeDurationSheet — each a
│   │   │                      # forwardRef component with an imperative `.open(...)` handle (see
│   │   │                      # Known pitfalls' "Bottom sheets must open synchronously" note),
│   │   │                      # plus CreateTaskFab (the reusable "+" FAB + CreateTaskSheet
│   │   │                      # pairing used by index.tsx/week.tsx/month.tsx)
│   │   └── form/               # duration stepper/slider, deadline chip row, tag autocomplete,
│   │                           # description field (WYSIWYG, @10play/tentap-editor) + floating
│   │                           # toolbar — see task-sheet-fields.tsx
│   ├── error-boundary.tsx     # local render-crash containment (class component) — see
│   │                          # Known pitfalls' "Blast-radius containment" note
│   └── tab-icons.tsx, Icons.tsx, logo.tsx, ThemeToggle.tsx
├── hooks/                      # use-user-store (Zustand), use-local-storage, use-task-form
│                                # (taskSchema from @zenflow/core)
├── lib/
│   ├── api-client.ts           # cookie-aware axios instance — see Auth & session
│   ├── session.ts               # SecureStore-backed cache (user + raw session cookie)
│   ├── constants.ts             # NAV_THEME — hand-maintained hex mirror of global.css tokens
│   ├── useColorScheme.tsx, android-navigation-bar.ts
│   ├── tag-match.ts             # tag-autocomplete matching (prefix/substring, not cmdk fuzzy)
│   ├── task-toasts.ts           # create/edit placement toast copy (success/conflict)
│   └── utils.ts                # cn() (clsx + tailwind-merge)
├── plugins/withAndroidBuildFixes.js  # Expo config plugin: Gradle/Kotlin build fixes
├── global.css / tailwind.config.ts / metro.config.js / babel.config.js  # NativeWind wiring
├── components.json             # path aliases for the ui/primitives generator pattern
└── biome.json
```

## Screens & routing

Three route groups under `app/`, gated by `AuthGate` in the root layout (mirrors the web
`with-auth.tsx` HOC, driven by the Zustand user store rather than a per-navigation `/auth/me`
call):

| Group | Screen(s) | State |
|-------|-----------|-------|
| `(auth)` | `login.tsx` | Built — email stage → OTP verification stage |
| `(onboarding)` | `index.tsx` | Built — work hours / work days / timezone / duration-adjustment mode wizard |
| `(app)` | `index.tsx` (Day) | **Grid still a Phase 2 stub**, but the task sheets (create/edit/change-duration — RN migration Phase 5, issue #20) are wired against a plain task list in the meantime: tap a task → edit, long-press a task → change duration, long-press the empty area or the FAB → create |
| `(app)` | `week.tsx`, `month.tsx` | **Placeholder stubs** — calendar UI is future work |
| `(app)` | `settings.tsx` | Built — profile row, theme toggle, timezone picker, duration-mode picker, insights panel |

`AuthGate` redirects: no user → `(auth)`; user but `!onboardingComplete` → `(onboarding)`;
otherwise → `(app)`. Group-qualified redirects (not a bare `/`) are deliberate — see the
comment in `app/_layout.tsx` for the "Done button sends me back to onboarding" bug it avoids.

## Auth & session

No JWT (CLAUDE.md §7 — OTP + Redis session cookie, same backend contract as `frontend/`), but
native can't use a browser cookie jar:

- **Web:** the browser's own cookie jar + `withCredentials` handles everything — identical to
  `frontend/`.
- **Native:** the session cookie is `httpOnly`, so it can never be read back via
  `android.webkit.CookieManager` (or any native cookie-jar API) — same restriction as
  `document.cookie` in a browser. Instead, `lib/api-client.ts` captures the raw `Set-Cookie`
  value itself the one time it's visible (a response header, not script-facing), replays it as
  an explicit `Cookie` request header on every call, and persists it via `expo-secure-store`
  (`lib/session.ts`) so it survives app restarts. A 401/403 from any guarded endpoint clears
  both the cached cookie and the Zustand user, which lets `AuthGate` react.
- `lib/api-client.ts` also rewrites a loopback `EXPO_PUBLIC_API_URL` to the LAN host Metro
  reports (`Constants.expoConfig.hostUri`) when running on a physical device/emulator, where
  `localhost` would otherwise resolve to the device itself.

## Styling — NativeWind & the "Warm Sunrise" theme

`app/global.css` ports the same OKLch-derived tokens as `frontend/src/index.css`, translated to
sRGB `"R G B"` channel triples (NativeWind/RN can't consume `oklch()` or resolve `/<alpha-value>`
against a bare hex string — see the comment block at the top of `global.css`). `tailwind.config.ts`
maps these to the standard shadcn color names (`background`, `foreground`, `primary`, `muted`,
etc.) plus the brand ramp (`orange`/`yellow`/`lime`).

**Fonts & font weights:** RN has no synthetic font-weight — every weight needs its own loaded
font file. `components/ui/text.tsx`'s `resolveGeistFontFamily()` reads a `font-*` utility
(`font-medium`, `font-semibold`, …) off the resolved `className` and maps it to the matching
`Geist-*` family loaded in the root layout, then strips the utility so NativeWind doesn't also
try to turn it into a (wrong, synthetic) `fontWeight` style. Text variants (`Muted`, `Small`,
`Lead`, `H1`–`H4`, …) live in `components/ui/typography.tsx`.

## Known pitfalls

### NativeWind silently resolving the wrong Tailwind major version

**Symptom:** every screen renders with default React Native styling — plain black text at one
size, no `text-muted-foreground`/`text-secondary`/size-variant classes applied, and all margin
/padding/gap utilities missing. No error is thrown; the bundle builds and runs "successfully."

**Cause:** the repo root's `tailwindcss` is hoisted at **v4** for `frontend/`'s own Tailwind v4
setup. NativeWind 4.1.6 (this app's version) is built against Tailwind **v3** and expects its
own private copy. The root `.npmrc` (`node-linker=hoisted`) carries
`public-hoist-pattern[]=!nativewind`, which tells pnpm to keep NativeWind un-hoisted so it nests
its own compatible `tailwindcss@3.4.1` inside `node_modules/nativewind/node_modules/` instead of
resolving the root's hoisted v4 copy. If that `.npmrc` line is ever missing, reverted, or edited
without a following `pnpm install`, NativeWind ends up walking up to the root's `tailwindcss@4.x`
— which has a very different config/PostCSS surface — and its class-to-style compilation breaks
across the board, with no visible error.

**Fix / verification:**

1. Confirm `public-hoist-pattern[]=!nativewind` is present in the repo-root `.npmrc`.
2. Run `pnpm install` from the repo root (not just `mobile/`) — this is a workspace-wide hoist
   decision, so it has to run at root.
3. Verify: `node_modules/nativewind/node_modules/tailwindcss/package.json` should report a
   `3.x` version, distinct from the root `node_modules/tailwindcss` (`4.x`, for `frontend/`).
4. **Restart the Metro bundler with its cache cleared.** This is the step that's easy to miss:
   `pnpm dev` / `dev:web` / `dev:android` all pass Expo's `--clear` (`-c`) flag, but the plain
   `android` / `ios` scripts (`expo run:android` / `expo run:ios`) do **not** — so a Metro
   process already running from before the `.npmrc`/`pnpm install` fix will keep serving the
   stale, broken bundle from its in-memory + on-disk transform cache indefinitely, even after
   `node_modules` is corrected. Kill any process holding port 8081, then either run
   `pnpm --filter mobile dev:android` (has `-c`, reuses an already-installed dev-client build —
   no native rebuild needed unless native code changed) or manually clear the cache
   (`%LOCALAPPDATA%/Temp/metro-cache` and `metro-file-map-*` on Windows) before the next
   `expo run:android`/`run:ios`.

### Other pnpm workspace version splits (same root cause pattern)

The root `.npmrc` carries a few other `public-hoist-pattern[]=!<pkg>` exclusions for the same
reason — `frontend/` and `mobile/` want genuinely different major versions of a shared
dependency, and `node-linker=hoisted` needs to be told which packages must keep their own nested
copy instead of resolving the other workspace's hoisted one:

- `zod` / `@hookform/resolvers` — the `.npmrc` comment above this exclusion still says `mobile/`
  wants zod v3 + resolvers v3; that's stale. `mobile/package.json` declares `zod@^4.1.12` +
  `@hookform/resolvers@^5.2.2` — the same majors as `frontend/` — confirmed by
  `app/(auth)/login.tsx`'s `z.email()` call (a zod-v4-only top-level function) and by
  `packages/core/src/tasks.ts`'s hoisted `taskSchema` (zod v4 `{ error: … }` issue syntax)
  resolving and type-checking cleanly for `mobile/` (RN migration Phase 5, issue #20). Keeping
  `zod`/`@hookform/resolvers` un-hoisted is still harmless now that both workspaces want the
  same majors — just no longer load-bearing the way the comment describes.
- `react-hook-form` — pinned to an exact version in `mobile/package.json` (see the `.npmrc`
  comment) to force pnpm to nest a separate copy from `frontend/`'s, avoiding two live React
  copies in one bundle.

If a "works on frontend, broken on mobile" (or vice versa) bug involves one of these packages,
check whether `.npmrc` and `mobile/package.json`'s pin are both still in sync with a recent
`pnpm install` before looking anywhere else.

Note `@10play/tentap-editor` deliberately avoided needing a *new* entry here: it's pinned to the
Tiptap-v3-based `1.0.x` line (not the also-current `0.7.x`/Tiptap-v2 line its own docs still lead
with) specifically so its `@tiptap/*` transitive deps share a major version with `frontend/`'s
already-hoisted Tiptap v3 copies instead of splitting — see the Tech stack table above.

### `@10play/tentap-editor` / `react-native-webview` need a dev-client rebuild

Both are native modules (the editor runs Tiptap inside a `react-native-webview` WebView with a
native RN bridge). Installing them via `pnpm install` alone is not enough to use
`components/tasks/form/description-field.tsx` on a device/emulator — Metro/JS-only reloads
(`pnpm dev`/`dev:android`) won't pick up a brand-new native dependency; it needs a real native
rebuild (`pnpm --filter mobile android` / `ios`) to link the new module into the dev client
before the WebView will actually mount. This was **not** verified in the environment this was
implemented in (no Android/iOS device or emulator available there) — `pnpm --filter mobile
typecheck` is clean and the JS-level API usage was checked against the installed package's own
`.d.ts` output, but the actual on-device WebView bridge round-trip is unverified. Rebuild and
manually exercise the description field (all toolbar buttons, link insert, and that `note`
round-trips as HTML through a create → edit cycle) before shipping.

**Blast-radius containment:** if the dev client hasn't been rebuilt yet (or the native module is
otherwise missing), mounting the WebView throws during render. `@gorhom/bottom-sheet` already
defers mounting a `BottomSheetModal`'s content until `present()` is called, but that's still
*during* the same open attempt — so an unhandled throw there previously unwound all the way to
Expo Router's per-route `ErrorBoundary` (`app/_layout.tsx`), unmounting the entire Day screen
(`app/(app)/index.tsx`) and making every sheet-opening gesture on it — FAB, long-press-empty-area,
tap-to-edit, long-press-to-resize — look equally broken, since `CreateTaskSheet`, `EditTaskSheet`,
and `ChangeDurationSheet` are siblings under that one tree. `components/error-boundary.tsx` is a
local class-component boundary now wrapping just `DescriptionField` in
`components/tasks/task-sheet-fields.tsx`, so a WebView-mount failure degrades to an inline
fallback in that one field instead of taking the rest of the form, and every other sheet on the
screen, down with it. It doesn't fix the underlying missing-native-module issue — only a real
dev-client rebuild does that.

### Bottom sheets must call `.present()`/`.dismiss()` synchronously from the press handler

**Symptom:** a `@gorhom/bottom-sheet` `BottomSheetModal` never opens (or never closes) even
though the trigger `Pressable` fires and no error is thrown.

**Cause:** `CreateTaskSheet`/`EditTaskSheet`/`ChangeDurationSheet` used to be externally
controlled by an `open: boolean` + `onOpenChange` prop pair, driven by `useState` in the calling
screen and bridged through a `useControlledBottomSheet(open)` hook that called
`ref.current?.present()`/`.dismiss()` inside a `useEffect` keyed on `open` — i.e. *after* a state
update flowed through a re-render, never inside the actual `Pressable`'s `onPress`/`onLongPress`
handler itself. Every other sheet in the app (`components/onboarding/time-picker-row.tsx`,
`components/settings/duration-mode-picker-row.tsx`, `components/settings/timezone-picker-row.tsx`)
instead calls `useBottomSheet()`'s `open`/`close` (or `BottomSheetOpenTrigger`'s internal
`sheetRef.current?.present()`) **directly and synchronously inside the press handler**, and those
always worked. The effect-driven indirection was the actual difference — not a WebView/native
module issue (an earlier, unrelated hypothesis involving `@10play/tentap-editor` was ruled out:
the sheets still didn't open with the rich-text editor removed entirely).

**Fix:** the three task sheets are now `forwardRef` components exposing an imperative
`open(...)`/handle via `useImperativeHandle`, each using `useBottomSheet()` internally and
calling `bottomSheet.open()`/`.close()` synchronously wherever the old code called
`onOpenChange(true)`/`(false)` — matching the working pattern exactly. Callers hold a
`useRef<XSheetHandle>(null)` and call `xRef.current?.open(...)` directly inside the triggering
`Pressable`'s `onPress`/`onLongPress` (see `app/(app)/index.tsx`). `hooks/use-controlled-bottom-sheet.ts`
was deleted — don't reintroduce an effect-driven `open`-prop bridge for a new sheet; use
`useBottomSheet()` + an imperative handle instead.

### `react-native-webview` has no real web implementation — gate WebView-backed UI by `Platform.OS`

**Symptom:** on the web dev target only, `DescriptionField`'s rich-text editor
(`components/tasks/form/description-field.tsx`, `@10play/tentap-editor`) grew unboundedly tall
with no content typed, and unrelated focus interactions elsewhere in the same sheet threw
`Error: Couldn't find a navigation context`.

**Cause:** `react-native-webview@13.12.5`'s own package ships a static "not supported" stub
(`node_modules/react-native-webview/src/WebView.tsx`, its comment literally names "Expo SDK
'web' platform") that Metro's platform-extension resolution falls back to for `platform=web`,
since the package has `.ios`/`.android`/`.macos`/`.windows` variants but no `.web` — confirmed by
grepping the actual served Metro web bundle for that stub's literal text. `@10play/tentap-editor`'s
`RichText` (and its `dynamicHeight` ResizeObserver-based height-reporting) never runs on web as a
result. `DescriptionField` is now a `Platform.OS` switch: native renders the full
`DescriptionFieldEditor` (WYSIWYG, unaffected), web renders `DescriptionFieldWeb`, a plain
`Textarea` bound to the same HTML-string `value`/`onChange` contract, capped with a NativeWind
`max-h-*` so it can't grow unbounded either way. The native editor's injected stylesheet
(`injectContentStyles`) also got two independent fixes while investigating: `padding` was
previously applied to both `body` *and* `.ProseMirror` (a descendant of `body`), doubling the
visual inset — now only `.ProseMirror` gets it; and `.ProseMirror` now gets a `max-height` +
`overflow-y: auto` cap, since the bundled editor HTML's base stylesheet sets `.ProseMirror {
min-height: 100%; overflow: visible }` unconditionally (including in `dynamicHeight` mode, where
the containing block's own height is `unset`/auto) — a circular percentage-height relationship
that a non-spec-compliant WebView engine could resolve into runaway growth on native, which the
cap now bounds regardless of engine.

**If you add another `react-native-webview`-backed feature:** don't assume it degrades gracefully
on web on its own — either gate it by `Platform.OS !== "web"` with a real fallback (as above) or
confirm the specific library you're wrapping ships its own `.web` implementation.

### `@gorhom/bottom-sheet` components must come from `@/components/ui/bottom-sheet`, never straight from the package

**Symptom:** on the web dev target only, opening/interacting with a task sheet
(`CreateTaskSheet`/`EditTaskSheet`/`ChangeDurationSheet`) could destabilize the surrounding
screen — up to and including an unrelated `Error: Couldn't find a navigation context` thrown from
deep inside `@react-navigation/core` while focusing a plain `TextInput` (`TagAutocomplete`)
elsewhere in the same sheet.

**Cause:** `components/ui/bottom-sheet.tsx` (web) reimplements the `BottomSheet*` API on the
`Dialog` primitive (Radix) — deliberately, since `BottomSheetContent` there is **not** a real
`@gorhom/bottom-sheet` `<BottomSheetModal>` instance (see that file's header comment). The three
task sheets nonetheless imported `BottomSheetScrollView` **directly from `@gorhom/bottom-sheet`**
and rendered it as their scrollable body — but gorhom's own `BottomSheetScrollView` reads
`useBottomSheetInternal()`, a context only a real gorhom `<BottomSheet>`/`<BottomSheetModal>`
instance provides. On native this was always fine (`bottom-sheet.native.tsx`'s `BottomSheetContent`
renders a real one), but on web it meant every task sheet's *entire body* — `TaskSheetFields`,
`TagAutocomplete`, `DescriptionField`, all of it — mounted inside a component that unconditionally
throws `"'useBottomSheetInternal' cannot be used out of the BottomSheet!"`, the kind of
render-time failure that can leave the surrounding tree (including sibling navigator state) in an
inconsistent state, plausibly surfacing as an unrelated-looking error on the next re-render.

**Fix:** `@/components/ui/bottom-sheet` now exports `BottomSheetScrollView` on both platforms —
native re-exports gorhom's real component unchanged (context is always satisfied there), web gets
a plain `ScrollView` wrapper (mirroring the existing `BottomSheetFlatList` pattern in the same
file, which already avoided this trap). `create-task-sheet.tsx`/`edit-task-sheet.tsx`/
`change-duration-sheet.tsx` now import it from there instead of `@gorhom/bottom-sheet`. **Don't
import anything from `@gorhom/bottom-sheet` directly for use inside a sheet's body** — go through
`@/components/ui/bottom-sheet` (adding a wrapper there if one's missing) so both platforms resolve
to something that actually works; a bare `@gorhom/bottom-sheet` import type-checks fine (native's
`moduleSuffixes` resolution masks the mismatch — see the next paragraph) but silently breaks on
web only.

Separately, note `components/primitives/bottomSheet/bottom-sheet.native.tsx` is an orphaned
duplicate of `components/ui/bottom-sheet.native.tsx` (predates the `setRefs`-callback-ref fix
described above, and nothing imports it) and `components/settings/ThemeItem.tsx` imports from
`@/components/primitives/bottomSheet/bottom-sheet.native` with the `.native` suffix spelled out
explicitly in the specifier — which makes Metro resolve that exact file on *every* platform,
web included, bypassing the web/native split this section describes. Neither was touched here
(out of scope for the task-sheet bug this section documents), but both are worth cleaning up in a
follow-up.

### The task create/edit form is a full screen, not a bottom sheet

`CreateTaskSheet`/`EditTaskSheet` (referenced by name in several sections above, as the sheets
they were when those bugs were investigated) no longer exist. The task form now lives on its own
route — `app/task/new.tsx` and `app/task/[id]/edit.tsx`, registered in `app/_layout.tsx`'s root
`<Stack>` with `presentation: "modal"` — sharing chrome via
`components/tasks/task-form-screen.tsx`. `ChangeDurationSheet` is unaffected and still a real
`@gorhom/bottom-sheet` sheet (a small single-purpose quick action, not a form), so the
bottom-sheet-specific guidance above still matters for it.

Two knock-on changes from dropping the sheet-ref pattern:

- **No more `onCreated`/`onSaved`/`onDeleted` callbacks threaded through a `useRef<XSheetHandle>`**
  — a screen reached via `router.push` has no ref back to its caller. `app/(app)/index.tsx`
  instead refetches via `useFocusEffect` (from `@react-navigation/native`) whenever the Day screen
  regains focus, which covers all three cases (create/edit/delete) without per-action wiring.
  `week.tsx`/`month.tsx` (no task list yet) dropped their `onCreated` toast entirely — the
  new-task screen shows its own placement toast (via `lib/task-toasts.ts`) before calling
  `router.back()`, same copy as before.
- **Typed routes friction:** `app/task/new.tsx` and `app/task/[id]/edit.tsx` didn't exist when
  `.expo/types/router.d.ts` (gitignored, Metro-generated) was last regenerated, so `Href`s built
  against them need an `as Href` cast for now (see `createTaskAtNowHref` in
  `components/tasks/create-task-fab.tsx`, and the `_layout.tsx` `<Redirect>`s, which already used
  this pattern before this change) — running `pnpm dev`/`pnpm dev:web` once regenerates the file
  and the casts stop being load-bearing (harmless either way).

## Local development

```bash
# From repo root, once:
pnpm install

# Mobile scripts (inside mobile/, or `pnpm --filter mobile <script>`):
pnpm dev            # expo start --dev-client --clear
pnpm dev:web        # expo start -c --web       → http://localhost:8081
pnpm dev:android    # expo start -c --android   (reuses an installed dev-client build)
pnpm android        # expo run:android          (full native rebuild — no cache clear, see above)
pnpm ios            # expo run:ios              (macOS only)
pnpm export         # static web export → dist/
pnpm typecheck      # tsc --noEmit
```

No test runner is configured in `mobile/` (no `test` script, no Jest/Vitest config) — logic
that's easy to unit test in isolation (`@zenflow/core`'s `taskSchema`/`placementQualifier`,
`mobile/lib/tag-match.ts`) doesn't have automated coverage yet for the same reason `packages/core`
itself has no `test` script either.

Set `EXPO_PUBLIC_API_URL` in `.env.development` (defaults to
`http://localhost:5000/api/v1`) so the axios client targets the API; on a physical
device/emulator a loopback host is auto-rewritten to the dev machine's LAN address (see
[Auth & session](#auth--session)).

## Contributing

- **Formatter / linter:** [Biome](https://biomejs.dev), not ESLint/Prettier —
  `pnpm --filter mobile format`. 2-space indentation ([`.editorconfig`](../.editorconfig)).
- **Commits:** [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  e.g. `fix(mobile): …`, `feat(mobile): …`.

See the repo-wide **[CONTRIBUTING.md](../CONTRIBUTING.md)** for setup, branching, and testing.
