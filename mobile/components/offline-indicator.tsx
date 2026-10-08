import { DuskIcon, SyncedIcon } from "@/components/brand/icons";
import { Glass } from "@/components/ui/glass";
import { type ToastIcon, useToast } from "@/components/ui/toast";
import { selectOffline, useConnectivity } from "@/lib/connectivity";
import { NAV_THEME } from "@/lib/constants";
import { t } from "@/lib/i18n";
import { format } from "@/lib/i18n";
import { getCachedSavedAt } from "@/lib/session-cache";
import { useColorScheme } from "@/lib/useColorScheme";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Pressable, View } from "react-native";

// The toast renders its icon through the lucide contract (`size`); ours are
// plain SVG with a fixed colour, so adapt them.
const OfflineToastIcon = (({ size }: { size?: number }) => (
  <DuskIcon size={size} color="#F0B101" />
)) as unknown as ToastIcon;
const SyncedToastIcon = (({ size }: { size?: number }) => (
  <SyncedIcon size={size} color="#10B981" />
)) as unknown as ToastIcon;

/**
 * Offline is dusk, not an error: a small sun-under-horizon glyph while the
 * device is offline or showing saved data. Tap for two short lines (what and
 * since when); on reconnect it clears with a one-line "Synced". Renders
 * nothing while online.
 */
export function OfflineIndicator({ dayKey }: { dayKey: string }) {
  const offline = useConnectivity(selectOffline);
  const { toast } = useToast();
  const { isDarkColorScheme } = useColorScheme();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (offline) {
      wasOffline.current = true;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      toast({ title: t("Synced"), icon: SyncedToastIcon, variant: "success" });
    }
  }, [offline, toast]);

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
          <DuskIcon size={20} color={color} />
        </Glass>
      </Pressable>
    </View>
  );
}
