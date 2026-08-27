import { Text } from "@/components/ui/text";
import { NAV_THEME } from "@/lib/constants";
import { CORNER, GLOW_HEADROOM, useTabBarHeight } from "@/lib/tab-bar-metrics";
import { useColorScheme } from "@/lib/useColorScheme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

/**
 * Builds the tab bar silhouette: rounded top corners, flat top edge.
 *
 * `y = 0` is the very top of the SVG (glow headroom); the bar's top line is
 * at `GLOW_HEADROOM`.
 */
function barPath(width: number, height: number): string {
  const top = GLOW_HEADROOM;

  return [
    `M 0 ${height}`,
    `L 0 ${top + CORNER}`,
    `Q 0 ${top} ${CORNER} ${top}`,
    `L ${width - CORNER} ${top}`,
    `Q ${width} ${top} ${width} ${top + CORNER}`,
    `L ${width} ${height}`,
    "Z",
  ].join(" ");
}

/**
 * Stacked strokes of the same path, widest/faintest first, standing in for a
 * blur. React Native's `shadow*`/`elevation` props follow the *view's*
 * rectangle, not an SVG path — so a real drop shadow here would trace a
 * straight line across the rounded top corners and give the whole thing
 * away. Drawing the glow as strokes keeps it locked to the silhouette and
 * renders identically on iOS, Android and web.
 */
const GLOW_LAYERS = [
  { width: 18, opacity: 0.05 },
  { width: 12, opacity: 0.08 },
  { width: 7, opacity: 0.13 },
  { width: 4, opacity: 0.2 },
];

/**
 * Custom bottom tab bar — a hand-drawn silhouette (rounded top corners, amber
 * glow) instead of React Navigation's default rectangular one, which read as
 * almost nothing against the near-white background.
 *
 * This used to have a U-shaped cradle scooped into its top edge to hold an
 * "Optimize schedule" FAB; that action's backend (the EDF auto-placement
 * scheduler) was removed, so the cradle went with it — task creation already
 * has its own entry point (`components/tasks/create-task-fab.tsx`, rendered
 * per screen on Day/Week/Month) that didn't need to move here. A later,
 * minimal explicit Optimize (`POST /scheduler/optimize`, a small header pill
 * on Day View) has since been removed too — session create/edit now
 * implicitly and silently repacks that one day server-side instead (see
 * `mobile/README.md`'s Screens & routing section). There's no manual trigger
 * anywhere now, and the cradle is not coming back.
 *
 * Positioned absolutely so it overlays the screens instead of taking a slice
 * of the column `BottomTabView` lays out (screens are a `flex: 1` sibling, so
 * any height taken here comes straight off them). Screens that shouldn't be
 * painted over pad by `useTabBarOverlayHeight()`.
 */
export function AppTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const height = useTabBarHeight();
  const d = barPath(width, height);

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
        className="flex-1 items-center justify-center gap-1 pt-1.5"
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
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height,
        backgroundColor: "transparent",
      }}
    >
      <Svg
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0 }}
        pointerEvents="none"
      >
        {GLOW_LAYERS.map((layer) => (
          <Path
            key={layer.width}
            d={d}
            fill="none"
            stroke={theme.primary}
            strokeOpacity={layer.opacity}
            strokeWidth={layer.width}
          />
        ))}
        <Path
          d={d}
          fill={theme.card}
          stroke={theme.primary}
          strokeOpacity={isDarkColorScheme ? 0.55 : 0.42}
          strokeWidth={1.25}
        />
      </Svg>

      <View
        style={{ paddingTop: GLOW_HEADROOM, paddingBottom: insets.bottom }}
        className="flex-1 flex-row items-stretch"
      >
        {state.routes.map(renderTab)}
      </View>
    </View>
  );
}
