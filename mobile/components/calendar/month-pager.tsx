import { addMonths, monthLabel } from "@/lib/month-date-math";
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  View,
  useWindowDimensions,
} from "react-native";

interface MonthPagerProps {
  /** The month currently shown in the header — the pager stays in sync with
   * it in both directions: swiping updates it (via `onMonthChange`), and an
   * external change (chevron tap) re-centers the pager. */
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
 * Outer horizontal pager for Month View — a sliding 3-month window
 * (prev/current/next) recentered on every page change, rather than an
 * unbounded data list, so paging never needs to know how far back/forward
 * the user might go. Swipe (momentum scroll past the current page) and the
 * header's chevron taps (`app/(app)/month.tsx`) both drive the same
 * `monthDate`/`onMonthChange`, so the header label always stays in sync
 * (GitHub issue #21's acceptance criteria) regardless of which triggered
 * the change.
 */
export function MonthPager({
  monthDate,
  onMonthChange,
  onVisibleMonthChange,
  scrollEnabled = true,
  renderPage,
}: MonthPagerProps) {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Date>>(null);
  const [pages, setPages] = useState<Date[]>(() => [
    addMonths(monthDate, -1),
    monthDate,
    addMonths(monthDate, 1),
  ]);
  // Tracks the label of the month we last centered on, so the effect below
  // can tell "monthDate changed because WE scrolled" (already centered, a
  // no-op) apart from "monthDate changed because the caller changed it out
  // from under us" (a chevron tap — needs an explicit re-center).
  const centeredLabelRef = useRef(monthLabel(monthDate));
  // Confirmed live on an Android emulator: `initialScrollIndex` alone is not
  // reliable here — the FlatList can render still sitting at offset 0 (the
  // "prev" page) for a beat after mount while the header (driven by
  // `monthDate` state, not scroll position) already reads the center page,
  // and if that late self-correction fires through `onMomentumScrollEnd` it
  // reads as a "user swiped back a month" and silently changes the header. A
  // `didDragRef` gate (below) plus an explicit forced re-center on the
  // FlatList's own first `onLayout` (not just the mount-time
  // `initialScrollIndex` prop) closes both gaps.
  const didDragRef = useRef(false);
  const hasLaidOutRef = useRef(false);

  useEffect(() => {
    const label = monthLabel(monthDate);
    if (label === centeredLabelRef.current) return;
    centeredLabelRef.current = label;
    visibleLabelRef.current = label;
    setPages([addMonths(monthDate, -1), monthDate, addMonths(monthDate, 1)]);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: width, animated: false });
    });
  }, [monthDate, width]);

  function handleFirstLayout() {
    if (hasLaidOutRef.current) return;
    hasLaidOutRef.current = true;
    // Force the initial center position ourselves rather than trusting
    // `initialScrollIndex` alone to have already applied it correctly.
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: width, animated: false });
    });
  }

  // Label of the month the *viewport* is currently over, so `handleScroll`
  // only reports a change once per crossing rather than on every frame.
  const visibleLabelRef = useRef(monthLabel(monthDate));

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!didDragRef.current) return; // ignore programmatic recentering
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    const page = pages[index];
    if (!page) return;
    const label = monthLabel(page);
    if (label === visibleLabelRef.current) return;
    visibleLabelRef.current = label;
    onVisibleMonthChange(page);
  }

  function handleMomentumScrollEnd(
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) {
    // Ignore any programmatic/self-correcting scroll settle that didn't
    // follow an actual user drag (see `didDragRef`'s doc comment above).
    if (!didDragRef.current) return;
    didDragRef.current = false;

    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    if (index === 1 || !pages[index]) return; // stayed on the center page
    const nextMonth = pages[index];
    centeredLabelRef.current = monthLabel(nextMonth);
    visibleLabelRef.current = monthLabel(nextMonth);
    onMonthChange(nextMonth);
    setPages([addMonths(nextMonth, -1), nextMonth, addMonths(nextMonth, 1)]);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: width, animated: false });
    });
  }

  return (
    <FlatList
      ref={listRef}
      data={pages}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      initialScrollIndex={1}
      getItemLayout={(_, index) => ({
        length: width,
        offset: width * index,
        index,
      })}
      keyExtractor={(page) => monthLabel(page)}
      // Android's `VirtualizedList` defaults this to `true`, and it is the
      // remaining cause of "addViewAt: failed to insert view […] the
      // specified child already has a parent" when leaving Month View (the
      // segmented control or the bottom tab bar, either one): clipping works
      // by detaching/re-attaching child views from their `ViewGroup` behind
      // React's back, and when `react-native-screens` detaches this screen on
      // a tab switch that bookkeeping desyncs — RN then re-inserts a view
      // that still has a parent and throws. `data` is only ever the 3-month
      // sliding window, so clipping bought nothing here anyway. Same failure
      // family as the nested-VirtualizedList note in `month-grid.tsx`.
      removeClippedSubviews={false}
      renderItem={({ item }) => (
        <View style={{ width }} className="flex-1">
          {renderPage(item)}
        </View>
      )}
      onLayout={handleFirstLayout}
      scrollEnabled={scrollEnabled}
      onScrollBeginDrag={() => {
        didDragRef.current = true;
      }}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      className="flex-1"
    />
  );
}
