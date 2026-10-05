import { useToast } from "@/components/ui/toast";
import { usePreferences } from "@/lib/preferences";
import { dropPushRegistration, syncPushRegistration } from "@/lib/push";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * The single "Allow notifications" mechanism: the local preference plus push
 * registration (OS permission + POST /devices). Shared by Settings, the
 * onboarding step and the "Finish setting up" card — there is no server-side
 * notifications preference.
 */
export function useNotificationToggle() {
  const { prefs, update } = usePreferences();
  const { toast } = useToast();
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );

  const refreshPermission = useCallback(async () => {
    if (Platform.OS === "web") {
      setPermissionGranted(false);
      return false;
    }
    try {
      const granted = (await Notifications.getPermissionsAsync()).granted;
      setPermissionGranted(granted);
      return granted;
    } catch {
      setPermissionGranted(false);
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  /** Resolves true when push is registered on this device. */
  const setEnabled = useCallback(
    async (on: boolean): Promise<boolean> => {
      await update({ notificationsEnabled: on });
      if (!on) {
        await dropPushRegistration();
        return false;
      }
      const token = await syncPushRegistration();
      await refreshPermission();
      if (!token) {
        toast("Couldn't enable push on this device.", "destructive");
        return false;
      }
      return true;
    },
    [update, refreshPermission, toast],
  );

  const active = prefs.notificationsEnabled && permissionGranted === true;
  return { prefs, update, setEnabled, active, permissionGranted };
}
