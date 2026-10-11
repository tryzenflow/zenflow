# Mobile offline mode

Dev-facing notes on what works offline and how to test it. Design rationale:
[ADR-0006](../adr/0006-mobile-offline-calendar-cache.md).

## Behaviour

- **Read-only.** Offline means the device has no connection (NetInfo, or the dev toggle below).
  Create, edit, delete, move and resize are hidden or disabled; tapping a block still opens it.
  API writes are refused client-side (`lib/api-client.ts`) with an "offline" toast.
- **Cached.** Signed in and on every foreground / reconnect the app fetches the previous, current
  and next month plus each day of this week (`lib/warm-calendar.ts`). Task details open from that
  cache (`findCachedSession`), notes included.
- **Not cached.** Images, audio and video in notes. Offline they show a placeholder; a file that
  fails to load shows it too, and tapping retries. Link previews load by default.
- **Settings.** Server-backed rows are greyed out; integrations show the last status seen.
  Dark mode and sign-out still work.

## Simulate offline

The iOS Simulator ignores Xcode's Network Link Conditioner, and a local API stays reachable, so
use the in-app switch:

1. Run a dev build (`__DEV__`), open the dev menu (Cmd+D iOS, Cmd+M Android) and choose
   **Toggle offline**. Every API request then fails like a dead network and the offline UI shows.
2. Cold start offline: `EXPO_PUBLIC_FORCE_OFFLINE=1 pnpm dev`.

Other options: `adb shell svc wifi disable` (Android emulator, host and API stay up), or stop the
API (exercises the failed-refresh path, not the offline guard).
