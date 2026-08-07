import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFlatList,
  BottomSheetHeader,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { deriveState } from "@/lib/task-card";
import { cn } from "@/lib/utils";
import { zonedDate } from "@zenflow/core";
import type { Task, TaskCardState } from "@zenflow/shared";
import { format } from "date-fns";
import { forwardRef, useImperativeHandle, useState } from "react";
import { type ListRenderItemInfo, Pressable, View } from "react-native";

export interface TaskListSheetHandle {
  open: (day: Date, tasks: Task[]) => void;
}

interface TaskListSheetProps {
  tz: string;
  /** Tapping a row closes the sheet and hands the task back to the screen
   * (`app/(app)/month.tsx` pushes `/task/[id]/edit`). */
  onSelectTask: (task: Task) => void;
}

export const TaskListSheet = forwardRef<
  TaskListSheetHandle,
  TaskListSheetProps
>(({ tz, onSelectTask }, ref) => {
  const bottomSheet = useBottomSheet();
  const [day, setDay] = useState<Date | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      open: (nextDay, nextTasks) => {
        setDay(nextDay);
        setTasks(nextTasks);
        bottomSheet.open();
      },
    }),
    [bottomSheet],
  );

  return (
    <BottomSheet>
      <BottomSheetContent
        ref={bottomSheet.ref}
        snapPoints={["70%"]}
        enableDynamicSizing={false}
      >
        <BottomSheetHeader>
          <View className="min-w-0 flex-1">
            <Text className="text-[19px] font-bold">
              {day ? format(day, "EEE, MMM d") : ""}
            </Text>
            <Text className="mt-[3px] text-[13px] text-muted-foreground">
              {summarize(tasks)}
            </Text>
          </View>
        </BottomSheetHeader>
        <BottomSheetFlatList
          data={tasks}
          keyExtractor={(item) => (item as Task).id}
          contentContainerClassName="px-5 pt-4"
          className="py-0"
          ListEmptyComponent={
            <View className="items-center gap-1 py-10">
              <Text className="text-[15px] font-semibold text-muted-foreground">
                Nothing scheduled
              </Text>
              <Text className="text-[13px] text-muted-foreground">
                This day is free.
              </Text>
            </View>
          }
          renderItem={({
            item: rawItem,
            index,
          }: ListRenderItemInfo<unknown>) => {
            const item = rawItem as Task;
            return (
              <View
                className={cn(
                  "overflow-hidden border-x border-border bg-card",
                  index === 0 && "rounded-t-2xl border-t",
                  index === tasks.length - 1 && "rounded-b-2xl border-b",
                  index > 0 && "border-t border-t-border",
                )}
              >
                <TaskListRow
                  task={item}
                  tz={tz}
                  onPress={() => {
                    bottomSheet.close();
                    onSelectTask(item);
                  }}
                />
              </View>
            );
          }}
        />
      </BottomSheetContent>
    </BottomSheet>
  );
});
TaskListSheet.displayName = "TaskListSheet";

const ROW_DOT_CLASSES: Record<TaskCardState, string> = {
  fluid: "bg-brand-orange",
  overdue: "bg-rose-500",
  conflict: "bg-amber-500",
  completed: "bg-emerald-500",
};

const ROW_STATE_LABELS: Record<TaskCardState, string> = {
  fluid: "Auto-scheduled",
  overdue: "Overdue",
  conflict: "Conflict",
  completed: "Completed",
};

/** Sheet subtitle: "5 tasks", plus the mockup's "· all auto-scheduled" tail
 * when nothing on the day is completed/overdue/conflicting. */
function summarize(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks";
  const count = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  return count;
}

function TaskListRow({
  task,
  tz,
  onPress,
}: {
  task: Task;
  tz: string;
  onPress: () => void;
}) {
  const state = deriveState(task);
  const timeLabel = task.scheduledStartTime
    ? format(zonedDate(task.scheduledStartTime, tz), "H:mm")
    : "—";

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-[13px] px-4 py-3.5"
    >
      <Text className="w-[54px] flex-none text-right font-mono text-[15px] text-muted-foreground">
        {timeLabel}
      </Text>
      <View
        className={cn(
          "h-[9px] w-[9px] flex-none rounded-full",
          ROW_DOT_CLASSES[state],
        )}
      />
      <View className="min-w-0 flex-1">
        <Text
          className={cn(
            "text-[15px] font-semibold text-foreground",
            state === "completed" && "line-through",
          )}
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <Text className="mt-0.5 text-[12.5px] text-muted-foreground">
          {ROW_STATE_LABELS[state]} · {task.durationMinutes}m
        </Text>
      </View>
    </Pressable>
  );
}
