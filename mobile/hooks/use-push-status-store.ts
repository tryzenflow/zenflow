import { updateBasicInfo } from "@/api/users";
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
  } catch {
    return false;
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
    let permission = await readPermission();
    set({ permission });
    let action = decidePushAction({
      allowNotifications: user.allowNotifications,
      permission,
      onboarded: user.onboardedAt !== null,
      alreadyPrompted: promptedFor === user.id,
    });
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
  enable: async () => {
    const user = useUserStore.getState().user;
    if (user) promptedFor = user.id; // an explicit ask counts as this login's prompt
    let permission = await readPermission();
    if (permission !== "granted") permission = await requestPermission();
    set({ permission });
    if (permission !== "granted") {
      await saveAllow(false);
      return false;
    }
    if (!(await saveAllow(true))) return false;
    // Keep allowNotifications true on failure (the user's intent): the next
    // launch/foreground sync retries. But don't report success.
    return register();
  },
  disable: async () => {
    await saveAllow(false);
    await unregister();
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
