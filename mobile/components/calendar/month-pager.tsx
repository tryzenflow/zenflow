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
      renderItem={({ item }) => (
        <View style={{ width }} className="flex-1">
          {renderPage(item)}
        </View>
      )}
      onLayout={handleFirstLayout}
      onScrollBeginDrag={() => {
        didDragRef.current = true;
      }}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      className="flex-1"
    />
  );
}
