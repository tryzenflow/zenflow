import { Animated, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { computePagePosition } from "@/lib/week-pager-math";

/** Edges the WeekHeader peeks at, mapped to the adjacent-day advance. */
export type DragEdge = "left" | "right";

export interface PagerPageProps {
  index: number;
  width: number;
  /** Strip offset in px (rest: `-width` — the focused page is always the
   * middle of the 3-page window). */
  progress: SharedValue<number>;
  /** Page the strip is being dragged/settled away FROM (the outgoing,
   * parallaxing, dimming one). */
  fromSV: SharedValue<number>;
  /** Page the strip is settling ON (the incoming, stacking one). During a
   * live drag this equals `fromSV` and the incoming is derived from the
   * drag direction instead. */
  toSV: SharedValue<number>;
  /** 1 while the finger is dragging (parallax held at `PARALLAX_FACTOR`),
   * 0 during settle animations (parallax eases back to 1× so pages land
   * exactly on their slots). */
  draggingSV: SharedValue<number>;
  /** Index of the page that holds the currently-lifted task block, or −1 if
   * no task drag is active. The carried page's slot is overridden so the
   * strip snap keeps it pinned to the finger. */
  carrierIndexSV: SharedValue<number>;
  /** The carried page's `index * width + progress` at drag start — the page
   * is held at this screen position for the entire drag gesture. */
  carrierOriginSV: SharedValue<number>;
  borderColor: string;
  children: React.ReactNode;
}

/**
 * One absolutely-positioned day page in the stack. Its true position is
 * always `slot + progress`; the outgoing page additionally gets a parallax
 * offset (and the incoming one stack chrome), per
 * mockups/week-view.html's swipe-transition frame:
 * - the outgoing page moves at `PARALLAX_FACTOR`× finger speed and dims to
 *   `OUTGOING_DIM_OPACITY` as the neighbor stacks over it;
 * - the incoming page slides 1:1 at a higher z-index with a
 *   `border-l`/`border-r` seam and a soft shadow, popping over the outgoing
 *   page like a card;
 * - everything beyond the outgoing/incoming pair fades out (still mounted —
 *   the page holding a lifted task block must never unmount mid cross-day
 *   drag).
 */
export function PagerPage({
  index,
  width,
  progress,
  fromSV,
  toSV,
  draggingSV,
  carrierIndexSV,
  carrierOriginSV,
  borderColor,
  children,
}: PagerPageProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const pos = computePagePosition({
      index,
      width,
      progress: progress.value,
      outIndex: fromSV.value,
      toIndex: toSV.value,
      dragging: draggingSV.value ? 1 : 0,
      carrierIndex: carrierIndexSV.value,
      carrierOrigin: carrierOriginSV.value,
    });

    const seamStyle =
      pos.seam === "left"
        ? { borderLeftWidth: 1, borderLeftColor: borderColor }
        : pos.seam === "right"
          ? { borderRightWidth: 1, borderRightColor: borderColor }
          : {};

    return {
      transform: [{ translateX: pos.translateX }],
      opacity: pos.opacity,
      zIndex: pos.zIndex,
      ...seamStyle,
    };
  });

  return (
    <Animated.View
      style={[
        { position: "absolute", left: 0, top: 0, bottom: 0, width },
        animatedStyle,
      ]}
      collapsable={false}
    >
      {children}
    </Animated.View>
  );
}