import { ChevronLeft, ChevronRight } from "@/components/Icons";
import { MonthPage } from "@/components/calendar/month-page";
import { MonthPager } from "@/components/calendar/month-pager";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { addMonths, dateKey, monthLabel } from "@/lib/month-date-math";
import { zonedNow } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { isSameMonth, startOfMonth } from "date-fns";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { Pressable, View } from "react-native";

interface MonthViewProps {
  /** Any day in the month on screen; a swipe, chevron or tap reports the new one through `onDateChange`. */
  date: Date;
  onDateChange: (date: Date) => void;
  tz: string;
  /** Bumped by the parent on screen focus so the visible month refetches. */
  reloadToken: number;
  /** Open this day in Day view. */
  onOpenDay: (day: Date) => void;
  /** Open a session's detail sheet. */
  onSessionPress: (sessionId: string) => void;
  /** A session from the list was dropped on a day of the grid. */
  onMoveSession?: (session: Session, day: Date) => void;
}

/**
 * Month view of the calendar screen: a compact Monday-first grid whose days
 * carry load bars, and the selected day's sessions under it, in the style of
 * the system calendar. Hosted by `app/(app)/index.tsx`.
 */
export function MonthView({
  date,
  onDateChange,
  tz,
  reloadToken,
  onOpenDay,
  onSessionPress,
  onMoveSession,
}: MonthViewProps) {
  // `monthDate` is the committed month and drives which pages mount.
  // `visibleMonth` is what the header prints; it follows the finger.
  const [monthDate, setMonthDate] = useState(date);
  const [visibleMonth, setVisibleMonth] = useState(date);
  const [selected, setSelected] = useState(date);
  // The header paints from `visibleMonth` at once; the pages follow at lower
  // priority, so re-rendering their cells never holds the title back.
  const activeMonth = useDeferredValue(visibleMonth);

  // A date from the parent (view switch, Today) re-seeds the selection and,
  // when it lands in another month, the month on screen.
  const lastDateRef = useRef(date);
  const monthRef = useRef(monthDate);
  monthRef.current = monthDate;
  useEffect(() => {
    if (dateKey(lastDateRef.current) === dateKey(date)) return;
    lastDateRef.current = date;
    setSelected(date);
    if (!isSameMonth(monthRef.current, date)) {
      setMonthDate(date);
      setVisibleMonth(date);
    }
  }, [date]);

  const goToMonth = useCallback(
    (next: Date) => {
      // The current month selects today; any other selects its first day.
      const now = zonedNow(tz);
      const day = isSameMonth(next, now) ? now : startOfMonth(next);
      setMonthDate(next);
      setVisibleMonth(next);
      setSelected(day);
      lastDateRef.current = day;
      onDateChange(day);
    },
    [onDateChange, tz],
  );

  // First tap selects a day; tapping the selected day opens it. Reads state
  // through refs so its identity holds and memoized pages skip re-rendering.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const selectDay = useCallback(
    (day: Date) => {
      if (dateKey(day) === dateKey(selectedRef.current)) {
        onOpenDay(day);
        return;
      }
      setSelected(day);
      lastDateRef.current = day;
      if (!isSameMonth(day, monthRef.current)) {
        setMonthDate(day);
        setVisibleMonth(day);
      }
      onDateChange(day);
    },
    [onDateChange, onOpenDay],
  );

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-3 bg-background px-4 pb-2 pt-1">
        <View className="min-w-0 shrink flex-row items-center gap-2">
          <Pressable
            onPress={() => goToMonth(addMonths(monthDate, -1))}
            hitSlop={8}
            accessibilityLabel={t("Previous month")}
          >
            <ChevronLeft size={18} className="text-muted-foreground" />
          </Pressable>
          <Text
            numberOfLines={1}
            className="shrink text-xl font-bold tracking-tight"
          >
            {monthLabel(visibleMonth)}
          </Text>
          <Pressable
            onPress={() => goToMonth(addMonths(monthDate, 1))}
            hitSlop={8}
            accessibilityLabel={t("Next month")}
          >
            <ChevronRight size={18} className="text-muted-foreground" />
          </Pressable>
        </View>
      </View>

      <View className="flex-1">
        <MonthPager
          monthDate={monthDate}
          onMonthChange={goToMonth}
          onVisibleMonthChange={setVisibleMonth}
          renderPage={(pageMonthDate) => (
            <MonthPage
              monthDate={pageMonthDate}
              tz={tz}
              reloadToken={reloadToken}
              isActive={isSameMonth(pageMonthDate, activeMonth)}
              selectedDate={selected}
              onSelectDay={selectDay}
              onOpenDay={onOpenDay}
              onSessionPress={onSessionPress}
              onMoveSession={onMoveSession}
            />
          )}
        />
      </View>
    </View>
  );
}
