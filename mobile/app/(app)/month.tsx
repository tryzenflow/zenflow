import { ChevronLeft, ChevronRight } from "@/components/Icons";
import { MonthPage } from "@/components/calendar/month-page";
import { MonthPager } from "@/components/calendar/month-pager";
import {
  TaskListSheet,
  type TaskListSheetHandle,
} from "@/components/calendar/task-list-sheet";
import { CreateTaskFab } from "@/components/tasks/create-task-fab";
import { OptimizeFab } from "@/components/tasks/optimize-fab";
import { Text } from "@/components/ui/text";
import { useUserStore } from "@/hooks/use-user-store";
import { addMonths, monthLabel } from "@/lib/month-date-math";
import { useFocusEffect } from "@react-navigation/native";
import { zonedNow, zonedWallClockToUtc } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { type Href, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, View } from "react-native";

/**
 * Month screen — RN migration Phase 4 (GitHub issue #21). Paginated
 * Monday-first grid (`MonthPager` → `MonthPage` → `MonthGrid`/`MonthCell`),
 * "+N more" overflow bottom sheet, tap-a-day → Day View, and long-press-drag
 * a task pill to reschedule it to another day.
 *
 * Replaces the placeholder stub — see `mobile/README.md` and
 * `docs/react-native-migration.md` Phase 4.
 */
export default function MonthScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";

  const [monthDate, setMonthDate] = useState(() => zonedNow(tz));
  // Bumped whenever the currently-focused page's data should be refetched —
  // returning from `/task/[id]/edit` (via `useFocusEffect`, same pattern as
  // Day View) or after an Optimize apply.
  const [reloadToken, setReloadToken] = useState(0);

  const taskListSheetRef = useRef<TaskListSheetHandle>(null);

  useFocusEffect(
    useCallback(() => {
      setReloadToken((n) => n + 1);
    }, []),
  );

  function openDay(day: Date) {
    // `day` is a "zoned" Date (local fields = user-tz wall clock, see
    // `@zenflow/core`'s `zonedDate`/`zonedNow` doc comment) — its own
    // `.toISOString()` is NOT a valid UTC instant; go through
    // `zonedWallClockToUtc` first, same as every other zoned→API boundary.
    router.push({
      pathname: "/(app)",
      params: { date: zonedWallClockToUtc(day, tz).toISOString() },
    } as Href);
  }

  function openOverflow(day: Date, tasks: Task[]) {
    taskListSheetRef.current?.open(day, tasks);
  }

  function openTaskFromSheet(task: Task) {
    router.push(`/task/${task.id}/edit` as Href);
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-3 border-b border-border bg-background px-4 pb-3.5 pt-1.5">
        <Pressable
          onPress={() => setMonthDate((d) => addMonths(d, -1))}
          hitSlop={8}
          accessibilityLabel="Previous month"
        >
          <ChevronLeft size={18} className="text-muted-foreground" />
        </Pressable>
        <Text className="text-xl font-bold tracking-tight">
          {monthLabel(monthDate)}
        </Text>
        <Pressable
          onPress={() => setMonthDate((d) => addMonths(d, 1))}
          hitSlop={8}
          accessibilityLabel="Next month"
        >
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </View>

      <MonthPager
        monthDate={monthDate}
        onMonthChange={setMonthDate}
        renderPage={(pageMonthDate) => (
          <MonthPage
            monthDate={pageMonthDate}
            tz={tz}
            reloadToken={reloadToken}
            // Only the page the header is actually showing surfaces a load-
            // error toast — confirmed live (Android emulator) that without
            // this, the outer pager's off-screen prev/next pages can fail
            // their own fetch in the same tick as the visible page and both
            // call `toast()` in the same millisecond; `components/ui/toast.tsx`
            // ids toasts with `Date.now()`, so simultaneous calls collide on
            // one id and React throws a duplicate-key warning. Scoped here
            // rather than fixed in the shared toast provider (out of this
            // issue's file scope) — flagged in the PR summary as a
            // pre-existing toast-id gap worth a follow-up.
            isActive={monthLabel(pageMonthDate) === monthLabel(monthDate)}
            onOpenDay={openDay}
            onOpenOverflow={openOverflow}
          />
        )}
      />

      <TaskListSheet
        ref={taskListSheetRef}
        tz={tz}
        onSelectTask={openTaskFromSheet}
      />

      <CreateTaskFab tz={tz} />
      <OptimizeFab tz={tz} onApplied={() => setReloadToken((n) => n + 1)} />
    </View>
  );
}
