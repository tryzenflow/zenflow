import { Text } from "@/components/ui/text";
import { useNow } from "@/hooks/use-now";
import { SESSION_TYPE_META, SESSION_TYPE_ORDER } from "@/lib/session-type";
import {
  dateKey,
  shiftWeek,
  weekDays,
  weekHeaderBlocks,
  weekStart,
} from "@/lib/week-date-math";
import { SETTLE_MS } from "@/lib/week-pager-math";
import type { SessionType } from "@zenflow/shared";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  type ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  clamp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** Horizontal drag distance / fling speed that commits a week change. */
const WEEK_SWIPE_DISTANCE = 48;
const WEEK_SWIPE_VELOCITY = 500;

/** `withTiming` config for the week slide — `SETTLE_MS` is shared with the
 * pager (`week-pager-math.ts`) so header and pager land on the same frame. */
const SETTLE = {
  duration: SETTLE_MS,
  easing: Easing.out(Easing.cubic),
} as const;

interface WeekHeaderProps {
  /** The *committed* focused day — anchors the chip carousel's week block and
   * is what a chip tap / week swipe shifts from. */
  focusedDate: Date;
  /** The day the pager is *currently* centred on, finger-tracked during a
   * swipe (falls back to `focusedDate`). Drives only the month/year title, the
   * week-range line, and the `bg-muted` chip highlight — the things the user
   * watches move — so they follow the drag instead of snapping at settle. */
  displayDate?: Date;
  tz: string;
  onSelectDay: (day: Date) => void;
  /** Pager strip offset, owned by `WeekScreen`. The header's week swipe writes
   * it 1:1 with the finger so the pager slides one page in lockstep. */
  progressSV: SharedValue<number>;
  /** The header strip's own offset — written here during a header week swipe,
   * and by the pager (via `withTiming`) when a day-swipe crosses a week edge. */
  headerStripSV: SharedValue<number>;
  /** Header week swipe activated: the pager builds its same-weekday
   * adjacent-week window. */
  onWeekDragBegin: () => void;
  /** Header week swipe committed in `dir` (−1 back, 1 forward): the pager
   * finishes the one-page slide and re-centers. */
  onWeekDragSettle: (dir: -1 | 1) => void;
  /** Header week swipe released below threshold or cancelled: the pager
   * collapses its window back with no focus change. */
  onWeekDragAbort: () => void;
  /** Distinct `SessionType`s scheduled on each day of the visible week,
   * keyed by `dateKey` (`use-week-day-types.ts`) — drives the small dot row
   * under each day-number circle. Absent/empty for a day renders no dots. */
  dayTypes: Map<string, SessionType[]>;
}

/** Imperative surface the pager drives when a day-swipe crosses a week edge
 * (`slideWeek`), so the header runs its week-block slide in sync. */
export type WeekHeaderHandle = {
  /** A boundary-cross slide started — enter week-slide mode (the strip tracks
   * `headerStripSV`, which the pager is animating). */
  onWeekSlideStart: () => void;
  /** …and finished, in week direction `dir` — re-center the strip on the new
   * week. */
  onWeekSlideEnd: (dir: -1 | 1) => void;
};

/**
 * Sticky header above the week pager — RN port of mockups/week-view.html's
 * title row (month + week range) and the 7-day chip strip. Highlights are
 * independent (mockup's Wednesday):
 * - focused day → `bg-muted` chip container (the pager sits on it);
 * - today → `bg-primary` filled number circle (when today is focused, both).
 *
 * The chip strip is a 3-week block carousel (`weekHeaderBlocks`), rested with
 * the middle block centered (`translateX = -width`). A week swipe — or a pager
 * day-swipe that crosses a week edge — slides it exactly one block in lockstep
 * with the pager's one-page slide, then re-centers on the new week in the same
 * commit the blocks re-derive (mirror of the pager's `useLayoutEffect([days])`
 * trick), so the snap-back is invisible. Within-week pager day-swipes leave
 * the strip parked at `-width` (`weekModeSV` is 0) — only the `bg-muted`
 * highlight moves, exactly as before.
 */
