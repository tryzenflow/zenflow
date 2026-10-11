import { Image, StyleSheet } from "react-native";

/**
 * Film-grain veil: a small noise tile repeated over the whole screen at low
 * opacity. Breaks up gradient banding and gives the glass something to sit on.
 * Decorative only; never intercepts touches.
 */
export function GrainOverlay({
  dark = false,
  opacity,
}: {
  dark?: boolean;
  opacity?: number;
}) {
  return (
    <Image
      pointerEvents="none"
      source={require("../../assets/images/grain.png")}
      resizeMode="repeat"
      style={[
        StyleSheet.absoluteFill,
        { opacity: opacity ?? (dark ? 0.1 : 0.07) },
      ]}
    />
  );
}
