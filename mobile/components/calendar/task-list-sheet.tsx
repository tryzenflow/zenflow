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
import type { Session, SessionCardState } from "@zenflow/shared";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import {
  type RefObject,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ListRenderItemInfo, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { MonthDragHandle } from "./month-page";

export interface SessionListSheetHandle {
  /** `drag` is the drag machinery of the `MonthPage` that opened this sheet,
   * so a row dragged out of here reschedules through exactly the same path an
   * in-grid pill drag does. */
  open: (day: Date, tasks: Session[], drag: MonthDragHandle) => void;
}

interface SessionListSheetProps {
  tz: string;
  /** Tapping a row closes the sheet and hands the task back to the screen
   * (`app/(app)/month.tsx` pushes `/task/[id]/edit`). */
  onSelectSession: (task: Session) => void;
}

export const SessionListSheet = forwardRef<
  SessionListSheetHandle,
  SessionListSheetProps
>(({ tz, onSelectSession }, ref) => {
  const bottomSheet = useBottomSheet();
  const [day, setDay] = useState<Date | null>(null);
  const [tasks, setSessions] = useState<Session[]>([]);
  const dragRef = useRef<MonthDragHandle | null>(null);
  // Read inside the pan callbacks, which are built once per row and must not
  // capture the day the sheet happened to be showing on that render.
  const dayRef = useRef<Date | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      open: (nextDay, nextSessions, drag) => {
        setDay(nextDay);
        setSessions(nextSessions);
        dayRef.current = nextDay;
        dragRef.current = drag;
        bottomSheet.open();
      },
    }),
    [bottomSheet],
  );

  /**
   * Long-press-drag on a row: get the sheet out of the way, then hand the
   * gesture to the month page underneath so the finger keeps driving the same
   * ghost / drop-target / reschedule flow as an in-grid pill drag.
   *
   * The sheet is closed with `close()`, NOT `dismiss()` — and the sheet below
   * sets `enableDismissOnClose={false}` to make that distinction real.
   * `dismiss()` unmounts the modal's portaled children, and this row (with the
   * live `GestureDetector` still mid-pan) is one of them: tearing it down on
   * the gesture's own first frame kills the handler, so no further `onUpdate`
   * ever arrives and neither `onEnd` nor `onFinalize` fires — the exact
   * failure mode `MonthPill`'s `hidden` prop documents. `close()` with
   * `enableDismissOnClose={false}` animates the sheet away but leaves it
   * mounted at index -1, so the handler survives the whole drag; a later
   * `present()` re-opens it.
   */
  const handleRowDragStart = (
    task: Session,
    absoluteX: number,
    absoluteY: number,
  ) => {
    const dragDay = dayRef.current;
    if (!dragDay || !dragRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    bottomSheet.ref.current?.close();
    dragRef.current.start(task, dragDay, absoluteX, absoluteY);
  };

  return (
    <BottomSheet>
      <BottomSheetContent
        ref={bottomSheet.ref}
        snapPoints={["70%"]}
        enableDynamicSizing={false}
        // Lets `close()` mean "animate away but stay mounted" — required for
        // drag-out-of-the-sheet to survive the sheet closing. See
        // `handleRowDragStart` above. Trade-off: a swipe-down-to-close now
        // also leaves the modal mounted at index -1 instead of unmounting it
        // (the header's X still calls `dismiss()` and tears it down properly).
        enableDismissOnClose={false}
        // `@gorhom/bottom-sheet`'s backdrop interpolates its opacity between
        // `disappearsOnIndex` and `appearsOnIndex`, and only reaches full
        // strength at the latter. The wrapper in `ui/bottom-sheet.native.tsx`
        // overrides `disappearsOnIndex` to -1 but leaves `appearsOnIndex` at
        // the library default of 1 — fine for a two-snap-point sheet, but this
        // one has a single snap point, so index 0 is fully open and the scrim
        // would sit permanently halfway, reading as a barely-there tint over
        // the month grid. Pinning it to 0 makes the overlay reach full opacity
        // at this sheet's only open position. (No-op on web, where
        // `BottomSheetContent` is the Radix `Dialog` reimplementation and the
        // overlay is a plain `bg-black/50`.)
        backdropProps={{ appearsOnIndex: 0 }}
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
          keyExtractor={(item) => (item as Session).id}
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
            const item = rawItem as Session;
            return (
              <View
                className={cn(
                  "overflow-hidden border-x border-border bg-card",
                  index === 0 && "rounded-t-2xl border-t",
                  index === tasks.length - 1 && "rounded-b-2xl border-b",
                  index > 0 && "border-t border-t-border",
                )}
              >
                <SessionListRow
                  task={item}
                  tz={tz}
                  onPress={() => {
                    bottomSheet.close();
                    onSelectSession(item);
                  }}
                  onDragStart={handleRowDragStart}
                  dragRef={dragRef}
                />
              </View>
            );
          }}
        />
      </BottomSheetContent>
    </BottomSheet>
  );
});
SessionListSheet.displayName = "SessionListSheet";

