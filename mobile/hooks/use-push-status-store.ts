import { create } from "zustand";
import { useUserStore } from "@/hooks/use-user-store";
import {
  dropPushRegistration,
  enablePushRegistration,
  fetchRegistered,
  readPushState,
  syncPushRegistration,
} from "@/lib/push";

type State = {
  /** OS notification permission; `null` until first read. */
  permissionGranted: boolean | null;
  /** Server has this device's token for the signed-in user; `null` unknown. */
  registered: boolean | null;
};

type Action = {
  /** Re-read permission + server status. */
  refresh: () => Promise<void>;
  /** Launch/foreground sync (token rotation only), then refresh. */
  sync: () => Promise<void>;
  /** Explicit enable: prompt + register. Resolves true on success. */
  enable: () => Promise<boolean>;
  /** Explicit disable: unregister this device. */
  disable: () => Promise<void>;
};

let version = 0;

/**
 * Shared "Allow notifications" state so Settings, the onboarding step and the
 * "Finish setting up" card update together.
 */
export const usePushStatusStore = create<State & Action>((set, get) => ({
  permissionGranted: null,
  registered: null,
  refresh: async () => {
    const v = ++version;
    const { permissionGranted, token } = await readPushState();
    const registered = token ? await fetchRegistered(token) : false;
    if (v !== version) return; // a newer refresh/toggle won
    set({
      permissionGranted,
      // Keep the last known value if the status call failed (offline).
      registered: registered ?? get().registered ?? false,
    });
  },
  sync: async () => {
    await syncPushRegistration();
    await get().refresh();
  },
  enable: async () => {
    ++version;
    const token = await enablePushRegistration();
    const { permissionGranted } = await readPushState();
    set({ permissionGranted, registered: token !== null });
    return token !== null;
  },
  disable: async () => {
    ++version;
    await dropPushRegistration();
    set({ registered: false });
  },
}));

// Per-user: reset when the signed-in user changes.
useUserStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id) {
    version++;
    usePushStatusStore.setState({ permissionGranted: null, registered: null });
  }
});
