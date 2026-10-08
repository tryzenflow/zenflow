import type { Session } from "@zenflow/shared";

/**
 * Disk layer for the calendar cache (offline read-only). Pure logic over a
 * tiny key/value interface so it runs under Vitest; `session-store.ts` backs
 * it with MMKV on device.
 *
 * Entries are namespaced by user id so one account never reads another's
 * calendar, versioned so a shape change drops old data instead of crashing a
 * screen, and capped so the store cannot grow without bound.
 */
export interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  getAllKeys(): string[];
}

export interface DiskEntry {
  sessions: Session[];
  /** When the data was last fetched from the server (epoch ms). */
  savedAt: number;
}

export const DISK_VERSION = 1;
/** Day + month entries kept per user; oldest by `savedAt` go first. */
export const MAX_DISK_ENTRIES = 160;
/** Entries older than this are dropped on hydrate. */
export const MAX_DISK_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const ROOT = "zf.sessions.";

export interface SessionDisk {
  /** Switch to `userId`'s namespace, wipe everyone else's data, return what is stored. */
  load(userId: string | null): Map<string, DiskEntry>;
  save(dayKey: string, sessions: Session[], savedAt: number): void;
  /** Remove the current user's entries (logout / 401). */
  clear(): void;
  /** Remove every entry, whoever's. */
  clearAll(): void;
}

export function createSessionDisk(
  kv: KV,
  now: () => number = Date.now,
): SessionDisk {
  let prefix: string | null = null;
  /** key (without prefix) -> savedAt, for pruning without re-parsing. */
  const index = new Map<string, number>();

  const fullKey = (key: string) => `${prefix}${key}`;

  function clearAll() {
    for (const k of kv.getAllKeys()) if (k.startsWith(ROOT)) kv.remove(k);
    index.clear();
  }

  function prune() {
    if (index.size <= MAX_DISK_ENTRIES) return;
    const oldestFirst = [...index.entries()].sort((a, b) => a[1] - b[1]);
    for (const [key] of oldestFirst.slice(0, index.size - MAX_DISK_ENTRIES)) {
      kv.remove(fullKey(key));
      index.delete(key);
    }
  }

  return {
    load(userId) {
      index.clear();
      const out = new Map<string, DiskEntry>();
      if (!userId) {
        prefix = null;
        clearAll();
        return out;
      }
      prefix = `${ROOT}v${DISK_VERSION}.${userId}.`;
      for (const k of kv.getAllKeys()) {
        if (!k.startsWith(ROOT)) continue;
        if (!k.startsWith(prefix)) {
          kv.remove(k); // another user's, or an older schema version
          continue;
        }
        const key = k.slice(prefix.length);
        try {
          const raw = kv.getString(k);
          const parsed = raw ? (JSON.parse(raw) as DiskEntry) : null;
          if (
            !parsed ||
            !Array.isArray(parsed.sessions) ||
            typeof parsed.savedAt !== "number" ||
            now() - parsed.savedAt > MAX_DISK_AGE_MS
          ) {
            kv.remove(k);
            continue;
          }
          out.set(key, parsed);
          index.set(key, parsed.savedAt);
        } catch {
          kv.remove(k); // corrupt entry
        }
      }
      return out;
    },

    save(dayKey, sessions, savedAt) {
      if (!prefix) return;
      try {
        kv.set(fullKey(dayKey), JSON.stringify({ sessions, savedAt }));
        index.set(dayKey, savedAt);
        prune();
      } catch {
        // Disk full or unavailable: the in-memory cache still works.
      }
    },

    clear() {
      if (!prefix) return;
      for (const key of index.keys()) kv.remove(fullKey(key));
      index.clear();
    },

    clearAll,
  };
}
