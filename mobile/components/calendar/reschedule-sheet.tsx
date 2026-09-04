import { DurationStepper } from "@/components/tasks/form/duration-stepper";
import { InlineDateField } from "@/components/tasks/form/inline-date-field";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TimePickerInline } from "@/components/ui/time-picker";
import { useToast } from "@/components/ui/toast";
import { isPastDeadlineDrop } from "@/lib/overdue";
import {
  snapToNearestLaterQuarterHour,
  zonedDate,
  zonedNow,
  zonedWallClockToUtc,
} from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { View } from "react-native";

export interface RescheduleSheetHandle {
  /** Open the "Move to…" picker for `session`, seeded from its current start
   * (or "now" snapped to the next 15 when it has none). */
  open: (session: Session) => void;
}

interface RescheduleSheetProps {
  tz: string;
  /** Commit the move — a single `PATCH /sessions/:id` (`updateSession`). The
   * sheet awaits this before it teleports/closes. `durationMinutes` carries the
   * (possibly resized) length so the same patch also covers a resize. */
  onConfirm: (
    id: string,
    startISO: string,
    durationMinutes: number,
  ) => Promise<void> | void;
  /** Fired once `onConfirm` resolves, with the moved session and its new
   * instant — the calendar screen re-points its focus / refetches / pulses the
   * block from here (the handler the old cross-day-drag drop used to run). */
  onMoved?: (session: Session, startISO: string) => void;
}

const MAX_START_MIN = 23 * 60 + 45;

/**
 * "Move to…" bottom sheet — the replacement for the removed edge-drag
 * cross-day / cross-month mechanic. A long-press on a Day/Week block, or the
 * per-row "Move" button in Month's day sheet, opens this; picking a date + time
 * and confirming issues one `PATCH /sessions/:id`.
 *
 * Reuses the form primitives verbatim: `InlineDateField` (native OS date
 * picker, already tz-correct — `value` carries the user-tz wall clock in its
 * local fields) and `TimePickerInline` (minutes-of-day, 15-min grid). The
 * confirm path rebuilds a wall-clock `Date` from those two and runs it through
 * `zonedWallClockToUtc`, exactly like `lib/session-time.ts`'s `combineToUtc`.
 */
export const RescheduleSheet = forwardRef<
  RescheduleSheetHandle,
  RescheduleSheetProps
>(({ tz, onConfirm, onMoved }, ref) => {
  const sheet = useBottomSheet();
  const { confirm } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  // `date` carries the tz wall clock in its local fields (InlineDateField's
  // convention); `minutes` is minutes-of-day for TimePickerInline.
  const [date, setDate] = useState<Date | null>(null);
  const [minutes, setMinutes] = useState(9 * 60);
  // Session length, in minutes — seeded from the session on open, adjustable
  // here so "Move to…" doubles as a resize.
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [busy, setBusy] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      open: (next) => {
        let seed: Date;
        if (next.scheduledStartTime) {
          seed = zonedDate(next.scheduledStartTime, tz);
        } else {
          seed = zonedNow(tz);
          const snapped = snapToNearestLaterQuarterHour(
            seed.getHours() * 60 + seed.getMinutes(),
          );
          seed.setHours(0, Math.min(snapped, MAX_START_MIN), 0, 0);
        }
        setSession(next);
        setDate(seed);
        setMinutes(seed.getHours() * 60 + seed.getMinutes());
        setDurationMinutes(next.durationMinutes);
        setBusy(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        sheet.open();
      },
    }),
    [tz, sheet],
  );

  const minDate = useMemo(() => zonedNow(tz), [tz]);

  const pickedISO = useMemo(() => {
    if (!date) return null;
    const wall = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      Math.floor(minutes / 60),
      minutes % 60,
      0,
      0,
    );
    return zonedWallClockToUtc(wall, tz).toISOString();
  }, [date, minutes, tz]);

  const commit = async () => {
    if (!session || !pickedISO || busy) return;
    setBusy(true);
    try {
      await onConfirm(session.id, pickedISO, durationMinutes);
      onMoved?.(session, pickedISO);
      sheet.close();
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = () => {
    if (!session || !pickedISO) return;
    // Same past-deadline guard the day/month drag drops use — a TASK dropped
    // past its own due time is almost always a slip.
    if (
      session.type === "TASK" &&
      isPastDeadlineDrop(pickedISO, session.deadline)
    ) {
      confirm("Schedule after the deadline?", {
        description: "This session will start past its due time.",
        confirmLabel: "Schedule anyway",
        cancelLabel: "Cancel",
        onConfirm: () => {
          void commit();
        },
      });
      return;
    }
    void commit();
  };

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref}>
        <BottomSheetView hadHeader={false} className="gap-4 pt-2">
          <View className="min-w-0">
            <Text className="text-[19px] font-bold tracking-tight">
              Move session
            </Text>
            <Text
              numberOfLines={1}
              className="mt-[3px] text-[13px] text-muted-foreground"
            >
              {session?.title ?? ""}
              {date ? ` · ${format(date, "EEE, MMM d")}` : ""}
            </Text>
          </View>

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="mb-1.5 text-[12px] font-semibold text-muted-foreground">
                Date
              </Text>
              <InlineDateField
                value={date ?? undefined}
                onChange={setDate}
                tz={tz}
                minDate={minDate}
                unboundedFuture
              />
            </View>
            <View className="flex-1">
              <Text className="mb-1.5 text-[12px] font-semibold text-muted-foreground">
                Start time
              </Text>
              <TimePickerInline
                value={minutes}
                onChange={setMinutes}
                label="Start time"
              />
            </View>
          </View>

          <View>
            <Text className="mb-1.5 text-[12px] font-semibold text-muted-foreground">
              Duration
            </Text>
            <DurationStepper
              value={durationMinutes}
              onChange={setDurationMinutes}
              disabled={busy}
            />
          </View>

          <Button
            className="h-[52px] w-full"
            disabled={busy || !pickedISO}
            onPress={handleConfirm}
          >
            <Text className="text-base font-semibold text-primary-foreground">
              {busy ? "Moving…" : "Move"}
            </Text>
          </Button>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
});

RescheduleSheet.displayName = "RescheduleSheet";
