import { SpotlightAnchor } from "@/components/checklist/spotlight-anchor";
import { useLanguage } from "@/hooks/use-language";
import { Text } from "@/components/ui/text";
import { FONT_SCALE_CAP, NAV_THEME, withAlpha } from "@/lib/constants";
import {
  BAR_HEIGHT,
  BAR_LIFT,
  BAR_MARGIN,
  BAR_RADIUS,
} from "@/lib/tab-bar-metrics";
import { useColorScheme } from "@/lib/useColorScheme";
// `expo-router` (bumped for SDK 58) vendors its own bottom-tabs
// implementation now and no longer depends on `@react-navigation/bottom-tabs`
// at all (it's gone from node_modules). The package root doesn't re-export
// this type, but `./layouts/Tabs` (what `<Tabs>` itself is defined in, see
// `app/(app)/_layout.tsx`) does.
import type { BottomTabBarProps } from "expo-router/build/layouts/Tabs";
import { cn } from "@/lib/utils";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function AppTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
}: BottomTabBarProps) {
  useLanguage();
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const insets = useSafeAreaInsets();
  const isAndroid = Platform.OS === "android";

  // One mostly-opaque theme surface: labels stay legible over whatever scrolls
  // behind. `expo-blur` is not a dependency (it would need a new dev-client
  // build), so the translucency comes from the card token, not a blur.
  const surface = withAlpha(theme.card, 0.94);

  function renderTab(route: (typeof state.routes)[number], index: number) {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    // Active = accessible orange text/icon on a tonal shape, so selection never
    // relies on colour alone.
    const color = focused ? theme.primaryText : theme.mutedForeground;
    const label = options.title ?? route.name;

    // `expo-router`'s SDK 58 `BottomTabBarProps` dropped the react-navigation
    // `navigation` prop in favor of a plain `emitter` + `navigateToTab(key)`
    // pair -- mirrors the emit/navigate pattern from expo-router's own
    // `BottomTabBar` reference implementation.
    function onPress() {
      const event = emitter.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        Haptics.selectionAsync().catch(() => {});
        navigateToTab(route.key);
      }
    }

    const icon = options.tabBarIcon?.({ focused, color, size: 22 });
    const text = (
      <Text
        style={{ color: isAndroid && focused ? theme.text : color }}
        maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}
        className={cn(
          "text-label",
          focused ? "font-semibold" : "font-medium",
        )}
      >
        {label}
      </Text>
    );

    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLongPress={() =>
          emitter.emit({ type: "tabLongPress", target: route.key })
        }
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        className={cn(
          "min-h-11 flex-1 items-center justify-center",
          // iOS: a capsule behind icon + label. Android: Material's tonal
          // indicator behind the icon only (below).
          isAndroid ? "gap-1" : "m-1 gap-0.5 rounded-[22px]",
          !isAndroid && focused && "bg-primary/[0.18]",
        )}
      >
        {route.name === "month" ? (
          <SpotlightAnchor step="open-month" ignoreFocus />
        ) : null}
        {isAndroid ? (
          <View
            className={cn(
              "h-8 w-16 items-center justify-center rounded-full",
              focused && "bg-primary/[0.18]",
            )}
          >
            {icon}
          </View>
        ) : (
          icon
        )}
        {text}
      </Pressable>
    );
  }

  return (
    // Outer view carries the drop shadow only — it must NOT clip (iOS drops
    // the shadow the moment `overflow: hidden` meets `borderRadius` on the
    // same view), so the rounding + clipping live on the inner view.
    <View
      pointerEvents="box-none"
      accessibilityRole="tablist"
      style={{
        position: "absolute",
        left: BAR_MARGIN,
        right: BAR_MARGIN,
        bottom: insets.bottom + BAR_LIFT,
        height: BAR_HEIGHT,
        borderRadius: BAR_RADIUS,
        shadowColor: "#000",
        shadowOpacity: isDarkColorScheme ? 0.45 : 0.18,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 14,
        backgroundColor: surface,
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: BAR_RADIUS,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.border,
          overflow: "hidden",
        }}
      >
        <View className="flex-1 flex-row items-stretch px-1.5">
          {state.routes.map(renderTab)}
        </View>
      </View>
    </View>
  );
}
