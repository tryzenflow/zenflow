import { updateBasicInfo } from "@/api/users";
import { debugLog } from "@/lib/debug-log";
import { isOffline } from "@/hooks/use-offline";
import { queuePendingPrefs } from "@/lib/pending-prefs";
import { isQueueableFailure } from "@/lib/preferences-sync";
import { useUserStore } from "@/hooks/use-user-store";
import {
  dropPushRegistration,
  readPermission,
  registerThisDevice,
  requestPermission,
} from "@/lib/push";
import { type PushPermission, decidePushAction } from "@/lib/push-sync";
import { createSerialGate } from "@/lib/serial-gate";
import { create } from "zustand";

type State = {
  /** OS notification permission; `null` until first read. */
  permission: PushPermission | null;
};

type Action = {
  /** Re-read OS permission (never prompts). */
  refresh: () => Promise<void>;
  /** Login / launch / foreground rule (see `decidePushAction`). */
  sync: () => Promise<void>;
  /**
   * Explicit enable: prompt, PATCH the preference, register. True only if this
   * device is actually registered; on registration failure the preference
   * stays true (retried by `sync`) but the caller is told it failed.
   */
  enable: () => Promise<boolean>;
  /** Explicit disable: PATCH false and unregister this device. */
  disable: () => Promise<void>;
  /** Logout: unregister this device only; the preference is kept. */
  unregisterOnLogout: () => Promise<void>;
};

/**
 * `enable()` in flight. Taps queued behind a busy JS thread would otherwise run
 * `enable()` several times at once (several `requestPermissionsAsync` calls),
 * and `sync()` must not race an explicit enable's PATCH.
 */
let enabling: Promise<boolean> | null = null;

/** User id we already showed the system prompt for in this login/session. */
let promptedFor: string | null = null;

/**
 * Register/unregister run through one gate: strictly in call order, and any
 * unregister invalidates registrations still waiting, so a late login/foreground
 * registration can't re-add the token after the user turned notifications off.
 */
const pushGate = createSerialGate();

const register = (stillWanted: () => boolean = () => true) =>
  pushGate.run(
    (isCurrent) =>
      stillWanted() ? registerThisDevice(isCurrent) : Promise.resolve(false),
    false,
  );

const unregister = () => {
  pushGate.invalidate();
  return pushGate.run(() => dropPushRegistration(), undefined);
};

/** PATCH the server preference and mirror the response into the user store. */
async function saveAllow(allowNotifications: boolean): Promise<boolean> {
  try {
    useUserStore
      .getState()
      .updateUser(await updateBasicInfo({ allowNotifications }));
    return true;
  } catch (error) {
    if (!isQueueableFailure(error)) return false;
    // Offline: keep the choice and send it once reconnected (`flushPendingPrefs`).
    await queuePendingPrefs({ allowNotifications });
    const user = useUserStore.getState().user;
    if (user)
      useUserStore.getState().updateUser({ ...user, allowNotifications });
    return true;
  }
}

/**
 * Single source for "Allow notifications": the server column
 * (`user.allowNotifications`, in the user store) plus OS permission (here).
 * Settings, the onboarding step and the "Finish setting up" card all go
 * through this store.
 */
export const usePushStatusStore = create<State & Action>((set) => ({
  permission: null,
  refresh: async () => {
    set({ permission: await readPermission() });
  },
  sync: async () => {
    const user = useUserStore.getState().user;
    if (!user) return;
    if (enabling) return;
    let permission = await readPermission();
    set({ permission });
    let action = decidePushAction({
      allowNotifications: user.allowNotifications,
      permission,
      onboarded: user.onboardedAt !== null,
      alreadyPrompted: promptedFor === user.id,
    });
    if (enabling) return;
    if (action === "prompt") {
      promptedFor = user.id;
      permission = await requestPermission();
      set({ permission });
      action = permission === "granted" ? "register" : "disable";
    }
    if (action === "register") {
      // The preference may have been switched off while we awaited the OS.
      await register(
        () => useUserStore.getState().user?.allowNotifications === true,
      );
    } else if (action === "disable") await saveAllow(false);
  },
  enable: () => {
    enabling ??= (async () => {
      const t0 = Date.now();
      debugLog("push", "enable: start");
      try {
        const user = useUserStore.getState().user;
        if (user) promptedFor = user.id; // an explicit ask counts as this login's prompt
        let permission = await readPermission();
        debugLog("push", `enable: read=${permission} +${Date.now() - t0}ms`);
        if (permission !== "granted") permission = await requestPermission();
        debugLog("push", `enable: ask=${permission} +${Date.now() - t0}ms`);
        set({ permission });
        if (permission !== "granted") {
          await saveAllow(false);
          return false;
        }
        if (!(await saveAllow(true))) return false;
        debugLog("push", `enable: saved +${Date.now() - t0}ms`);
        // Offline: the device registers on reconnect (`sync` after the flush).
        if (isOffline()) return true;
        // Keep allowNotifications true on failure (the user's intent): the next
        // launch/foreground sync retries. But don't report success.
        return await register();
      } finally {
        enabling = null;
      }
    })();
    return enabling;
  },
  disable: async () => {
    await saveAllow(false);
    // Offline the server still holds this device; once `allowNotifications:false`
    // syncs it sends nothing.
    if (!isOffline()) await unregister();
  },
  unregisterOnLogout: async () => {
    await unregister();
  },
}));

// Per-login: new prompt allowance + fresh permission read when the user changes.
useUserStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id) {
    promptedFor = null;
    usePushStatusStore.setState({ permission: null });
  }
});
