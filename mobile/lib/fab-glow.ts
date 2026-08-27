import type { ViewStyle } from "react-native";

/**
 * Warm amber cast for the floating "new task" action (`CreateSessionFab`).
 * Hard-coded rather than read from `NAV_THEME` because the button is amber
 * in light *and* dark mode (the primary fill doesn't flip), so the glow
 * shouldn't flip either.
 */
export const FAB_GLOW_COLOR = "rgb(255,142,62)";

/**
 * Wide, soft half of the glow — goes on a wrapper `View` around the button.
 *
 * React Native only gives a view one shadow, and a single one is either
 * tight (reads as a drop shadow) or wide (reads as a smudge). Stacking a
 * wide-and-faint wrapper under a tight-and-strong button produces the
 * two-stop falloff that actually reads as a glow.
 */
export const FAB_GLOW_OUTER: ViewStyle = {
  shadowColor: FAB_GLOW_COLOR,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.4,
  shadowRadius: 20,
  // Android ignores `shadowRadius`/`shadowOpacity` and derives the shadow
  // from `elevation`; it does honour `shadowColor` from API 28 up, so the
  // cast is amber there too (just a single, less controllable falloff).
  elevation: 14,
};

/** Tight, saturated half of the glow — goes on the button itself. */
export const FAB_GLOW_INNER: ViewStyle = {
  shadowColor: FAB_GLOW_COLOR,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.55,
  shadowRadius: 9,
  elevation: 10,
};
