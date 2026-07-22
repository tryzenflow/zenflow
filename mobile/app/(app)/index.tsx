import { listTasks } from "@/api/tasks";
import { Calendar, Plus } from "@/components/Icons";
import { ChangeDurationSheet } from "@/components/tasks/change-duration-sheet";
import { CreateTaskSheet } from "@/components/tasks/create-task-sheet";
import { EditTaskSheet } from "@/components/tasks/edit-task-sheet";
import { Text } from "@/components/ui/text";
import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import {
  snapToNearestLaterQuarterHour,
  zonedDate,
  zonedNow,
} from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
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
 * with the three real gestures wired against the real API:
 *   - tap a task card            → `EditTaskSheet`
 *   - long-press a task card     → `ChangeDurationSheet`
 *   - long-press the empty area  → `CreateTaskSheet`, pre-filled with "now"
 *     snapped to the next 15-minute mark
 *
 * BLOCKED (tracked for Phase 2, not attempted here): true per-pixel
 * long-press-a-time-slot → snapped-start-time creation (needs the absolute
 * positioned grid to know what time a press landed on), drag-to-move,
 * pinch-zoom, and the now-indicator/work-zone overlays.
 */
export default function DayScreen() {
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createStart, setCreateStart] = useState<Date | undefined>(undefined);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [resizingTask, setResizingTask] = useState<Task | null>(null);

  const refetch = useCallback(async () => {
    const res = await listTasks("day", zonedNow(tz), "PENDING");
    setTasks(res.tasks);
  }, [tz]);

  useEffect(() => {
    if (user) refetch();
  }, [user, refetch]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }

  function openCreateAtNow() {
    const now = zonedNow(tz);
    const snappedMinutes = snapToNearestLaterQuarterHour(
      now.getHours() * 60 + now.getMinutes(),
    );
    const snapped = new Date(now);
    snapped.setHours(0, Math.min(snappedMinutes, 23 * 60 + 45), 0, 0);
    setCreateStart(snapped);
    setCreateOpen(true);
  }

  const today = zonedNow(tz);

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
            onPress={() => setEditingTaskId(task.id)}
            onLongPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
                () => {},
              );
              setResizingTask(task);
            }}
          />
        ))}

        {/* Long-press-empty-area → create, standing in for "long-press an
            empty grid slot" until the real timeline (Phase 2) exists. */}
        <Pressable
          onLongPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
              () => {},
            );
            openCreateAtNow();
          }}
          className="mt-2 min-h-[96px] items-center justify-center rounded-2xl border border-dashed border-border"
        >
          <Text className="text-sm text-muted-foreground">
            Long-press to add a task
          </Text>
        </Pressable>
      </ScrollView>

      <Pressable
        onPress={openCreateAtNow}
        accessibilityLabel="New task"
        className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg"
      >
        <Plus size={22} className="text-primary-foreground" />
      </Pressable>

      <CreateTaskSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialStart={createStart}
        onCreated={refetch}
      />
      <EditTaskSheet
        open={!!editingTaskId}
        onOpenChange={(open) => !open && setEditingTaskId(null)}
        taskId={editingTaskId}
        onSaved={refetch}
        onDeleted={refetch}
      />
      <ChangeDurationSheet
        open={!!resizingTask}
        onOpenChange={(open) => !open && setResizingTask(null)}
        task={resizingTask}
        onResized={refetch}
      />
    </View>
  );
}

function TaskRow({
  task,
  tz,
  onPress,
  onLongPress,
}: {
  task: Task;
  tz: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const timeLabel = task.scheduledStartTime
    ? formatRange(task.scheduledStartTime, task.durationMinutes, tz)
    : "Not yet scheduled";

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
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
