import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Geometry of the custom tab bar (`components/tab-bar.tsx`), kept here rather
 * than in that component so screens (and their FABs) can position against it
 * without importing the bar itself.
 *
 * The bar is a **floating pill**: absolutely positioned, inset from both side
 * edges and lifted clear of the bottom safe area, drawn over the screens
 * rather than as a flex sibling — so it reserves no layout height and content
 * can scroll underneath it. Screens that must not be covered pad their bottom
 * by `useTabBarOverlayHeight()`.
 */

/** Height of the pill itself (the row the tab buttons live in). */
export const BAR_HEIGHT = 58;
/** Inset from each screen side edge to the pill. */
export const BAR_MARGIN = 16;
/** Gap between the bottom safe-area edge and the bottom of the pill. */
export const BAR_LIFT = 12;
/** Pill corner radius — near-stadium at this height. */
export const BAR_RADIUS = 26;

/**
 * Distance from the very bottom of the screen to the *top* of the floating
 * pill — safe area + lift + the pill itself. What the bar's own container is
 * offset by, and the amount of the screen's bottom edge it visually spans.
 */
export function useTabBarHeight(): number {
  return useSafeAreaInsets().bottom + BAR_LIFT + BAR_HEIGHT;
}

/**
 * How much bottom padding a screen (or a FAB anchored to the bar) needs so
 * its content clears the floating pill: the pill's full occupied height plus
 * one more `BAR_LIFT` of breathing room above it.
 */
export function useTabBarOverlayHeight(): number {
  return useSafeAreaInsets().bottom + BAR_LIFT + BAR_HEIGHT + BAR_LIFT;
}
