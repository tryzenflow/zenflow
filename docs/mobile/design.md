# Mobile design: Sunrise Flow

Zenflow is time that flows like a sunrise: calm, warm, always moving forward. Native craft rules are
the floor (below); the principles on top are what make the app recognisably ours. Tokens (Warm Sunrise
colours, Geist) live in `mobile/app/global.css`; this doc covers behaviour and feel, not tokens.

## Principles
1. **Light, not chrome.** Glass reads as warm light through frosted air: amber-tinted blur, soft inner
   glow, hairline edge. Never the default grey material. Dark mode is dusk, not black.
2. **Flow, not snap.** A change of time (day, week, tab, reschedule) travels in the direction of time.
   Nothing teleports. Use the shared presets in `lib/motion.ts`, never ad-hoc durations.
3. **One sun per screen.** One warm focal element (today, next-up, the primary action). Everything
   else recedes. Orange is rationed.
4. **Calm by default.** No bounce for show. Haptics and sound are quiet, warm and reserved for commits.
5. **Ownable marks.** Brand and hero surfaces use custom SVG from `components/brand/` (logo arc,
   horizon, swoosh), not a stock icon set. Utility icons are being migrated (checklist below).
6. **Offline is dusk, not an error.** Cached data stays visible; the state is an icon plus a short line.

## Floor (non-negotiable)
- Touch targets at least 44pt. Text respects system font scale, on top of the app's own `TYPE_SCALE` (`mobile/lib/type-scale.ts`, applied in `Text` and `Input`); retune that one constant, don't hand-bump sizes.
- Motion is spring-based, interruptible, gesture-driven and at most 300 ms. Every animation checks
  `useReducedMotion()` and falls back to a fade or nothing.
- Haptics: selection on discrete choice, impact on commit or drop, notification on result. Never on scroll.
- Glass only on floating chrome (tab bar, sheets, pills, toasts), never on content. Provide an opaque
  fallback where blur is unavailable or contrast would drop below WCAG AA.
- Every screen shows empty, loading, error, offline and dark states in its mockup.
- Strings go through `t()`; short, icon-first, split across lines like toasts, never long sentences.

## Offline
Saved days stay readable ([ADR-0006](../adr/0006-mobile-offline-calendar-cache.md)). The indicator is a
sun-under-horizon glyph beside the bell; tap shows two short toast lines (`Offline` / `Saved 14:32`), and
reconnecting shows `Synced`. Editing is disabled by the failed save, not hidden.

## Logo
Present on login (hero), splash and loading, empty states (as the sun), the offline indicator (dimmed)
and settings/about. Not a header or watermark on every screen: it competes with principle 3.

## Sound
Three chimes, one motif (soft mallet, glass-bell bloom). Files: `mobile/assets/sounds/zenflow_*.wav` (underscores: Android resource names forbid hyphens)
(mono, 48 kHz, 16-bit, about -17 LUFS). Tone is chosen by event in `@zenflow/shared` (`pushToneFor`).
Android binds sound to the channel and it is immutable, so channels are `zenflow-default|reminder|urgent`;
a changed sound needs a new channel id. Needs a dev-client rebuild.

ElevenLabs *Sound Effects* prompts (generate 4 takes, pick one):
- **Default:** Warm notification chime, 1.5s: soft felted-mallet note, then a glass-bell harmonic blooming like sunrise. Calm, premium, no voice, ends in silence.
- **Reminder:** Gentle reminder chime, 1s: one low soft mallet note with a short airy glass bloom. Warm, minimal, quiet.
- **Urgent:** Soft urgent chime, 1.2s: two quick rising mallet notes ending in a bright glass-bell bloom. Clear but gentle, no beeps, no harshness.

## Lucide migration checklist
Custom first: tab bar, login, empty/error/offline states, FAB, Today pill, toast. Everything else still
uses lucide until redrawn; do not add new lucide imports to those surfaces.
