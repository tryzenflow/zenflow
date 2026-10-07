import { t } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useUserStore } from "@/hooks/use-user-store";
import { usePreferences } from "@/lib/preferences";
import { deriveNotificationsActive } from "@/lib/push-sync";
import { useEffect } from "react";
import { Linking } from "react-native";

/**
 * The single "Allow notifications" mechanism, shared by Settings, the
 * onboarding step and the "Finish setting up" card. The user's intent is the
 * server column `user.allowNotifications` (user store, updated from PATCH
 * responses); notifications are ON iff that is true AND OS permission is
 * granted. `use-push-status-store` holds the OS permission, so all consumers
 * update together.
 *
 * Rules (`lib/push-sync.ts` `decidePushAction`, run by `use-push-registration`):
 *  - Toggle on: ask the OS; granted -> allowNotifications:true + register
 *    device; denied -> allowNotifications:false + blocked/open-settings hint.
 *    Granted but device registration fails (no token / network) -> the toggle
 *    reports failure (error toast, onboarding doesn't advance as "on") yet
 *    allowNotifications stays true, so the next launch/foreground retries.
 *    Toggle off: allowNotifications:false + unregister this device. Register
 *    and unregister are serialized; an unregister cancels pending registers.
 *  - Onboarding (onboardedAt null): never prompt on login; the Notifications
 *    step is the only place that asks.
 *  - After login, if allowNotifications is true: permission granted -> silently
 *    register (also on launch/foreground); otherwise prompt ONCE per login,
 *    granted -> register, denied/blocked -> allowNotifications:false.
 *  - allowNotifications false -> never register.
 *  - Logout unregisters the device but keeps allowNotifications, so the next
 *    login prompts again.
 */
export function useNotificationToggle() {
  const { prefs, update } = usePreferences();
  const { toast } = useToast();
  const allow = useUserStore((s) => s.user?.allowNotifications);
  const permission = usePushStatusStore((s) => s.permission);
  const refresh = usePushStatusStore((s) => s.refresh);
  const enable = usePushStatusStore((s) => s.enable);
  const disable = usePushStatusStore((s) => s.disable);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Resolves true when push is on for this device. `quiet` skips the failure
   * toast for callers (onboarding) that render their own blocked state.
   */
  const setEnabled = async (
    on: boolean,
    { quiet = false }: { quiet?: boolean } = {},
  ): Promise<boolean> => {
    if (!on) {
      await disable();
      return false;
    }
    const ok = await enable();
    if (!ok && !quiet) {
      const blocked = usePushStatusStore.getState().permission !== "granted";
      toast({
        title: blocked
          ? t("Notifications are blocked")
          : t("Couldn't turn on notifications"),
        description: blocked
          ? t("Allow them in system settings.")
          : t("Try again in a moment."),
        variant: "destructive",
        duration: 6000,
        action: blocked
          ? {
              label: t("Open settings"),
              onPress: () => void Linking.openSettings(),
            }
          : undefined,
      });
    }
    return ok;
  };

  const active = deriveNotificationsActive(allow, permission);
  return {
    prefs,
    update,
    setEnabled,
    active,
    permissionGranted: permission === "granted",
    /** OS permission has been read (gates UI that depends on `active`). */
    ready: permission !== null,
  };
}
