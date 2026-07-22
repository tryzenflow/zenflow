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
│       ├── week.tsx, month.tsx  # placeholder stubs — calendar UI is future work
│       └── settings.tsx       # fully built: profile, theme, timezone, duration mode, insights
├── api/                       # axios endpoint functions (auth, tasks, tags, users) + base.ts
├── components/
│   ├── ui/                    # shadcn-style components (button, dialog, select, toast, …)
│   ├── primitives/            # headless behavior (portal, slot, useControllableState, …),
│   │                          # each with a `.web.tsx` variant where native/web diverge
│   ├── onboarding/, settings/ # screen-specific composite components
│   ├── tasks/                 # CreateTaskSheet / EditTaskSheet / ChangeDurationSheet
│   │   └── form/               # duration stepper/slider, deadline chip row, tag autocomplete,
│   │                           # description field + floating toolbar — see task-sheet-fields.tsx
│   └── tab-icons.tsx, Icons.tsx, logo.tsx, ThemeToggle.tsx
├── hooks/                      # use-user-store (Zustand), use-local-storage, use-task-form
│                                # (taskSchema from @zenflow/core), use-controlled-bottom-sheet
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
