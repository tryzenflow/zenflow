import { useConnectivity } from "@/lib/connectivity";

/** The device has no connection: hide or disable anything that needs the API. */
export function useOffline(): boolean {
  return useConnectivity((s) => !s.online);
}

/** Non-hook form for handlers and gesture callbacks. */
export function isOffline(): boolean {
  return !useConnectivity.getState().online;
}
