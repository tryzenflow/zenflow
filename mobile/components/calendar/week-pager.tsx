import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { format } from "date-fns";
import { Text } from "@/components/ui/text";
import { ChevronLeft, ChevronRight } from "@/components/Icons";
import { useColorScheme } from "@/lib/useColorScheme";
import {
  dateKey,
  dayIndexInWeek,
  shiftDays,
  shiftWeek,
  weekDays,
} from "@/lib/week-date-math";
import { DayTimeline } from "./day-timeline";

/** Min ms between consecutive cross-day advances while a finger holds at the
 * screen edge (auto-advance cadence). */
const DRAG_ADVANCE_MS = 500;

/** Cross-day drags append/prepend days to the window so the page holding the
 * lifted block stays mounted; capped at two weeks so a drop always lands
 * within the mounted pages. */
const MAX_DAYS = 14;

/** Width of the decorative "next day" peek strip on each page's right edge
 * (mirrors mockups/week-view.html's `w-3.5` affordance). */
const PEEK_STRIP_W = 14;

const BRAND_ORANGE_LIGHT = "255, 142, 62";
const BRAND_ORANGE_DARK = "255, 122, 36";

/** Edges the WeekHeader peeks at, mapped to the adjacent-day advance. */
type DragEdge = "left" | "right";

interface WeekPagerProps {
  /** The day the screen/header currently shows; the pager keeps the focused
   * page aligned with it in both directions (swipe updates it, a chip tap
   * re-centers the pager on it). */
  focusedDate: Date;
  onFocusedDateChange: (day: Date) => void;
  /** Shared refetch token passed to every page's `DayTimeline`. */
  reloadKey: number;
  onTaskPress?: (taskId: string) => void;
  onLongPress?: (timeISO: string) => void;
  /** Fired after a cross-day reschedule so the screen can refetch the target
   * day (the source day refetches itself). */
  onCrossDayReschedule: () => void;
}

/**
 * Horizontal pager for the mobile Week View — a FlatList of full-width
 * `DayTimeline` pages, one per day, with `snapToInterval = screenWidth`. The
 * idle right-edge peek is decorative (mockup's `w-3.5` strip); real adjacent
 * pages only slide in mid-swipe.
 *
 * Unlike MonthPager's fixed 3-page window, the data window here is *live*: a
 * normal swipe that settles on the edge day slides the whole window ±1 week;
 * a cross-day task drag appends/prepends days (up to `MAX_DAYS`) while the
 * finger holds at the screen edge, then collapses back to the 7-day window on
 * drop — so the page owning the lifted block stays mounted for the whole
 * gesture (GitHub issue #19's "cross-day drag" frame).
 */
