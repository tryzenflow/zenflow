import { BRAND_GRADIENT } from "@/lib/brand-gradient";
import { useColorScheme } from "@/lib/useColorScheme";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";

/** Fills its parent with the brand gradient; the parent clips the corners. */
export function GradientFill() {
  const { isDarkColorScheme } = useColorScheme();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={
        (isDarkColorScheme ? BRAND_GRADIENT.dark : BRAND_GRADIENT.light) as unknown as [
          string,
          string,
          string,
        ]
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[StyleSheet.absoluteFill, { borderRadius: 999 }]}
    />
  );
}
