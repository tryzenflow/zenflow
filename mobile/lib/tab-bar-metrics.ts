import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Geometry of the custom tab bar (`components/tab-bar.tsx`), kept here rather
 * than in that component so screens and the FABs can position against it
 * without importing the bar itself.
 *
 * The bar is rendered **absolutely** over the screens, not as a flex sibling
 * of them — so it reserves no layout height at all and content can run
 * underneath it. Screens that must not be covered pad themselves by
 * `useTabBarOverlayHeight()`, which is only the *opaque* part: the curved
 * headroom above the bar's top line is transparent and is fine to draw under.
 */

/** Height of the row the tab buttons actually live in (above the safe area). */
export const BAR_HEIGHT = 56;
/** How far the cradle dips *below* the bar's top line at its lowest point. */
export const DIP_DEPTH = 26;
/** Half-width of the cradle — wider than the FAB so the curve reads as a
 * valley the button hovers over rather than a collar around it. */
export const DIP_HALF_WIDTH = 52;
/** Corner radius of the bar's outer top corners. */
export const CORNER = 26;

export const FAB_SIZE = 56;
/** Gap between the bottom of the FAB and the lowest point of the cradle. The
 * button floats clear of the curve rather than sitting in it; the cradle
 * reads as the space the button was lifted out of. */
export const FAB_CLEARANCE = 6;
/** Slack above the FAB for its glow and the bar path's outermost stroke. */
export const GLOW_HEADROOM = 6;

/**
 * Transparent headroom above the bar's top line, sized so the FAB clears the
 * cradle. Nothing is laid out in it — it only exists so the SVG, the glow and
 * the FAB stay inside the bar component's own bounds, which matters on
 * Android, where touches outside a parent's bounds never reach the child (the
 * FAB would be almost entirely untappable if it overflowed).
 *
 * Solving `TOP_PAD + DIP_DEPTH - FAB_CLEARANCE - FAB_SIZE = GLOW_HEADROOM`
 * for `TOP_PAD` — i.e. put the FAB's bottom `FAB_CLEARANCE` above the dip's
 * floor, and its top at `GLOW_HEADROOM`.
 */
export const TOP_PAD = GLOW_HEADROOM + FAB_SIZE + FAB_CLEARANCE - DIP_DEPTH;

/** Full height of the absolutely-positioned bar component, including the
 * transparent headroom. */
export function useTabBarHeight(): number {
  return TOP_PAD + BAR_HEIGHT + useSafeAreaInsets().bottom;
}

/**
 * How much of the screen's bottom edge the bar actually paints over — what a
 * screen should pad by so its content isn't hidden. Excludes `TOP_PAD`, which
 * is transparent: padding by the full height would give back the dead block
 * the overlay exists to avoid.
 */
export function useTabBarOverlayHeight(): number {
  return BAR_HEIGHT + useSafeAreaInsets().bottom;
}