function WeekHeaderImpl(
  {
    focusedDate,
    displayDate,
    tz,
    onSelectDay,
    progressSV,
    headerStripSV,
    onWeekDragBegin,
    onWeekDragSettle,
    onWeekDragAbort,
    dayTypes,
  }: WeekHeaderProps,
  ref: ForwardedRef<WeekHeaderHandle>,
) {
  const now = useNow();
  const { width } = useWindowDimensions();

  // What the title / range / highlight read. The carousel and anchor logic
  // stay on `focusedDate` so they never re-derive mid-swipe.
  const shownDate = displayDate ?? focusedDate;

  const [weekBusy, setWeekBusy] = useState(false);
  // The strip's data anchor — decoupled from `focusedDate` so `blocks` never
  // re-derives mid-slide (that would swap the block sliding in for `f±14`).
  const [anchorDate, setAnchorDate] = useState(focusedDate);

  const blocks = useMemo(() => weekHeaderBlocks(anchorDate), [anchorDate]);
  const focusedKey = useMemo(() => dateKey(shownDate), [shownDate]);
  const todayKey = useMemo(() => dateKey(toZonedTime(now, tz)), [now, tz]);
  // Title/range track the (finger-following) shown day; the strip does not.
  const titleDays = useMemo(() => weekDays(shownDate), [shownDate]);

  // 1 while a week slide owns the strip. A shared value (not React state) so
  // within-week pager day-swipes park the strip at `-width` with zero
  // re-render.
  const weekModeSV = useSharedValue(0);
  // Mirrors the pager's `didSettleSV` — `onFinalize` skips the snap-back when
  // `onEnd` already committed a week change.
  const didCommitSV = useSharedValue(0);
  // Re-center layout-effect guard (mirror of the pager's `pendingSettleRef`).
  const recenterRef = useRef(false);

  // Gesture JS callbacks read this at fire time instead of closing over
  // changing state, so a `useNow()` tick never rebuilds `weekSwipe`.
  const latest = useRef({ focusedDate, anchorDate });
  latest.current = { focusedDate, anchorDate };

  const stripStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: weekModeSV.value === 1 ? headerStripSV.value : -width },
    ],
  }));

  // Anchor follows `focusedDate` for NON-transition week changes (an off-week
  // chip tap = instant): the strip is already parked at `-width`, so
  // re-deriving `blocks` around the new week shows no motion.
  useEffect(() => {
    if (weekBusy) return;
    if (dateKey(weekStart(focusedDate)) !== dateKey(weekStart(anchorDate))) {
      setAnchorDate(focusedDate);
    }
  }, [focusedDate, weekBusy, anchorDate]);

  // Snap the strip back to rest in the SAME commit as the re-derived blocks,
  // so the ∓width the slide left it at cancels to zero visible movement.
  useLayoutEffect(() => {
    if (!recenterRef.current) return;
    recenterRef.current = false;
    headerStripSV.value = -width;
    weekModeSV.value = 0;
  }, [anchorDate, headerStripSV, weekModeSV, width]);

  const commitWeekNow = useCallback(
    (dir: -1 | 1) => {
      setWeekBusy(true);
      onSelectDay(shiftWeek(latest.current.focusedDate, dir));
    },
    [onSelectDay],
  );

  // Runs at the slide's `withTiming` completion — re-center the strip on the
  // new week (deferred snap via the layout-effect above) and release the pan.
  const afterWeekSlide = useCallback((dir: -1 | 1) => {
    recenterRef.current = true;
    setAnchorDate(shiftWeek(latest.current.anchorDate, dir));
    setWeekBusy(false);
  }, []);

  const weekSwipe = useMemo(
    () =>
      Gesture.Pan()
        // Blocks re-entry while a slide settles; chip taps stay live.
        .enabled(!weekBusy)
        .activeOffsetX([-16, 16])
        .failOffsetY([-14, 14])
        .onStart(() => {
          "worklet";
          weekModeSV.value = 1;
          didCommitSV.value = 0;
          headerStripSV.value = -width;
          runOnJS(onWeekDragBegin)();
        })
        .onUpdate((e) => {
          "worklet";
          const d = clamp(e.translationX, -width, width);
          headerStripSV.value = -width + d; // strip, 1:1 finger, one block
          progressSV.value = -width + d; // pager, 1:1 finger, one page
        })
        .onEnd((e) => {
          "worklet";
          const fwd =
            e.translationX <= -WEEK_SWIPE_DISTANCE ||
            e.velocityX <= -WEEK_SWIPE_VELOCITY;
          const back =
            e.translationX >= WEEK_SWIPE_DISTANCE ||
            e.velocityX >= WEEK_SWIPE_VELOCITY;
          const dir = fwd ? 1 : back ? -1 : 0;
          if (dir === 0) return; // below threshold — onFinalize snaps back
          didCommitSV.value = 1;
          const target = -width - dir * width;
          headerStripSV.value = withTiming(target, SETTLE, () => {
            "worklet";
            runOnJS(afterWeekSlide)(dir as -1 | 1);
          });
          runOnJS(commitWeekNow)(dir as -1 | 1);
          runOnJS(onWeekDragSettle)(dir as -1 | 1);
        })
        .onFinalize(() => {
          "worklet";
          if (didCommitSV.value === 1) {
            didCommitSV.value = 0;
            return; // committed — afterWeekSlide / layout-effect clean up
          }
          if (weekModeSV.value === 1) {
            // Activated then cancelled (or released below threshold).
            headerStripSV.value = withTiming(-width, SETTLE, (finished) => {
              "worklet";
              if (finished) weekModeSV.value = 0;
            });
            runOnJS(onWeekDragAbort)();
          }
        }),
    [
      width,
      weekBusy,
      onWeekDragBegin,
      onWeekDragSettle,
      onWeekDragAbort,
      commitWeekNow,
      afterWeekSlide,
      headerStripSV,
      progressSV,
      weekModeSV,
      didCommitSV,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      onWeekSlideStart: () => {
        weekModeSV.value = 1;
        setWeekBusy(true);
      },
      onWeekSlideEnd: (dir: -1 | 1) => {
        recenterRef.current = true;
        setAnchorDate(shiftWeek(latest.current.anchorDate, dir));
        setWeekBusy(false);
      },
    }),
    [weekModeSV],
  );

  const renderChip = (day: Date) => {
    const key = dateKey(day);
    const isFocused = key === focusedKey;
    const isToday = key === todayKey;
    // Dedupe already happened in `sessionTypesByDay`; sort into a stable,
    // canonical order so the dots don't jitter between renders/days.
    const types = (dayTypes.get(key) ?? [])
      .slice()
      .sort(
        (a, b) => SESSION_TYPE_ORDER.indexOf(a) - SESSION_TYPE_ORDER.indexOf(b),
      );
    return (
      <Pressable
        key={key}
        onPress={() => onSelectDay(day)}
        className={`flex-1 items-center gap-1 rounded-xl py-1.5 ${
          isFocused ? "bg-muted" : ""
        }`}
        accessibilityLabel={`${format(day, "EEEE, MMMM d")}${
          isToday ? ", today" : ""
        }${
          types.length > 0
            ? `, ${types.map((t) => SESSION_TYPE_META[t].label).join(", ")}`
            : ""
        }`}
      >
        <Text className="text-[10.5px] font-semibold uppercase text-muted-foreground">
          {format(day, "EEE")}
        </Text>
        <View
          className={`h-[30px] w-[30px] items-center justify-center rounded-full text-base ${
            isToday ? "bg-primary text-primary-foreground" : "text-foreground"
          }`}
        >
          <Text
            className={`text-base font-semibold ${
              isToday ? "text-primary-foreground" : "text-foreground"
            }`}
          >
            {format(day, "d")}
          </Text>
        </View>
        {/* Fixed-height row so a 0-dot day reserves the same space as a
            5-dot day — the chip's height never jumps day to day. */}
        <View className="h-[5px] flex-row items-center gap-[3px]">
          {types.map((type) => (
            <View
              key={type}
              className={`h-[4px] w-[4px] rounded-full ${SESSION_TYPE_META[type].dotClass}`}
            />
          ))}
        </View>
      </Pressable>
    );
  };

  return (
    <GestureDetector gesture={weekSwipe}>
      <View className="overflow-hidden border-b border-border bg-background pt-2.5 pb-2">
        <View className="px-4 pb-2">
          <Text className="text-xl font-bold tracking-tight">
            {format(shownDate, "MMMM yyyy")}
          </Text>
          <Text className="mt-px text-[11.5px] font-medium text-muted-foreground">
            {format(titleDays[0], "MMM d")} – {format(titleDays[6], "MMM d")}
          </Text>
        </View>

        <Animated.View
          style={[{ flexDirection: "row", width: width * 3 }, stripStyle]}
        >
          {blocks.map((weekDates) => (
            <View key={dateKey(weekDates[0])} style={{ width }}>
              <View className="flex-row gap-1.5 px-4 pt-1 pb-0.5">
                {weekDates.map((day) => renderChip(day))}
              </View>
            </View>
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export const WeekHeader = forwardRef(WeekHeaderImpl);
WeekHeader.displayName = "WeekHeader";
