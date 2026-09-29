import { addMonths } from "@/lib/month-date-math";
import { differenceInCalendarMonths } from "date-fns";
import { useEffect, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  type ScrollViewInstance,
  View,
  useWindowDimensions,
} from "react-native";

/** Months reachable either side of the month the pager mounted on. */
const RANGE = 240;
const PAGE_COUNT = RANGE * 2 + 1;

interface MonthPagerProps {
  /** The month currently shown in the header — the pager stays in sync with
   * it in both directions: swiping updates it (via `onMonthChange`), and an
   * external change (chevron tap) scrolls the pager to it. */
  monthDate: Date;
  onMonthChange: (monthDate: Date) => void;
  /** Fired the instant a swipe carries a new month past the halfway point —
   * *during* the drag, not when momentum settles. Drives the header label
   * only, so the title tracks the finger instead of waiting for the scroll to
   * end (and, before this, for that page's fetch to resolve). */
  onVisibleMonthChange: (monthDate: Date) => void;
  /** Frozen while a task pill is being dragged, so the horizontal
   * swipe-to-next-month scroll can't steal the gesture mid-drag. */
  scrollEnabled?: boolean;
  renderPage: (pageMonthDate: Date) => React.ReactNode;
}

/**
 * Outer horizontal pager for Month View. Every month has a fixed slot on one
 * long paged strip (`RANGE` months either side of the mount month), and only
 * the committed month ± 1 are actually rendered, absolutely positioned at
 * their slots. So the scroll offset alone says which month is on screen.
 *
 * This replaced a sliding 3-page window that was re-centred after every swipe
 * (swap the pages, then `scrollTo` the middle). On iOS that `scrollTo` was
 * sometimes silently dropped (no scroll or momentum event ever arrived), which
 * left the viewport on a slot that now held a different month: the grid ran a
 * month off the header. With fixed slots a swipe needs no programmatic scroll
 * at all; only a chevron / Today tap scrolls, to a slot that is already laid
 * out.
 */
export function MonthPager({
  monthDate,
  onMonthChange,
  onVisibleMonthChange,
  scrollEnabled = true,
  renderPage,
}: MonthPagerProps) {
  const { width } = useWindowDimensions();
  // A horizontal ScrollView's content doesn't stretch its children vertically
  // on iOS, so `flex-1` pages collapse to 0 height (header only, no grid).
  // Give each page the pager's measured height explicitly.
  const [height, setHeight] = useState(0);
  const listRef = useRef<ScrollViewInstance>(null);

  // Slot `RANGE` is the month the pager mounted on; slot i is `anchor + (i -
  // RANGE)` months. Dates are cached per slot so a page's `monthDate` prop
  // keeps its identity across renders (`MonthPage` keys its fetch on it).
  const [anchor] = useState(monthDate);
  const slotDatesRef = useRef(new Map<number, Date>());
  function monthAt(index: number): Date {
    let date = slotDatesRef.current.get(index);
    if (!date) {
      date = addMonths(anchor, index - RANGE);
      slotDatesRef.current.set(index, date);
    }
    return date;
  }
  function clampIndex(index: number): number {
    return Math.min(PAGE_COUNT - 1, Math.max(0, index));
  }

  const committedIndex = clampIndex(
    RANGE + differenceInCalendarMonths(monthDate, anchor),
  );
  const committedIndexRef = useRef(committedIndex);
  committedIndexRef.current = committedIndex;

  // Slot the header was last told about, so `handleScroll` reports each
  // crossing once rather than every frame.
  const visibleIndexRef = useRef(committedIndex);
  // Confirmed live on an Android emulator: the scroll view can render still
  // sitting at offset 0 for a beat after mount, and if that late
  // self-correction fires through `onMomentumScrollEnd` it reads as a "user
  // swiped" and silently changes the header. Only scrolls that follow an
  // actual drag may change the month.
  const didDragRef = useRef(false);
  const hasLaidOutRef = useRef(false);

  // The month changed from outside (chevron, Today button), after a swipe, or
  // the window resized. The viewport follows through the `contentOffset` prop
  // below, not a `scrollTo` here: the prop is applied in the same native
  // update that mounts the new neighbour pages, whereas a `scrollTo` sent
  // alongside that mount was silently dropped on iOS (header moved, grid
  // didn't). After a swipe the viewport is already there, so it's a no-op.
  useEffect(() => {
    visibleIndexRef.current = committedIndex;
  }, [committedIndex]);

  // Centering must wait for the content to be laid out: before that, iOS
  // clamps any offset (`contentOffset` prop or an early `scrollTo`) to 0.
  function handleContentSizeChange(contentWidth: number) {
    if (hasLaidOutRef.current || contentWidth < width * PAGE_COUNT - 1) return;
    hasLaidOutRef.current = true;
    // JS knows the size before UIKit's `contentSize` has caught up, so the first
    // `scrollTo` can still be clamped to 0. Repeat (idempotent) until it sticks,
    // unless the user has already started dragging.
    const center = () => {
      if (!didDragRef.current) {
        listRef.current?.scrollTo({
          x: committedIndexRef.current * width,
          y: 0,
          animated: false,
        });
      }
    };
    center();
    [50, 150, 400].forEach((ms) => setTimeout(center, ms));
  }

  function indexFromEvent(event: NativeSyntheticEvent<NativeScrollEvent>) {
    return clampIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!didDragRef.current) return; // ignore programmatic scrolls
    const index = indexFromEvent(event);
    if (index === visibleIndexRef.current) return;
    visibleIndexRef.current = index;
    onVisibleMonthChange(monthAt(index));
  }

  function handleMomentumScrollEnd(
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) {
    if (!didDragRef.current) return;
    didDragRef.current = false;
    const index = indexFromEvent(event);
    visibleIndexRef.current = index;
    if (index !== committedIndexRef.current) onMonthChange(monthAt(index));
  }

  const rendered = [committedIndex - 1, committedIndex, committedIndex + 1]
    .filter((index) => index >= 0 && index < PAGE_COUNT);

  return (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      {height > 0 && (
        // A plain paged `ScrollView`, not a `FlatList`: on iOS the virtualized
        // list rendered nothing here (blank grid, not even the skeleton).
        <ScrollView
          ref={listRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: committedIndex * width, y: 0 }}
          contentContainerStyle={{ width: PAGE_COUNT * width, height }}
          onContentSizeChange={handleContentSizeChange}
          scrollEnabled={scrollEnabled}
          onScrollBeginDrag={() => {
            didDragRef.current = true;
          }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          style={{ flex: 1 }}
        >
          {rendered.map((index) => (
            <View
              key={index}
              style={{
                position: "absolute",
                left: index * width,
                top: 0,
                width,
                height,
              }}
            >
              {renderPage(monthAt(index))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
