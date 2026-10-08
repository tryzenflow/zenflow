import { SpotlightAnchor } from "@/components/checklist/spotlight-anchor";
import { Glass } from "@/components/ui/glass";
import { resolveGeistFontFamily } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { NAV_THEME } from "@/lib/constants";
import { springTo, useReducedMotion } from "@/lib/motion";
import {
  BAR_HEIGHT,
  BAR_LIFT,
  BAR_MARGIN,
  BAR_RIGHT_MARGIN,
  BAR_RADIUS,
} from "@/lib/tab-bar-metrics";
import { scaleType } from "@/lib/type-scale";
import { useColorScheme } from "@/lib/useColorScheme";
// `expo-router` (bumped for SDK 58) vendors its own bottom-tabs
// implementation now and no longer depends on `@react-navigation/bottom-tabs`
// at all (it's gone from node_modules). The package root doesn't re-export
// this type, but `./layouts/Tabs` (what `<Tabs>` itself is defined in, see
// `app/(app)/_layout.tsx`) does.
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/build/layouts/Tabs";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ROW_PADDING = 0;
const PILL_INSET = 4;

/**
 * One tab. The icon is drawn twice (muted under, primary over) and cross-faded
 * off the shared `position`, so colour follows the sliding pill instead of
 * snapping when focus changes.
 */
function TabItem({
  index,
  position,
  label,
  mutedColor,
  activeColor,
  renderIcon,
  focused,
  onPress,
  onLongPress,
  accessibilityLabel,
  testID,
  spotlight,
}: {
  index: number;
  position: SharedValue<number>;
  label: string;
  mutedColor: string;
  activeColor: string;
  renderIcon: (focused: boolean, color: string) => React.ReactNode;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  spotlight: boolean;
}) {
  const activeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      position.value,
      [index - 1, index, index + 1],
      [0, 1, 0],
      "clamp",
    ),
  }));
  const lift = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(
          position.value,
          [index - 1, index, index + 1],
          [1, 1.07, 1],
          "clamp",
        ),
      },
    ],
  }));
  const labelColor = useAnimatedStyle(() => ({
    color: interpolateColor(
      Math.min(1, Math.max(0, 1 - Math.abs(position.value - index))),
      [0, 1],
      [mutedColor, activeColor],
    ),
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      className="flex-1 items-center justify-center gap-1"
    >
      {spotlight ? <SpotlightAnchor step="open-month" ignoreFocus /> : null}
      <Animated.View collapsable={false} style={lift}>
        {renderIcon(false, mutedColor)}
        <Animated.View
          collapsable={false}
          pointerEvents="none"
          style={[{ position: "absolute", top: 0, left: 0 }, activeOpacity]}
        >
          {renderIcon(true, activeColor)}
        </Animated.View>
      </Animated.View>
      <Animated.Text
        style={[
          // Native has no synthetic weights: Geist-Medium is its own family.
          {
            fontFamily: resolveGeistFontFamily("font-medium"),
            ...scaleType("text-[11px] leading-[13px]"),
          },
          labelColor,
        ]}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}

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
  const reduceMotion = useReducedMotion();

  const count = state.routes.length;
  // Row width lives on the UI thread: the bar's width animates when the create
  // button comes and goes (it is hidden on Settings), and the pill must follow.
  const rowWidth = useSharedValue(0);
  const onSettings = state.routes[state.index]?.name === "settings";
  const fabRoom = useSharedValue(onSettings ? 0 : 1);
  useEffect(() => {
    fabRoom.value = springTo(onSettings ? 0 : 1, reduceMotion);
  }, [onSettings, reduceMotion, fabRoom]);
  const barStyle = useAnimatedStyle(() => ({
    right: BAR_MARGIN + fabRoom.value * (BAR_RIGHT_MARGIN - BAR_MARGIN),
  }));

  // Fractional tab index the pill and every tab's styling derive from. It
  // springs toward the focused tab, so a mid-flight tap retargets smoothly.
  const position = useSharedValue(state.index);
  useEffect(() => {
    position.value = springTo(state.index, reduceMotion);
  }, [state.index, reduceMotion, position]);

  const pillStyle = useAnimatedStyle(() => {
    const slot = rowWidth.value > 0 ? (rowWidth.value - ROW_PADDING * 2) / count : 0;
    return {
      opacity: slot > 0 ? 1 : 0,
      width: Math.max(0, slot - PILL_INSET * 2),
      transform: [
        { translateX: ROW_PADDING + PILL_INSET + position.value * slot },
      ],
    };
  });

  const pillFill = isDarkColorScheme
    ? "rgba(255, 122, 36, 0.20)"
    : "rgba(255, 142, 62, 0.15)";
  const pillEdge = isDarkColorScheme
    ? "rgba(255, 150, 80, 0.32)"
    : "rgba(255, 142, 62, 0.28)";

  function renderTab(route: (typeof state.routes)[number], index: number) {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
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

    return (
      <TabItem
        key={route.key}
        index={index}
        position={position}
        label={label}
        mutedColor={theme.mutedForeground}
        activeColor={theme.primary}
        renderIcon={(isActive, color) =>
          options.tabBarIcon?.({ focused: isActive, color, size: 20 })
        }
        focused={focused}
        onPress={onPress}
        onLongPress={() =>
          emitter.emit({ type: "tabLongPress", target: route.key })
        }
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        testID={`tab.${route.name}`}
        spotlight={route.name === "month"}
      />
    );
  }

  return (
    // Outer view carries the drop shadow only — it must NOT clip (iOS drops
    // the shadow the moment `overflow: hidden` meets `borderRadius` on the
    // same view), so the rounding + clipping live in `Glass`.
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: "absolute",
          left: BAR_MARGIN,
          bottom: insets.bottom + BAR_LIFT,
          height: BAR_HEIGHT,
          borderRadius: BAR_RADIUS,
          shadowColor: isDarkColorScheme ? "#000" : "#7a4a1d",
          shadowOpacity: isDarkColorScheme ? 0.4 : 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        },
        barStyle,
      ]}
    >
      <Glass radius={BAR_RADIUS} clear style={{ flex: 1 }}>
        <View
          className="flex-1 flex-row items-stretch"
          style={{ paddingHorizontal: ROW_PADDING }}
          onLayout={(e) => {
            rowWidth.value = e.nativeEvent.layout.width;
          }}
        >
          {/* Always mounted (width 0 until measured): inserting it later shifts
              the tabs' child indices and Fabric asserts on unmount. */}
          <Animated.View
              collapsable={false}
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  top: PILL_INSET,
                  bottom: PILL_INSET,
                  left: 0,
                  borderRadius: BAR_RADIUS - PILL_INSET,
                  backgroundColor: pillFill,
                  borderWidth: 1,
                  borderColor: pillEdge,
                },
                pillStyle,
              ]}
            />
          {state.routes.map(renderTab)}
        </View>
      </Glass>
    </Animated.View>
  );
}
