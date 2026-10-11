import { useOffline } from "@/hooks/use-offline";
import type { ReactNode } from "react";
import { View } from "react-native";

/**
 * Greys out and blocks touches on controls that need the API while the device
 * is offline. Content stays visible so people still see what is set.
 */
export function OfflineLock({ children }: { children: ReactNode }) {
  const offline = useOffline();
  return (
    <View
      accessibilityState={{ disabled: offline }}
      style={offline ? { opacity: 0.45, pointerEvents: "none" } : undefined}
    >
      {children}
    </View>
  );
}
