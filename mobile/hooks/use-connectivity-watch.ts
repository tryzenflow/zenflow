import { isOnline, useConnectivity } from "@/lib/connectivity";
import { warmCalendar } from "@/lib/warm-calendar";
import { notifySessionsMutated } from "@/lib/session-cache";
import NetInfo from "@react-native-community/netinfo";
import { useUserStore } from "@/hooks/use-user-store";
import { useEffect } from "react";
import { AppState } from "react-native";

/**
 * Mount once (root layout). Mirrors NetInfo into `useConnectivity` and, on the
 * offline -> online edge, expires every cached day so visible screens
 * revalidate right away instead of waiting for their next focus, and warms
 * the offline cache (see `warm-calendar.ts`).
 */
export function useConnectivityWatch(): void {
  // Fill the offline cache once signed in and whenever the app returns to the
  // foreground (warmCalendar skips fresh entries and does nothing offline).
  const userId = useUserStore((s) => s.user?.id);
  useEffect(() => {
    if (!userId) return;
    void warmCalendar();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void warmCalendar();
    });
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    // `EXPO_PUBLIC_FORCE_OFFLINE=1` starts a dev build offline (cold-start test).
    if (__DEV__ && process.env.EXPO_PUBLIC_FORCE_OFFLINE === "1") {
      useConnectivity.getState().setForcedOffline(true);
    }
    let wasOnline = true;
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      useConnectivity.getState().setOnline(isOnline(state));
    });
    // Watch the effective flag (NetInfo and the dev toggle) so both trigger
    // the same offline -> online refresh.
    const unsubscribeStore = useConnectivity.subscribe((s) => {
      if (s.online && !wasOnline) {
        notifySessionsMutated();
        void warmCalendar();
      }
      wasOnline = s.online;
    });
    return () => {
      unsubscribeNet();
      unsubscribeStore();
    };
  }, []);
}
