import { CloudOffIcon, SyncedIcon } from "@/components/brand/icons";
import { Glass } from "@/components/ui/glass";
import { type ToastIcon, useToast } from "@/components/ui/toast";
import { useScreenFocusedRef } from "@/hooks/use-screen-focused-ref";
import { selectOffline, useConnectivity } from "@/lib/connectivity";
import { NAV_THEME } from "@/lib/constants";
import { t } from "@/lib/i18n";
import { format } from "@/lib/i18n";
import { getCachedSavedAt } from "@/lib/session-cache";
import { useColorScheme } from "@/lib/useColorScheme";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Pressable, View } from "react-native";

// The toast renders its icon through the lucide contract (`size`); ours are
// plain SVG with a fixed colour, so adapt them.
// Dark navy on light toasts, a lighter blue on dark ones so it stays legible.
const OFFLINE_BLUE = { light: "#1E3A8A", dark: "#93C5FD" };
const OfflineToastIcon = (({ size }: { size?: number }) => {
  const { isDarkColorScheme } = useColorScheme();
  return (
    <CloudOffIcon
      size={size}
      color={isDarkColorScheme ? OFFLINE_BLUE.dark : OFFLINE_BLUE.light}
    />
  );
}) as unknown as ToastIcon;
const SyncedToastIcon = (({ size }: { size?: number }) => (
  <SyncedIcon size={size} color="#10B981" />
)) as unknown as ToastIcon;

// Every screen mounts its own indicator (week, month, settings…), so the
// announcement is tracked here: one "offline" toast per offline spell, one
// "back online" toast when it ends, whichever screen is showing.
let announcedOffline = false;

/**
 * Offline is quiet, not an error: a small cloud-off glyph while the device is
 * offline or showing saved data. Going offline raises a toast saying so (once,
 * not again on another screen); tap the glyph for what and since when; on
 * reconnect it clears with a "Back online" toast saying what was refreshed.
 * Renders nothing while online.
 */
export function OfflineIndicator({ dayKey }: { dayKey: string }) {
  const offline = useConnectivity(selectOffline);
  const { toast } = useToast();
  const { isDarkColorScheme } = useColorScheme();
  // Tab screens stay mounted, so only the visible one may toast (not one per tab).
  const focused = useScreenFocusedRef();

  useEffect(() => {
    if (offline) {
      if (announcedOffline || !focused.current) return;
      announcedOffline = true;
      toast({
        title: t("You're offline"),
        description: t(
          "Showing saved days. Changes can't be saved until you reconnect.",
        ),
        icon: OfflineToastIcon,
        variant: "info",
      });
    } else if (announcedOffline) {
      if (!focused.current) return;
      announcedOffline = false;
      toast({
        title: t("Back online"),
        description: t("Your calendar and tasks are up to date."),
        icon: SyncedToastIcon,
        variant: "success",
      });
    }
  }, [offline, toast, focused]);

  if (!offline) return null;

  const savedAt = getCachedSavedAt(dayKey);
  const color = isDarkColorScheme
    ? NAV_THEME.dark.mutedForeground
    : NAV_THEME.light.mutedForeground;

  return (
    // No entering/exiting layout animation: it runs inside headers that unmount
    // with the whole tab group on logout, and Fabric asserts on that.
    <View>
      <Pressable
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("Offline")}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          toast({
            title: t("Offline"),
            description: savedAt
              ? t("Saved {time}", { time: format(new Date(savedAt), "HH:mm") })
              : t("Showing saved days"),
            icon: OfflineToastIcon,
            variant: "info",
          });
        }}
      >
        <Glass
          radius={18}
          intensity={30}
          style={{
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CloudOffIcon size={20} color={color} />
        </Glass>
      </Pressable>
    </View>
  );
}
