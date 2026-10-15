import { useColorScheme } from "@/lib/useColorScheme";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps, ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";

/**
 * Sunrise Flow glass: warm light through frosted air. Real blur on iOS; other
 * platforms get the same warm tint at a higher opacity so contrast holds
 * without a blur. Only for floating chrome, never content (design.md).
 *
 * Clips its children to `radius`; put drop shadows on a parent so they survive
 * `overflow: hidden`.
 */
export function Glass({
  radius,
  intensity = 45,
  clear = false,
  frosted = false,
  style,
  children,
}: {
  radius: number;
  intensity?: number;
  /** More transparent, for floating chrome over content (tab bar, pills, toasts). */
  clear?: boolean;
  /** Glassmorphism over a backdrop: very see-through on every platform (blur on
   * iOS and web, a light tint elsewhere) so the colours behind show through. */
  frosted?: boolean;
  style?: ComponentProps<typeof View>["style"];
  children?: ReactNode;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const blurred = Platform.OS === "ios";

  const tint = frosted
    ? isDarkColorScheme
      ? "rgba(31, 48, 58, 0.26)"
      : "rgba(251, 245, 236, 0.18)"
    : isDarkColorScheme
    ? blurred
      ? clear
        ? "rgba(31, 48, 58, 0.5)"
        : "rgba(31, 48, 58, 0.55)"
      : "rgba(26, 28, 40, 0.88)"
    : blurred
      ? clear
        ? "rgba(251, 245, 236, 0.38)"
        : "rgba(255, 255, 255, 0.68)"
      : "rgba(251, 245, 236, 0.92)";
  const edge = isDarkColorScheme
    ? "rgba(141, 179, 206, 0.2)"
    : "rgba(70, 114, 143, 0.28)";
  const sheen: [string, string] = isDarkColorScheme
    ? ["rgba(159, 180, 190, 0.10)", "rgba(159, 180, 190, 0)"]
    : [
        frosted ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.85)",
        "rgba(255, 255, 255, 0)",
      ];

  return (
    <View
      style={[
        {
          borderRadius: radius,
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: edge,
          backgroundColor: tint,
          // `backdrop-filter` is web-only; native uses `BlurView` below.
          ...(frosted && Platform.OS === "web"
            ? ({
                backdropFilter: "blur(22px) saturate(1.4)",
                WebkitBackdropFilter: "blur(22px) saturate(1.4)",
              } as object)
            : null),
        },
        style,
      ]}
    >
      {blurred ? (
        <BlurView
          intensity={intensity}
          tint={isDarkColorScheme ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: tint }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={sheen}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}
