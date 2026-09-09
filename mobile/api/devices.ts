import type {
  DevicePlatform,
  RegisterDeviceResponse,
} from "@zenflow/shared";
import { api } from "./base";

/**
 * Register (or refresh) this device for native push. Idempotent on the
 * backend — it upserts on `pushToken`, so calling it on every launch / token
 * refresh is fine. `pushToken` is the raw FCM (Android) / APNs (iOS) token
 * from `expo-notifications`' `getDevicePushTokenAsync()`.
 */
export async function registerDevice(
  platform: DevicePlatform,
  pushToken: string,
): Promise<RegisterDeviceResponse> {
  const { data } = await api.post("/devices", { platform, pushToken });
  return data.data;
}

/** Unregister this device (call on logout). Idempotent; scoped to the caller. */
export async function unregisterDevice(
  pushToken: string,
): Promise<{ pushToken: string }> {
  const { data } = await api.delete("/devices", { data: { pushToken } });
  return data.data;
}
