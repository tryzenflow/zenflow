/** Spotlight placement math for the checklist's "show me" (issue #116). RN-free so it can be unit-tested. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Target rect grown by `pad` on every side, clamped to the screen. */
export function spotlightRect(
  target: Rect,
  screen: { width: number; height: number },
  pad = 6,
): Rect {
  const x = Math.max(0, target.x - pad);
  const y = Math.max(0, target.y - pad);
  const right = Math.min(screen.width, target.x + target.width + pad);
  const bottom = Math.min(screen.height, target.y + target.height + pad);
  return { x, y, width: right - x, height: bottom - y };
}

export const BUBBLE_GAP = 10;

/**
 * Where the bubble goes: below the spotlight when it fits above the bottom
 * inset, else above it. Top is clamped inside the top inset.
 */
export function bubblePlacement(
  spot: Rect,
  screen: { width: number; height: number },
  insets: { top: number; bottom: number },
  bubbleHeight: number,
): { top: number; side: "above" | "below" } {
  const below = spot.y + spot.height + BUBBLE_GAP;
  if (below + bubbleHeight <= screen.height - insets.bottom - 8) {
    return { top: below, side: "below" };
  }
  const above = spot.y - BUBBLE_GAP - bubbleHeight;
  return { top: Math.max(insets.top + 8, above), side: "above" };
}

/** Horizontal arrow offset: centre of the spotlight, kept inside the bubble. */
export function arrowLeft(
  spot: Rect,
  bubbleLeft: number,
  bubbleWidth: number,
  arrowSize = 14,
): number {
  const centre = spot.x + spot.width / 2 - bubbleLeft;
  return Math.min(Math.max(centre - arrowSize / 2, 12), bubbleWidth - 12 - arrowSize);
}

/** Whether the whole target is inside the window (a scrolled-off control can't be spotlighted). */
export function isOnScreen(
  rect: Rect,
  screen: { width: number; height: number },
  tolerance = 2,
): boolean {
  return (
    rect.x >= -tolerance &&
    rect.y >= -tolerance &&
    rect.x + rect.width <= screen.width + tolerance &&
    rect.y + rect.height <= screen.height + tolerance
  );
}
