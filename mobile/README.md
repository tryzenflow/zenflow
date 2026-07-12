# Zenflow Mobile

Expo + React Native app for iOS/Android — coexists with the web `frontend/`, not a
replacement for it. Part of the [Zenflow monorepo](../README.md). See
[docs/react-native-migration.md](docs/react-native-migration.md) for the full migration
plan and phased roadmap; this README covers what's actually scaffolded so far
(Phase 1, step 1: project setup + base login screen, to prove the toolchain works
end to end).

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Framework | Expo SDK 56, Expo Router (file-based, `app/`), React Native 0.85, React 19 |
| Styling | Tailwind CSS v4 via **[uniwind](https://uniwind.dev)** — compiles `className` to native styles at build time (chosen over NativeWind; see [ADR note](#why-uniwind-not-nativewind) below) |
| UI primitives | [React Native Reusables](https://reactnativereusables.com) (shadcn-style registry) on `@rn-primitives/*`, `lucide-react-native` icons |
| Fonts | Geist / Geist Mono via `@expo-google-fonts/geist(-mono)`, loaded with `expo-font` |
| Language | TypeScript (strict, `@/*` → repo-relative alias) |

Not wired up yet (tracked in the migration doc, Phase 1 onward): the cookie-aware API
client, `@zenflow/core`/`@zenflow/shared` consumption, OTP stage 2, onboarding, and the
gesture-first calendar views.

## Project structure

```
mobile/
├── app/                    # Expo Router routes
│   ├── _layout.tsx         # font loading, SafeAreaProvider, nav ThemeProvider, PortalHost
│   ├── index.tsx           # redirects to (auth)/login — no session state exists yet
│   └── (auth)/
│       ├── _layout.tsx
│       └── login.tsx       # email stage of the 2-stage OTP login (see below)
├── components/
│   ├── ui/                 # RN Reusables primitives (button, input, label, text, icon)
│   └── brand/logo.tsx      # react-native-svg port of mockups/logo.svg
├── lib/
│   ├── theme.ts            # hex mirror of global.css tokens, for React Navigation chrome
│   └── utils.ts            # cn() (clsx + tailwind-merge)
├── global.css              # uniwind theme source — see below
├── metro.config.js         # uniwind + pnpm-monorepo config (symlinks, workspace root)
├── components.json         # RN Reusables registry config (shadcn-compatible)
└── docs/react-native-migration.md
```

## Getting started

```bash
pnpm install               # from the repo root — installs the whole workspace
pnpm --filter mobile dev   # or: pnpm mobile:dev
```

Then press `i` (iOS simulator, Mac only), `a` (Android emulator), or `w` (web) — or scan
the QR code with [Expo Go](https://expo.dev/go). `pnpm --filter mobile typecheck` runs
`tsc --noEmit`.

Verifying without a simulator: `npx expo export --platform web` static-renders every
route (catches Metro/uniwind config errors) into `dist/`, which you can serve with any
static file server.

## The Warm Sunrise theme (`global.css`)

Ports every color token from `frontend/src/index.css` / `mobile/mockups/src/input.css`
verbatim (light + dark, brand orange → yellow → lime, small radius). It's a straight
port with one structural difference: uniwind registers themes as
`@layer theme { :root { @variant light {...} @variant dark {...} } }` rather than
Tailwind v4's web `:root` / `.dark` class-selector pattern, and every color is exposed
directly as a `--color-*` key (not indirected through `@theme inline`) — so unlike the
web source, tokens that reference the brand colors (`--color-primary`, `--color-ring`,
chart colors, sidebar colors) are duplicated per theme rather than defined once and
reused, per uniwind's requirement that every theme define the same variable set.

**Ported:** all `--color-*` tokens (background/foreground/card/popover/primary/
secondary/muted/accent/destructive/success/border/input/ring/chart-1..5/sidebar-*),
brand colors, and the radius scale.

**Not ported yet** (calendar-only helpers from the web mockup's component layer —
zone tints, glass cards, hatch-conflict, the `breathe`/`block-highlight` keyframes):
these land with the calendar screens, since uniwind's support for `color-mix()`,
backdrop-blur, and CSS keyframe animations on native hasn't been exercised yet and the
login screen doesn't need them.

**Fonts:** `--font-sans` is pinned to `Geist_400Regular`. The Google Fonts package for
Geist ships separate static files per weight (no single variable-font family RN can
switch by `fontWeight`), so `font-bold`/`font-semibold` utilities currently apply RN's
synthetic bold over the regular file rather than swapping to the true Bold/SemiBold
family — visually close, not pixel-identical to the web app. A real fix (a `Text`
wrapper that maps `font-*` weight classes to the matching loaded family) is future work.

## The login screen

`app/(auth)/login.tsx` ports the email stage of `mobile/mockups/login.html` (stage 1 of
2 — OTP code entry is stage 2, not built yet) as a live, interactive screen rather than
static mockup states: idle → onBlur email validation → loading (spinner on the submit
button) → an inline confirmation once the fake 900 ms "send" resolves. There's no backend
call — the cookie-aware API client is Phase 1 scope in the migration doc, not this step.
This screen exists to prove the setup (Expo + uniwind + RN Reusables + the ported theme)
renders and behaves correctly, which it does — verified via a static web export screenshot
walked through all four states (empty, error, loading, sent).

## Why uniwind, not NativeWind

The original migration doc scoped NativeWind v4. This scaffold uses
[uniwind](https://uniwind.dev) instead (per explicit request): it compiles Tailwind
classes to native styles at build time rather than resolving them at runtime, and its
`extraThemes`/`@variant` theme registration maps cleanly onto the existing OKLch design
tokens (uniwind's dependency on `culori` handles the oklch → native color conversion, so
tokens didn't need manual hex translation the way the original plan assumed). RN
Reusables' CLI/registry supports both libraries; this project was scaffolded from their
`minimal-uniwind` template (`react-native-reusables-templates` repo) rather than
`create-expo-app` + manual uniwind wiring, since the template already had the
Metro/babel/root-layout wiring done correctly. `mobile/docs/react-native-migration.md`
has been updated to match (superseded-plan note at the top, NativeWind references fixed).

## Environment variables

`mobile/.env.development` mirrors `frontend/.env.development`'s pattern (`EXPO_PUBLIC_API_URL`
instead of Vite's `VITE_API_URL` — Expo requires the `EXPO_PUBLIC_` prefix for a var to be
inlined into the client bundle, same idea as Vite's `VITE_` prefix). Like frontend's
`.env.*` files, it's checked into git (no secrets, just a local API base URL) and loaded
automatically by `expo start`'s built-in dotenv support. Nothing reads
`EXPO_PUBLIC_API_URL` yet — it's in place for when the API client lands (migration doc
Phase 1, step 5). Add `.env.production`/`.env.staging` alongside it, matching frontend's,
when there's an actual client to point at those environments.

## App icon

`assets/images/{icon,adaptive-icon,splash,favicon}.png` are rendered from
`mobile/mockups/logo.svg` (via `sharp`, since Metro/Expo config doesn't rasterize SVG
app-icon assets itself) rather than the RNR template's placeholder icons:

- `icon.png` (1024×1024) — the logo circle flattened onto the light `--background` token
  (`#FCFBFA`) so it's a fully opaque square; app stores reject icons with an alpha channel,
  and the mark already reads as a circle without needing a transparent corner crop.
- `adaptive-icon.png` (1024×1024, transparent) — same mark at ~66% scale, centered, for
  Android's adaptive-icon safe zone (outer edges get cropped by whichever mask shape the
  launcher uses); `app.json`'s `android.adaptiveIcon.backgroundColor` supplies the same
  `#FCFBFA` behind it.
- `splash.png` (1024×1024, transparent) — mark at a smaller centered scale, shown via
  `expo-splash-screen`'s `resizeMode: "contain"` over the same background color.
- `favicon.png` (48×48) — web tab icon.

Regenerate after a logo change with `sharp`: rasterize `mockups/logo.svg` at the target
pixel size (pass `density: 72 * (size / 260)` — the viewBox is 260×260 — so it renders
crisp at that size instead of upscaling a low-DPI default), then `.flatten()` onto
`#FCFBFA` for `icon.png`, or composite onto a transparent square at a smaller scale
(~66%) for `adaptive-icon.png`/`splash.png`. No script is checked in since it's a one-off;
this note is enough to redo it.

## pnpm workspace notes

`mobile` is its own top-level workspace entry (not just `mobile/*`) alongside
`mobile/mockups`, since Expo Router's convention puts the routes at `<project-root>/app`
and the RN Reusables template's `package.json` lives at the project root. `metro.config.js`
adds monorepo-awareness Expo's docs recommend for pnpm: `watchFolders` includes the repo
root, `nodeModulesPaths` covers both `mobile/node_modules` and the root, and
`unstable_enableSymlinks`/`unstable_enablePackageExports` are turned on since pnpm's
`node_modules` is symlink-based (Metro's resolver doesn't follow symlinks by default).
