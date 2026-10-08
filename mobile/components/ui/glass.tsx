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
  style,
  children,
}: {
  radius: number;
  intensity?: number;
  /** More transparent, for floating chrome over content (tab bar, pills, toasts). */
  clear?: boolean;
  style?: ComponentProps<typeof View>["style"];
  children?: ReactNode;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const blurred = Platform.OS === "ios";

  const tint = isDarkColorScheme
    ? blurred
      ? clear
        ? "rgba(36, 28, 22, 0.5)"
        : "rgba(36, 28, 22, 0.55)"
      : "rgba(32, 27, 23, 0.88)"
    : blurred
      ? clear
        ? "rgba(255, 252, 248, 0.38)"
        : "rgba(255, 255, 255, 0.68)"
      : "rgba(255, 251, 246, 0.92)";
  const edge = isDarkColorScheme
    ? "rgba(255, 190, 130, 0.16)"
    : "rgba(255, 150, 70, 0.34)";
  const sheen: [string, string] = isDarkColorScheme
    ? ["rgba(255, 170, 100, 0.10)", "rgba(255, 170, 100, 0)"]
    : ["rgba(255, 255, 255, 0.85)", "rgba(255, 255, 255, 0)"];

  return (
    <View
      style={[
        {
          borderRadius: radius,
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: edge,
          backgroundColor: tint,
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
