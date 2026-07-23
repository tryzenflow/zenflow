import { resizeTask } from "@/api/tasks";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFooter,
  BottomSheetScrollView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import type { BottomSheetFooterProps } from "@gorhom/bottom-sheet";
import { formatMinutes, zonedDate } from "@zenflow/core";
import { DAILY_HORIZON, SLOT_MINUTES } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { addMinutes, format } from "date-fns";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { View } from "react-native";
import { DurationSlider } from "./form/duration-slider";

/**
 * Round a minute value up to the nearest `SLOT_MINUTES` multiple.
 */
function roundUpToSlot(minutes: number): number {
  const remainder = minutes % SLOT_MINUTES;
  return remainder === 0 ? minutes : minutes + (SLOT_MINUTES - remainder);
}

type ResizableTask = {
  id: string;
  title: string;
  durationMinutes: number;
  scheduledStartTime: string | null;
};

export type ChangeDurationSheetHandle = {
  open: (task: ResizableTask) => void;
};

/**
 * `ChangeDurationSheet` — the long-press-a-task-block gesture's target
 * (RN migration Phase 5 / GitHub issue #20), replacing the web's tiny
 * top/bottom drag-resize handles (`docs/react-native-migration.md` Phase 2's
 * "Resize task" row) with a slider sheet: current-duration readout, a
 * shrink/grow delta badge, a 15-min-step slider, and a "Done" button.
 * Start time is pinned (bottom-edge-only resize, matching
 * `mockups/task-sheets.html`'s "Ends 11:15 AM" / "Ends 11:45 AM" captions);
 * `PATCH /tasks/:id/resize` is called with the task's unchanged
 * `scheduledStartTime` + the new duration.
 *
 * Imperative-handle controlled (`ref.current.open(task)`) — see
 * `create-task-sheet.tsx`'s doc comment for why: the old external
 * `task`/`open` prop pair drove `present()` from a `useEffect`, one render
 * tick after the long-press handler that should have opened it, unlike
 * every other working sheet (`useBottomSheet().open()` called synchronously
 * inside the press handler).
 *
 * Slider upper bound (open question from the issue): rather than a fixed
 * ~90-min ceiling, the max always extends at least 2 hours past whatever
 * duration the task started this sheet at (and never below a 3-hour floor),
 * so growing a task is never capped by where it happened to start — see
 * `upperBound` below.
 */
export const ChangeDurationSheet = forwardRef<
  ChangeDurationSheetHandle,
  { onResized: () => void }
>(function ChangeDurationSheet({ onResized }, ref) {
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const bottomSheet = useBottomSheet();
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);
  const [initialDuration, setInitialDuration] = useState(60);
  // Keeps rendering the last real task while the sheet animates closed,
  // instead of swapping to a differently-shaped tree mid-close (which would
  // unmount/remount `BottomSheetContent` and cut the close animation short).
  const [displayTask, setDisplayTask] = useState<ResizableTask | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      open: (task: ResizableTask) => {
        setDisplayTask(task);
        setDuration(task.durationMinutes);
        setInitialDuration(task.durationMinutes);
        bottomSheet.open();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const upperBound = Math.min(
    DAILY_HORIZON,
    Math.max(180, roundUpToSlot(initialDuration + 120)),
  );

  async function onDone() {
    if (!displayTask) {
      bottomSheet.close();
      return;
    }
    if (
      duration === displayTask.durationMinutes ||
      !displayTask.scheduledStartTime
    ) {
      bottomSheet.close();
      return;
    }
    setSaving(true);
    try {
      await resizeTask(
        displayTask.id,
        displayTask.scheduledStartTime,
        duration,
      );
      onResized();
      bottomSheet.close();
    } catch (error) {
      const message =
        (isAxiosError(error) &&
          (error.response?.data as { message?: string } | undefined)
            ?.message) ||
        "Failed to change duration";
      toast(message, "destructive");
    } finally {
      setSaving(false);
    }
  }

  const renderFooter = useCallback(
    (footerProps: BottomSheetFooterProps) => (
      <BottomSheetFooter bottomSheetFooterProps={footerProps}>
        <Button className="h-[52px] w-full" disabled={saving} onPress={onDone}>
          <Text className="text-base font-semibold text-primary-foreground">
            {saving ? "Saving…" : "Done"}
          </Text>
        </Button>
      </BottomSheetFooter>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saving, displayTask, duration],
  );

  if (!displayTask) {
    return (
      <BottomSheet>
        <BottomSheetContent ref={bottomSheet.ref}>
          <View />
        </BottomSheetContent>
      </BottomSheet>
    );
  }

  const delta = duration - displayTask.durationMinutes;
  const endsAt = displayTask.scheduledStartTime
    ? addMinutes(zonedDate(displayTask.scheduledStartTime, tz), duration)
    : null;

  return (
    <BottomSheet>
      <BottomSheetContent
        ref={bottomSheet.ref}
        enableDynamicSizing={false}
        snapPoints={["55%"]}
        footerComponent={renderFooter}
      >
        <BottomSheetScrollView className="px-5 pt-1">
          <Text className="text-[19px] font-bold tracking-tight">
            Change duration
          </Text>
          <Text className="mt-[3px] text-[13px] text-muted-foreground">
            {displayTask.title} · was{" "}
            {formatMinutes(displayTask.durationMinutes)}
          </Text>

          <View className="my-2 mb-[18px] flex-row items-center justify-center gap-2">
            <Text className="text-center text-[34px] font-bold tracking-tight tabular-nums">
              {formatMinutes(duration)}
            </Text>
            {delta !== 0 && (
              <View
                className={cn(
                  "rounded-full px-2 py-0.5",
                  delta > 0 ? "bg-primary" : "bg-rose-500",
                )}
              >
                <Text className="text-[12px] font-bold text-white">
                  {delta > 0 ? "+" : "−"}
                  {formatMinutes(Math.abs(delta))}
                </Text>
              </View>
            )}
          </View>

          <DurationSlider
            min={SLOT_MINUTES}
            max={upperBound}
            step={SLOT_MINUTES}
            value={duration}
            onChange={setDuration}
          />

          <Text className="mt-3.5 text-center text-[12.5px] leading-snug text-muted-foreground">
            {endsAt ? `Ends ${format(endsAt, "h:mm a")} · ` : ""}
            {delta === 0
              ? "Drag the slider either direction"
              : delta > 0
                ? `grown from ${formatMinutes(displayTask.durationMinutes)}`
                : `shrunk from ${formatMinutes(displayTask.durationMinutes)}`}
          </Text>
        </BottomSheetScrollView>
      </BottomSheetContent>
    </BottomSheet>
  );
});
