import { useEffect } from "react";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useToast } from "@/components/ui/toast";
import { usePreferences } from "@/lib/preferences";
import { deriveNotificationsActive } from "@/lib/push-sync";

/**
 * The single "Allow notifications" mechanism, shared by Settings, the
 * onboarding step and the "Finish setting up" card. There is NO local
 * preference: notifications are ON for this device iff OS permission is
 * granted AND the server has this device's push token registered for the
 * signed-in user (`POST /devices/status`). State lives in
 * `use-push-status-store`, so every consumer updates together.
 *
 * Launch-sync rule (`lib/push-sync.ts` `decideLaunchSync`, run by
 * `use-push-registration` on login and foreground resume): it NEVER opts a
 * device in. Registration happens only via the explicit toggle / onboarding
 * (`setEnabled(true)`). On launch it only (a) remembers the token when the
 * server already has it, and (b) handles token rotation: if the server lacks
 * the current token but this install last registered a different one (a
 * non-preference marker in AsyncStorage, cleared on toggle-off and logout), it
 * registers the new token and drops the old. Missing row + no marker, or
 * marker == current token (row removed), is left off.
 */
export function useNotificationToggle() {
  const { prefs, update } = usePreferences();
  const { toast } = useToast();
  const permissionGranted = usePushStatusStore((s) => s.permissionGranted);
  const registered = usePushStatusStore((s) => s.registered);
  const refresh = usePushStatusStore((s) => s.refresh);
  const enable = usePushStatusStore((s) => s.enable);
  const disable = usePushStatusStore((s) => s.disable);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Resolves true when push is registered on this device. */
  const setEnabled = async (on: boolean): Promise<boolean> => {
    if (!on) {
      await disable();
      return false;
    }
    const ok = await enable();
    if (!ok) toast("Couldn't turn on notifications.", "destructive");
    return ok;
  };

  const active = deriveNotificationsActive(permissionGranted, registered);
  return { prefs, update, setEnabled, active, permissionGranted };
}