const ROW_DOT_CLASSES: Record<SessionCardState, string> = {
  fluid: "bg-brand-orange",
  overdue: "bg-rose-500",
  conflict: "bg-amber-500",
  completed: "bg-emerald-500",
};

const ROW_STATE_LABELS: Record<SessionCardState, string> = {
  fluid: "Auto-scheduled",
  overdue: "Overdue",
  conflict: "Conflict",
  completed: "Completed",
};

/** Sheet subtitle: "5 tasks", plus the mockup's "· all auto-scheduled" tail
 * when nothing on the day is completed/overdue/conflicting. */
function summarize(tasks: Session[]): string {
  if (tasks.length === 0) return "No tasks";
  const count = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  return count;
}

function SessionListRow({
  task,
  tz,
  onPress,
  onDragStart,
  dragRef,
}: {
  task: Session;
  tz: string;
  onPress: () => void;
  onDragStart: (task: Session, absoluteX: number, absoluteY: number) => void;
  dragRef: RefObject<MonthDragHandle | null>;
}) {
  const state = deriveState(task);
  const timeLabel = task.scheduledStartTime
    ? format(zonedDate(task.scheduledStartTime, tz), "H:mm")
    : "—";

  // Mirrors `MonthPill`'s gesture exactly — one `Pan` with
  // `activateAfterLongPress` (not a composed long-press + pan), `.runOnJS(true)`
  // so the callbacks can touch `expo-haptics` and React state directly, and
  // every callback read out of a ref at fire time so the gesture object itself
  // is built once. Building it once matters more here than in the grid: this
  // row lives inside `BottomSheetFlatList`, and re-creating a gesture config
  // mid-pan is what react-native-gesture-handler warns about.
  //
  // The 350ms hold is also what keeps this from fighting the two scrollables
  // above it (the sheet's own pan and the list's scroll): neither activates
  // while the finger is stationary, so the long-press wins the race, and once
  // this pan is active it owns the touch.
  const latest = useRef({ task, onDragStart, dragRef });
  latest.current = { task, onDragStart, dragRef };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(350)
        .runOnJS(true)
        .onStart((e) => {
          const c = latest.current;
          c.onDragStart(c.task, e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          latest.current.dragRef.current?.update(e.absoluteX, e.absoluteY);
        })
        .onEnd((e) => {
          latest.current.dragRef.current?.end(e.absoluteX, e.absoluteY);
        })
        // Only `onFinalize` runs when a pan is cancelled rather than released,
        // so the page's drag state has to be cleared here too — otherwise the
        // ghost stays on screen and the pager stays frozen. Same reasoning as
        // `MonthPill`'s `onFinalize`.
        .onFinalize((_e, success) => {
          if (!success) latest.current.dragRef.current?.cancel();
        }),
    [],
  );

  return (
    <GestureDetector gesture={pan}>
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
    </GestureDetector>
  );
}
