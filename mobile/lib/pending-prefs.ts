import { updateBasicInfo } from "@/api/users";
import { useUserStore } from "@/hooks/use-user-store";
import {
  type PendingPrefs,
  isQueueableFailure,
  mergePending,
  parsePending,
} from "@/lib/preferences-sync";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Settings changed while offline (language, timezone, reminder, notifications).
 * They apply on this device right away and wait here, per user, until the
 * connection is back; `flushPendingPrefs` then sends them in one PATCH.
 */
const key = (userId: string) => `prefs.pending.v1.${userId}`;

export async function loadPendingPrefs(userId: string): Promise<PendingPrefs> {
  try {
    return parsePending(await AsyncStorage.getItem(key(userId)));
  } catch {
    return {};
  }
}

async function writePending(userId: string, pending: PendingPrefs) {
  try {
    if (Object.keys(pending).length === 0)
      await AsyncStorage.removeItem(key(userId));
    else await AsyncStorage.setItem(key(userId), JSON.stringify(pending));
  } catch {
    // Best effort: the change still applies on screen this session.
  }
}

// Writes are chained so two quick edits can't read the same stored value.
let chain: Promise<unknown> = Promise.resolve();

/** Remember an edit for the next sync (later edits to a field replace earlier ones). */
export function queuePendingPrefs(patch: PendingPrefs): Promise<void> {
  const userId = useUserStore.getState().user?.id;
  if (!userId) return Promise.resolve();
  const run = async () => {
    await writePending(
      userId,
      mergePending(await loadPendingPrefs(userId), patch),
    );
  };
  chain = chain.then(run, run);
  return chain as Promise<void>;
}

/** Send whatever is waiting. Keeps it queued if the server is still unreachable. */
export function flushPendingPrefs(): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const userId = useUserStore.getState().user?.id;
    if (!userId) return false;
    const pending = await loadPendingPrefs(userId);
    if (Object.keys(pending).length === 0) return false;
    try {
      const updated = await updateBasicInfo(pending);
      // Fields edited again while this was in flight stay queued.
      const now = await loadPendingPrefs(userId);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(now)) {
        if ((pending as Record<string, unknown>)[k] !== v) rest[k] = v;
      }
      await writePending(userId, rest as PendingPrefs);
      useUserStore.getState().updateUser({ ...updated, ...rest });
      return true;
    } catch (error) {
      // A rejected value (4xx) would fail forever: drop it. Network trouble stays queued.
      if (!isQueueableFailure(error)) await writePending(userId, {});
      return false;
    }
  };
  chain = chain.then(run, run);
  return chain as Promise<boolean>;
}
