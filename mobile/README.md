# Zenflow Mobile

Expo + React Native app for iOS/Android/web — coexists with the web `frontend/`, not a
replacement for it. Part of the [Zenflow monorepo](../README.md).

---

## Tech stack

| Concern            | Choice                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Framework          | Expo SDK 52, Expo Router (file-based, `app/`), React Native 0.76, React 18                                        |
| Styling            | Tailwind CSS **v3** via **[NativeWind](https://www.nativewind.dev) v4**                                           |
| UI primitives      | Hand-rolled shadcn/RN-Reusables-style components in `components/ui/`                                              |
| Fonts              | Geist (all weights) loaded locally from `assets/fonts/` via `expo-font` — see [Fonts](#fonts--font-weights)       |
| Language           | TypeScript (strict, `@/*` → repo-relative alias)                                                                  |
| State              | Zustand (`hooks/use-user-store.ts`, mirrors the web user store)                                                   |
| Forms              | React Hook Form + Zod (`@hookform/resolvers`)                                                                     |
| HTTP               | axios (`api/`), cookie-based session — see [Auth & session](#auth--session)                                       |
| Bottom sheets      | `@gorhom/bottom-sheet` **v5**                                                                                     |
| Date picker        | [`@react-native-community/datetimepicker`](https://github.com/react-native-datetimepicker/datetimepicker) `8.2.0` |
| Rich text editor   | [`@10play/tentap-editor`](https://github.com/10play/10tap-editor) `^1.0.1`                                        |
| Formatter / linter | [Biome](https://biomejs.dev)                                                                                      |

## Project structure

```
mobile/
├── app/
│   ├── _layout.tsx
│   ├── global.css
│   ├── (auth)/login.tsx
│   └── (app)/
│       ├── index.tsx
│       ├── month.tsx
│       └── settings.tsx
├── api/
├── components/
│   ├── ui/
│   ├── primitives/
│   ├── settings/
│   ├── calendar/
│   ├── tasks/
│   │   └── form/
│   ├── error-boundary.tsx
│   └── tab-icons.tsx, Icons.tsx, logo.tsx, ThemeToggle.tsx
├── hooks/
├── lib/
│   ├── api-client.ts
│   ├── session.ts
│   ├── constants.ts
│   ├── useColorScheme.tsx, android-navigation-bar.ts
│   ├── tag-match.ts
│   ├── task-toasts.ts
│   ├── task-card.ts
│   ├── month-date-math.ts
│   └── utils.ts
├── plugins/withAndroidBuildFixes.js
├── global.css / tailwind.config.ts / metro.config.js / babel.config.js  # NativeWind wiring
├── components.json
└── biome.json
```

## Screens & routing

Two route groups under `app/`, gated by `AuthGate` in the root layout (mirrors the web
`with-auth.tsx` HOC, driven by the Zustand user store rather than a per-navigation `/auth/me`
call):

| Group    | Screen(s)                     | State                                |
| -------- | ----------------------------- | ------------------------------------ |
| `(auth)` | `login.tsx`                   | Email stage → OTP verification stage |
| `(app)`  | `index.tsx` (Calendar / home) | Week view                            |
| `(app)`  | `month.tsx` (Month)           | Month view                           |
| `(app)`  | `settings.tsx`                | Settings                             |

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
pnpm test           # vitest run — lib/**/*.test.ts only, see below
```

**Testing:** `mobile/` now has a minimal Vitest setup (`vitest.config.ts`, scoped to
`lib/**/*.test.ts`) for pure, RN-free logic modules — `lib/month-date-math.ts` and
`lib/task-card.ts`'s tests (`lib/__tests__/`) are the first coverage in this workspace. This is
narrower than a real component/screen test runner: anything importing React Native or
`@gorhom/bottom-sheet` still has no automated coverage (no RN test renderer is configured), and
neither does `@zenflow/core`'s `taskSchema`/`placementQualifier` or `mobile/lib/tag-match.ts` yet
— flagged as a gap, not silently worked around. If a real component-testing setup gets added
later, it should probably subsume this file-scoped config rather than run alongside it.

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
