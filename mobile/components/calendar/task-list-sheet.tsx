import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFlatList,
  BottomSheetHeader,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import {
  MONTH_PILL_CLASSES,
  MONTH_PILL_TEXT_CLASSES,
  deriveState,
} from "@/lib/task-card";
import { cn } from "@/lib/utils";
import { zonedDate } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { format } from "date-fns";
import { forwardRef, useImperativeHandle, useState } from "react";
import { type ListRenderItemInfo, Pressable, View } from "react-native";

export interface TaskListSheetHandle {
  /** Opens the sheet listing every task for `day` — the "+N more" overflow
   * pill's target, per GitHub issue #21. */
  open: (day: Date, tasks: Task[]) => void;
}

interface TaskListSheetProps {
  tz: string;
  /** Tapping a row closes the sheet and hands the tapped task back to the
   * caller (`app/(app)/month.tsx` navigates to `/task/[id]/edit`). */
  onSelectTask: (task: Task) => void;
}

/**
 * "+N more" overflow bottom sheet — lists every task scheduled on a given
 * day, replacing the desktop `Popover` in
 * `frontend/src/components/calendar/month-cell.tsx` with a thumb-reachable
 * `@gorhom/bottom-sheet` sheet (see `mobile/README.md`'s bottom-sheet
 * pitfalls section for why this goes through `@/components/ui/bottom-sheet`
 * rather than importing gorhom directly). Dismissible via backdrop tap/pan-
 * down/header-X with no side effect — it only ever reads `tasks`, selecting
 * a row is the only action that does anything.
 */
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
          <Text className="text-lg font-bold">
            {day ? format(day, "EEE, MMM d") : ""}
          </Text>
        </BottomSheetHeader>
        <BottomSheetFlatList
          data={tasks}
          keyExtractor={(item) => (item as Task).id}
          contentContainerClassName="gap-2 px-4 py-3"
          renderItem={({ item: rawItem }: ListRenderItemInfo<unknown>) => {
            const item = rawItem as Task;
            return (
              <TaskListRow
                task={item}
                tz={tz}
                onPress={() => {
                  bottomSheet.close();
                  onSelectTask(item);
                }}
              />
            );
          }}
        />
      </BottomSheetContent>
    </BottomSheet>
  );
});
TaskListSheet.displayName = "TaskListSheet";

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
    ? format(zonedDate(task.scheduledStartTime, tz), "h:mm a")
    : "Not yet scheduled";

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-3 rounded-xl border-l-4 border border-border bg-card px-3.5 py-3",
        MONTH_PILL_CLASSES[state],
      )}
    >
      <View className="min-w-0 flex-1">
        <Text
          className={cn(
            "text-[13px] font-semibold text-foreground",
            state === "completed" && "line-through",
          )}
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <Text
          className={cn(
            "mt-0.5 font-mono text-[11px]",
            MONTH_PILL_TEXT_CLASSES[state],
          )}
        >
          {timeLabel}
        </Text>
      </View>
    </Pressable>
  );
}
