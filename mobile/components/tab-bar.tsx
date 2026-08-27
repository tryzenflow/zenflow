import { Text } from "@/components/ui/text";
import { NAV_THEME } from "@/lib/constants";
import {
  BAR_HEIGHT,
  BAR_LIFT,
  BAR_MARGIN,
  BAR_RADIUS,
} from "@/lib/tab-bar-metrics";
import { useColorScheme } from "@/lib/useColorScheme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function AppTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const insets = useSafeAreaInsets();

  // Translucent fill over whatever scrolls behind the pill. Dark needs more
  // opacity to stay legible against bright content; light stays airy.
  const tint = isDarkColorScheme
    ? "rgba(29, 26, 23, 0.78)"
    : "rgba(255, 255, 255, 0.72)";
  const borderColor = isDarkColorScheme
    ? "rgba(255, 255, 255, 0.14)"
    : "rgba(255, 255, 255, 0.55)";
  // Top-edge sheen — the glassy highlight. Fades to transparent by ~40% down.
  const sheen: [string, string, string] = isDarkColorScheme
    ? [
        "rgba(255,255,255,0.10)",
        "rgba(255,255,255,0.03)",
        "rgba(255,255,255,0)",
      ]
    : [
        "rgba(255,255,255,0.85)",
        "rgba(255,255,255,0.30)",
        "rgba(255,255,255,0)",
      ];

  function renderTab(route: (typeof state.routes)[number], index: number) {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const color = focused ? theme.primary : theme.mutedForeground;
    const label = options.title ?? route.name;

    function onPress() {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    }

    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLongPress={() =>
          navigation.emit({ type: "tabLongPress", target: route.key })
        }
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        className="flex-1 items-center justify-center gap-1"
      >
        {options.tabBarIcon?.({ focused, color, size: 22 })}
        <Text
          style={{ color }}
          className="text-[11px] font-medium leading-[13px]"
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    // Outer view carries the drop shadow only — it must NOT clip (iOS drops
    // the shadow the moment `overflow: hidden` meets `borderRadius` on the
    // same view), so the rounding + clipping live on the inner view.
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: BAR_MARGIN,
        right: BAR_MARGIN,
        bottom: insets.bottom + BAR_LIFT,
        height: BAR_HEIGHT,
        borderRadius: 9999,
        shadowColor: "#000",
        shadowOpacity: isDarkColorScheme ? 0.45 : 0.18,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 14,
        backgroundColor: "rgba(255, 255, 255, 0.7)",
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: BAR_RADIUS,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor,
          overflow: "hidden",
          backgroundColor: tint,
        }}
      >
        <View className="flex-1 flex-row items-stretch px-1.5">
          {state.routes.map(renderTab)}
        </View>
      </View>
    </View>
  );
}
