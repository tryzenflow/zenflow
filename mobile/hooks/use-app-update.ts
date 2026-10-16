import { useToast } from "@/components/ui/toast";
import {
  SUPPORTS_SELF_UPDATE,
  checkForUpdate,
  downloadAndInstall,
} from "@/lib/app-update";
import type { AvailableUpdate } from "@/lib/app-update-version";
import { t } from "@/lib/i18n";
import { useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";

/** Re-check at most this often while the app keeps returning to the foreground. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Mount once in the signed-in shell. Looks for a newer release of the app on
 * launch and when it returns to the foreground, and offers it in a toast. Tapping
 * Update downloads the APK and opens Android's installer. Each version is offered
 * once per app run, so dismissing it does not nag.
 */
export function useAppUpdate(): void {
  const { toast } = useToast();
  const lastCheck = useRef(0);
  const offered = useRef<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!SUPPORTS_SELF_UPDATE) return;

    const install = async (update: AvailableUpdate) => {
      if (busy.current) return;
      busy.current = true;
      toast({
        title: t("Downloading update"),
        description: t("Keep Zenflow open."),
        variant: "info",
      });
      try {
        await downloadAndInstall(update);
      } catch {
        toast({
          title: t("Update failed"),
          description: t("Open the download page instead."),
          variant: "error",
          persistent: true,
          action: {
            label: t("Open page"),
            onPress: () => void Linking.openURL(update.pageUrl),
          },
        });
      } finally {
        busy.current = false;
      }
    };

    const check = async () => {
      if (Date.now() - lastCheck.current < CHECK_INTERVAL_MS) return;
      lastCheck.current = Date.now();
      const update = await checkForUpdate();
      if (!update || offered.current === update.version) return;
      offered.current = update.version;
      toast({
        title: t("Update available"),
        description: t("Version {version} is ready.", {
          version: update.version,
        }),
        variant: "info",
        persistent: true,
        action: { label: t("Update"), onPress: () => void install(update) },
      });
    };

    void check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => sub.remove();
    // `toast` is stable for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
