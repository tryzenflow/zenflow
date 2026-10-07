import { useLanguage } from "@/hooks/use-language";
import Animated from "react-native-reanimated";
import { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { computePagePosition } from "@/lib/week-pager-math";

/** Edges the WeekHeader peeks at, mapped to the adjacent-day advance. */
export type DragEdge = "left" | "right";

/** The pager's live window as the UI thread sees it: each page's `dateKey`
 * by slot, and the matching day's timestamp. One shared value, so a settle's
 * re-centre (new window + `progress` back to rest) lands in a single frame. */
export interface PagerWindow {
  keys: string[];
  ts: number[];
}

export interface PagerPageProps {
  /** This page's `dateKey`; its slot is its position in `windowSV.keys`. */
  dayKey: string;
  windowSV: SharedValue<PagerWindow>;
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
  /** The WeekHeader strip's own offset (rest `-width`). Non-rest ⇒ the header
   * is driving a week swipe/slide, and the pages drop the day-swipe parallax
   * to track the finger 1:1 in lockstep with the header block. */
  headerStripSV: SharedValue<number>;
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
  dayKey,
  windowSV,
  width,
  progress,
  fromSV,
  toSV,
  draggingSV,
  carrierIndexSV,
  carrierOriginSV,
  headerStripSV,
  borderColor,
  children,
}: PagerPageProps) {
  useLanguage();
  const animatedStyle = useAnimatedStyle(() => {
    // Slot from the shared window, not a React prop: a prop only changes on
    // the next commit, a frame or more after the settle reset `progress`,
    // and in that gap the landed page jumped off-screen while the freshly
    // mounted neighbour flashed in its place. A page that has left the
    // window (about to unmount) is parked out of sight.
    const index = windowSV.value.keys.indexOf(dayKey);
    if (index < 0) {
      return {
        transform: [{ translateX: -10 * width }],
        opacity: 0,
        zIndex: 0,
      };
    }
    const pos = computePagePosition({
      index,
      width,
      progress: progress.value,
      outIndex: fromSV.value,
      toIndex: toSV.value,
      dragging: draggingSV.value ? 1 : 0,
      carrierIndex: carrierIndexSV.value,
      carrierOrigin: carrierOriginSV.value,
      // Header strip off its rest (`-width`) ⇒ the header is running a week
      // swipe/slide; the pages track it 1:1 instead of parallaxing.
      headerDrag: Math.abs(headerStripSV.value + width) > 1 ? 1 : 0,
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
