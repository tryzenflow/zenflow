import { OptimizeFab } from "@/components/tasks/optimize-fab";
import { Text } from "@/components/ui/text";
import { useUserStore } from "@/hooks/use-user-store";
import { NAV_THEME } from "@/lib/constants";
import {
  BAR_HEIGHT,
  CORNER,
  DIP_DEPTH,
  DIP_HALF_WIDTH,
  FAB_SIZE,
  GLOW_HEADROOM,
  TOP_PAD,
  useTabBarHeight,
} from "@/lib/tab-bar-metrics";
import { useColorScheme } from "@/lib/useColorScheme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

/**
 * Builds the tab bar silhouette: rounded top corners, flat top edge, and a
 * U-shaped cradle scooped down into the centre that the Optimize FAB rests
 * in.
 *
 * `y = 0` is the very top of the SVG (glow headroom); the bar's top line is
 * at `TOP_PAD` and the bottom of the cradle at `TOP_PAD + DIP_DEPTH`.
 */
function barPath(width: number, height: number): string {
  const top = TOP_PAD;
  const floor = TOP_PAD + DIP_DEPTH;
  const cx = width / 2;
  const hw = DIP_HALF_WIDTH;

  return [
    `M 0 ${height}`,
    `L 0 ${top + CORNER}`,
    `Q 0 ${top} ${CORNER} ${top}`,
    `L ${cx - hw} ${top}`,
    // Two mirrored cubics form the dip. The control points are pulled well
    // past the low point horizontally (0.62·hw) so the curve leaves and
    // rejoins the flat top tangentially instead of kinking at the seam.
    `C ${cx - hw * 0.5} ${top} ${cx - hw * 0.62} ${floor} ${cx} ${floor}`,
    `C ${cx + hw * 0.62} ${floor} ${cx + hw * 0.5} ${top} ${cx + hw} ${top}`,
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
 * straight line across the hump and give the whole thing away. Drawing the
 * glow as strokes keeps it locked to the silhouette and renders identically
 * on iOS, Android and web.
 */
const GLOW_LAYERS = [
  { width: 18, opacity: 0.05 },
  { width: 12, opacity: 0.08 },
  { width: 7, opacity: 0.13 },
  { width: 4, opacity: 0.2 },
];

/**
 * Custom bottom tab bar — replaces React Navigation's default one so the
 * Optimize action can live *in* the bar (centred, cradled in a curve scooped
 * out of the top edge) instead of floating over each calendar screen.
 *
 * Because this is mounted once by `app/(app)/_layout.tsx` rather than per
 * screen, `OptimizeFab` no longer gets an `onApplied` callback wired to the
 * calling screen's refetch — it publishes to `useScheduleRefresh` and the
 * screens subscribe. See `hooks/use-schedule-refresh.ts`.
 *
 * Positioned absolutely so it overlays the screens instead of taking a slice
 * of the column `BottomTabView` lays out (screens are a `flex: 1` sibling, so
 * any height taken here comes straight off them — with the curve's headroom
 * on top of the bar proper that was enough to clip the month grid's last
 * row). Screens that shouldn't be painted over pad by
 * `useTabBarOverlayHeight()`.
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
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";

  const height = useTabBarHeight();
  const d = barPath(width, height);

  // The centre gap the cradle (and the FAB in it) occupies — the two tabs on
  // each side are laid out around it rather than through it.
  const half = Math.ceil(state.routes.length / 2);
  const leftRoutes = state.routes.slice(0, half);
  const rightRoutes = state.routes.slice(half);

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
        style={{ paddingTop: TOP_PAD, paddingBottom: insets.bottom }}
        className="flex-1 flex-row items-stretch"
      >
        <View className="flex-1 flex-row">{leftRoutes.map(renderTab)}</View>
        <View style={{ width: DIP_HALF_WIDTH * 2 }} />
        <View className="flex-1 flex-row">
          {rightRoutes.map((route, i) => renderTab(route, i + half))}
        </View>
      </View>

      {/* Floating clear above the cradle — see `TOP_PAD`, which is derived so
          this lands at exactly `GLOW_HEADROOM`. */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: GLOW_HEADROOM,
          alignItems: "center",
        }}
      >
        <OptimizeFab tz={tz} size={FAB_SIZE} />
      </View>
    </View>
  );
}
