# ADR-0006: Mobile offline calendar cache (MMKV, read-only)

**Status:** accepted
**Date:** 2026-10-08
**Issue:** n/a

## Context
The mobile calendar cache (`mobile/lib/session-cache.ts`) was memory-only, so a cold start offline showed an
error state even for days the user had just viewed. Students open the app on weak campus Wi-Fi and need their
schedule to read without a connection.

## Decision
- Persist each fetched day and month to MMKV (`react-native-mmkv`, sync reads) through a write-through layer,
  `mobile/lib/session-disk.ts`, namespaced per user and schema version, capped at 160 entries and 30 days.
  Hydrated entries load as stale: they paint instantly and still revalidate.
- A failed fetch with saved data on screen shows that data and flags offline (`lib/connectivity.ts`, NetInfo plus
  a "stale" flag) instead of the error state; the error state remains only for days with nothing saved.
- Offline is read-only. Mutations still fail fast with the existing save-error path; no offline queue.
- Logout, a 401 and switching accounts wipe the disk cache. Not encrypted (the user's own schedule; credentials
  stay in SecureStore).
- No API, `@zenflow/shared` or backend change.

## Consequences
- Cold start offline renders the last-seen days. Needs a dev-client rebuild (new native modules: MMKV, its
  `react-native-nitro-modules` peer, NetInfo, `expo-blur`).
- A schema change bumps `DISK_VERSION`, which drops old data on next launch.
- Edits made offline are not possible. A mutation queue would conflict with server-side placement and LMS/portal
  sync, so it needs its own design.
- Look and feel of the offline state: [mobile design](../mobile/design.md).
