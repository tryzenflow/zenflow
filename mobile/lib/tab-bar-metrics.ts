import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Geometry of the custom tab bar (`components/tab-bar.tsx`), kept here rather
 * than in that component so screens (and their FABs) can position against it
 * without importing the bar itself.
 *
 * The bar is rendered **absolutely** over the screens, not as a flex sibling
 * of them — so it reserves no layout height at all and content can run
 * underneath it. Screens that must not be covered pad themselves by
 * `useTabBarOverlayHeight()`, which is only the *opaque* part: the headroom
 * above the bar's top line (for the glow strokes) is transparent and is fine
 * to draw under.
 */

/** Height of the row the tab buttons actually live in (above the safe area). */
export const BAR_HEIGHT = 56;
/** Corner radius of the bar's outer top corners. */
export const CORNER = 26;
/** Transparent headroom above the bar's top line so the glow strokes (drawn
 * centered on the path) don't get clipped by the component's own bounds —
 * touches outside a view's bounds never reach it on Android, so anything
 * that should render or be tappable there has to fit inside this padding. */
export const GLOW_HEADROOM = 10;

/** Full height of the absolutely-positioned bar component, including the
 * transparent headroom. */
export function useTabBarHeight(): number {
  return GLOW_HEADROOM + BAR_HEIGHT + useSafeAreaInsets().bottom;
}

/**
 * How much of the screen's bottom edge the bar actually paints over — what a
 * screen should pad by so its content isn't hidden. Excludes `GLOW_HEADROOM`,
 * which is transparent: padding by the full height would give back the dead
 * block the overlay exists to avoid.
 */
export function useTabBarOverlayHeight(): number {
  return BAR_HEIGHT + useSafeAreaInsets().bottom;
}
