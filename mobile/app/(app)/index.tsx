import { listTasks } from "@/api/tasks";
import { Calendar } from "@/components/Icons";
import {
  CreateTaskFab,
  createTaskAtNowHref,
} from "@/components/tasks/create-task-fab";
import { OptimizeFab } from "@/components/tasks/optimize-fab";
import { Text } from "@/components/ui/text";
import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import { useFocusEffect } from "@react-navigation/native";
import { zonedDate, zonedNow } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

/**
 * Day screen — still the Phase 2 stub for the real gesture-first timeline
 * (`docs/react-native-migration.md` Phase 2: `ScrollView` + absolute
 * `TaskBlock`s, pinch-zoom, drag-to-move, `getOverlapLayout` column
 * splitting — none of that exists yet, and building it is explicitly out of
 * scope for RN migration Phase 5 / GitHub issue #20, which is scoped to the
 * task *sheets*, not the calendar grid).
 *
 * This screen is the minimal surface issue #20 asks for instead ("wire what
 * is reasonable, note what's blocked"): today's tasks as a plain list
 * (rather than a positioned grid — there's no grid to position against yet)
 * with the two real gestures wired against the real API:
 *   - tap a task card            → `/task/[id]/edit` (also where duration
 *     resize now lives, via `TaskSheetFields`'s stepper)
 *   - long-press the empty area  → `/task/new`, pre-filled with "now"
 *     snapped to the next 15-minute mark
 *
 * The create/edit forms are full screens, not bottom sheets — see
 * mobile/README.md for why.
 *
 * Accepts an optional `date` query param (ISO instant) so other screens can
 * deep-link into a specific day — currently only Month View's "tap a day
 * cell" gesture (`app/(app)/month.tsx`, GitHub issue #21's acceptance
 * criteria: "navigates to Day View pre-loaded to that date").
 *
 * BLOCKED (tracked for Phase 2, not attempted here): true per-pixel
 * long-press-a-time-slot → snapped-start-time creation (needs the absolute
 * positioned grid to know what time a press landed on), drag-to-move,
 * pinch-zoom, and the now-indicator/work-zone overlays.
 */
export default function DayScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // `zonedDate`/`zonedNow` both return a Date whose local fields already
  // carry the user-tz wall clock — `dateParam` (from Month View) is an ISO
  // instant, so it goes through `zonedDate` the same way a task's
  // `scheduledStartTime` does, not a bare `new Date()`.
  const today = useMemo(
    () => (dateParam ? zonedDate(dateParam, tz) : zonedNow(tz)),
    [dateParam, tz],
  );

  const refetch = useCallback(async () => {
    const res = await listTasks("day", today, "PENDING");
    setTasks(res.tasks);
  }, [today]);

  useEffect(() => {
    if (user) refetch();
  }, [user, refetch]);

  // Refetch whenever this screen regains focus — covers returning from
  // `/task/new`/`/task/[id]/edit`, which (unlike the old sheets) have no
  // ref to thread an onCreated/onSaved/onDeleted callback through.
  useFocusEffect(
    useCallback(() => {
      if (user) refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, refetch]),
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border bg-background px-4 pb-3.5 pt-1.5">
        <Text className="text-xl font-bold tracking-tight">
          {format(today, "EEE, MMM d")}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-2.5 p-4 pb-24"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {tasks.length === 0 && (
          <View className="items-center gap-3 py-10">
            <Calendar size={32} className="text-muted-foreground" />
            <Text className="text-center text-sm text-muted-foreground">
              Nothing scheduled today.
            </Text>
          </View>
        )}

        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            tz={tz}
            onPress={() => router.push(`/task/${task.id}/edit` as Href)}
          />
        ))}

        {/* Long-press-empty-area → create, standing in for "long-press an
            empty grid slot" until the real timeline (Phase 2) exists. */}
        <Pressable
          onLongPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
              () => {},
            );
            router.push(createTaskAtNowHref(tz));
          }}
          className="mt-2 min-h-[96px] items-center justify-center rounded-2xl border border-dashed border-border"
        >
          <Text className="text-sm text-muted-foreground">
            Long-press to add a task
          </Text>
        </Pressable>
      </ScrollView>

      <CreateTaskFab tz={tz} />
      <OptimizeFab tz={tz} onApplied={refetch} />
    </View>
  );
}

function TaskRow({
  task,
  tz,
  onPress,
}: {
  task: Task;
  tz: string;
  onPress: () => void;
}) {
  const timeLabel = task.scheduledStartTime
    ? formatRange(task.scheduledStartTime, task.durationMinutes, tz)
    : "Not yet scheduled";

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-3 rounded-xl border border-l-4 bg-card px-3.5 py-3",
        task.status === "DONE"
          ? "border-border border-l-emerald-500 opacity-60"
          : task.conflict
            ? "border-border border-l-amber-500"
            : "border-border border-l-primary",
      )}
    >
      <View className="min-w-0 flex-1">
        <Text
          className="text-[13px] font-semibold text-foreground"
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <Text className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {timeLabel}
        </Text>
      </View>
    </Pressable>
  );
}

function formatRange(startIso: string, durationMinutes: number, tz: string) {
  const start = zonedDate(startIso, tz);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return `${format(start, "h:mm a")}–${format(end, "h:mm a")}`;
}
