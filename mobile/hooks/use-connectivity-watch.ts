import { isOnline, useConnectivity } from "@/lib/connectivity";
import { notifySessionsMutated } from "@/lib/session-cache";
import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";

/**
 * Mount once (root layout). Mirrors NetInfo into `useConnectivity` and, on the
 * offline -> online edge, expires every cached day so visible screens
 * revalidate right away instead of waiting for their next focus.
 */
export function useConnectivityWatch(): void {
  useEffect(() => {
    let wasOnline = true;
    return NetInfo.addEventListener((state) => {
      const online = isOnline(state);
      useConnectivity.getState().setOnline(online);
      if (online && !wasOnline) notifySessionsMutated();
      wasOnline = online;
    });
  }, []);
}