export function WeekPager({
  focusedDate,
  onFocusedDateChange,
  reloadKey,
  onTaskPress,
  onLongPress,
  onCrossDayReschedule,
}: WeekPagerProps) {
  const { width } = useWindowDimensions();
  const { isDarkColorScheme } = useColorScheme();
  const listRef = useRef<FlatList<Date>>(null);
  const [days, setDays] = useState<Date[]>(() => weekDays(focusedDate));
  const [focusedIndex, setFocusedIndex] = useState(() =>
    dayIndexInWeek(focusedDate),
  );
  const [dragActive, setDragActive] = useState(false);
  const [pill, setPill] = useState<{ edge: DragEdge; day: Date } | null>(null);

  // Cross-day offset accumulated during a drag; TaskBlock adds it to the
  // rescheduled wall clock on drop, then it resets on the next drag start.
  const dayOffsetRef = useRef(0);
  const lastAdvanceRef = useRef(0);
  // Same programmatic-vs-user-drag gate as MonthPager: `onMomentumScrollEnd`
  // only processes settles that followed a real user drag, never our own
  // recentering scrolls.
  const didDragRef = useRef(false);
  const hasLaidOutRef = useRef(false);
  // Page the swipe started on — lets the settle cap a flick to one day instead
  // of landing wherever momentum died (`disableIntervalMomentum` covers iOS;
  // this covers Android, which ignores that prop).
  const dragStartIndexRef = useRef(0);

  const scrollToIndex = useCallback((index: number, animated: boolean) => {
    requestAnimationFrame(() => {
      if (index < 0) return;
      listRef.current?.scrollToIndex({ index, animated });
    });
  }, []);

  // Drives the initial center position (and a chip tap to a day in a week
  // that isn't mounted) with an explicit recenter on first layout, because
  // `initialScrollIndex` alone is unreliable (same reasoning as MonthPager).
  const handleFirstLayout = useCallback(() => {
    if (hasLaidOutRef.current) return;
    hasLaidOutRef.current = true;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: dayIndexInWeek(focusedDate),
        animated: false,
      });
    });
  }, [focusedDate]);

  // External focus change (WeekHeader chip tap): scroll to the day if it's in
  // the window, otherwise rebuild the window around it. Internal changes
  // (swipe settle, drag advance/drop) already keep `days`/`focusedIndex` in
  // sync, so their re-entry here is a no-op (matching index, or the day is in
  // the freshly rebuilt window).
  useEffect(() => {
    const key = dateKey(focusedDate);
    const idx = days.findIndex((d) => dateKey(d) === key);
    if (idx >= 0) {
      if (idx === focusedIndex) return;
      setFocusedIndex(idx);
      scrollToIndex(idx, true);
      return;
    }
    const fresh = weekDays(focusedDate);
    setDays(fresh);
    setFocusedIndex(dayIndexInWeek(focusedDate));
    scrollToIndex(dayIndexInWeek(focusedDate), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the
    // current window; only the focused day drives this.
  }, [focusedDate]);

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!didDragRef.current) return;
      didDragRef.current = false;
      if (dragActive) return;

      const settled = Math.round(event.nativeEvent.contentOffset.x / width);
      if (settled < 0 || settled >= days.length) return;

      // Cap every swipe to one day: use only the direction of travel, never
      // the raw resting offset (a big flick can die 4-5 pages away).
      const start = dragStartIndexRef.current;
      const dir = settled > start ? 1 : settled < start ? -1 : 0;
      const target = Math.min(Math.max(start + dir, 0), days.length - 1);
      if (target === focusedIndex) return;

      // The list physically stopped farther than one page — animate it back so
      // the UI ends where the focus does.
      if (target !== settled) scrollToIndex(target, true);

      setFocusedIndex(target);
      if (target === days.length - 1) {
        // Settled on the trailing edge — slide the whole window one week
        // forward and focus the new week's Monday.
        const nextDays = weekDays(shiftWeek(days[target], 1));
        setDays(nextDays);
        setFocusedIndex(0);
        onFocusedDateChange(nextDays[0]);
        scrollToIndex(0, false);
      } else if (target === 0) {
        // Leading edge — slide one week back, focus the previous Sunday.
        const prevDays = weekDays(shiftWeek(days[target], -1));
        setDays(prevDays);
        setFocusedIndex(6);
        onFocusedDateChange(prevDays[6]);
        scrollToIndex(6, false);
      } else {
        onFocusedDateChange(days[target]);
      }
    },
    [days, focusedIndex, dragActive, width, onFocusedDateChange, scrollToIndex],
  );

  const handleDragEdge = useCallback(
    (edge: DragEdge) => {
      const now = Date.now();
      if (now - lastAdvanceRef.current < DRAG_ADVANCE_MS) return;
      lastAdvanceRef.current = now;

      const dir = edge === "right" ? 1 : -1;
      const targetIndex = focusedIndex + dir;
      let nextIndex = targetIndex;

      if (targetIndex < 0 || targetIndex >= days.length) {
        if (days.length >= MAX_DAYS) return;
        if (dir === 1) {
          setDays([...days, shiftDays(days[days.length - 1], 1)]);
          nextIndex = days.length;
        } else {
          setDays([shiftDays(days[0], -1), ...days]);
          nextIndex = focusedIndex + 1;
        }
      }

      setFocusedIndex(nextIndex);
      dayOffsetRef.current += dir;
      setPill({ edge, day: shiftDays(days[focusedIndex], dir) });
      scrollToIndex(nextIndex, false);
    },
    [days, focusedIndex, scrollToIndex],
  );

  const handleDragChange = useCallback(
    (active: boolean) => {
      setDragActive(active);
      if (active) {
        dayOffsetRef.current = 0;
        lastAdvanceRef.current = 0;
        setPill(null);
        return;
      }
      // Drop: collapse back to the 7-day window around the day the drag
      // landed on, and commit it as the focused day.
      const landed = days[focusedIndex];
      if (!landed) return;
      const fresh = weekDays(landed);
      setDays(fresh);
      setFocusedIndex(dayIndexInWeek(landed));
      onFocusedDateChange(landed);
      setPill(null);
      scrollToIndex(dayIndexInWeek(landed), false);
    },
    [days, focusedIndex, onFocusedDateChange, scrollToIndex],
  );

  const orangeRgb = isDarkColorScheme
    ? BRAND_ORANGE_DARK
    : BRAND_ORANGE_LIGHT;

  return (
    <View className="flex-1">
      <FlatList
        ref={listRef}
        data={days}
        horizontal
        pagingEnabled={false}
        snapToInterval={width}
        snapToAlignment="start"
        // iOS: a hard flick stops on the next page rather than flying several
        // days away. Android ignores this — the ±1 settle cap in
        // `handleMomentumScrollEnd` (via `dragStartIndexRef`) is the
        // cross-platform guarantee.
        disableIntervalMomentum
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={dayIndexInWeek(focusedDate)}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        keyExtractor={(day) => dateKey(day)}
        // Same detach/re-attach desync as MonthPager: keep every mounted page
        // so an active task drag (and its page) never gets unmounted.
        removeClippedSubviews={false}
        scrollEnabled={!dragActive}
        onLayout={handleFirstLayout}
        onScrollBeginDrag={() => {
          didDragRef.current = true;
          dragStartIndexRef.current = focusedIndex;
        }}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        renderItem={({ item, index }) => (
          <View style={{ width }} className="flex-1">
            <DayTimeline
              date={item}
              showHeader={false}
              showEmptyGhostAlways
              refreshKey={reloadKey}
              onTaskPress={onTaskPress}
              onLongPress={onLongPress}
              dayOffsetRef={dayOffsetRef}
              onDragEdge={handleDragEdge}
              onDragChange={handleDragChange}
              onCrossDayReschedule={() => onCrossDayReschedule()}
            />
            {index < days.length - 1 && (
              <View
                pointerEvents="none"
                className="absolute top-0 bottom-0 z-[6] border-l border-border bg-card"
                style={{
                  width: PEEK_STRIP_W,
                  right: 0,
                  shadowColor: "#000",
                  shadowOpacity: 0.08,
                  shadowRadius: 10,
                  shadowOffset: { width: -2, height: 0 },
                  elevation: 2,
                }}
              >
                <View
                  className="absolute rounded bg-brand-orange/30"
                  style={{ left: 3, top: 72, width: 8, height: 30 }}
                />
                <View
                  className="absolute rounded bg-brand-orange/25"
                  style={{ left: 3, top: 118, width: 8, height: 48 }}
                />
                <View
                  className="absolute rounded bg-muted"
                  style={{ left: 3, top: 176, width: 8, height: 26 }}
                />
              </View>
            )}
          </View>
        )}
        className="flex-1"
      />

      {pill && (
        <View pointerEvents="none" className="absolute inset-0 z-30">
          <LinearGradient
            colors={
              pill.edge === "right"
                ? [`rgba(${orangeRgb}, 0)`, `rgba(${orangeRgb}, 0.34)`]
                : [`rgba(${orangeRgb}, 0.34)`, `rgba(${orangeRgb}, 0)`]
            }
            start={{
              x: pill.edge === "right" ? 0 : 1,
              y: 0.5,
            }}
            end={{ x: pill.edge === "right" ? 1 : 0, y: 0.5 }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 56,
              ...(pill.edge === "right"
                ? { right: 0 }
                : { left: 0 }),
            }}
          />
          <View
            style={{
              position: "absolute",
              top: 130,
              ...(pill.edge === "right" ? { right: 10 } : { left: 10 }),
            }}
          >
            <View className="flex-row items-center gap-1.5 rounded-full bg-brand-orange px-2.5 py-1 shadow-lg">
              {pill.edge === "right" ? (
                <ChevronRight size={13} color="black" />
              ) : (
                <ChevronLeft size={13} color="black" />
              )}
              <Text className="text-[11px] font-bold text-primary-foreground">
                {format(pill.day, "EEE, MMM d")}
              </Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
