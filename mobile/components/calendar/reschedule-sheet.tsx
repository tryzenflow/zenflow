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
import { getSeriesKind } from "@/lib/session-series";
import {
  snapToNearestLaterQuarterHour,
  zonedDate,
  zonedNow,
  zonedWallClockToUtc,
} from "@zenflow/core";
import type { Session, UpdateScope } from "@zenflow/shared";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { View } from "react-native";
import type {
  PendingSessionUpdate,
  UpdateRecurringScope,
} from "./update-recurring-sheet";

export interface RescheduleSheetHandle {
  /** Open the "Move to…" picker for `session`, seeded from its current start
   * (or "now" snapped to the next 15 when it has none). */
  open: (session: Session) => void;
}

interface RescheduleSheetProps {
  tz: string;
  /** Commit the move — a single `PATCH /sessions/:id` (`updateSession`). The
   * sheet awaits this before it teleports/closes. `durationMinutes` carries the
   * (possibly resized) length so the same patch also covers a resize.
   * `scope`/`skipConflicting` are only ever set when `session` belongs to a
   * series and `onRequestScopedUpdate` resolved a choice — plain one-off
   * sessions never pass them. */
  onConfirm: (
    id: string,
    startISO: string,
    durationMinutes: number,
    scope?: UpdateScope,
    skipConflicting?: boolean,
  ) => Promise<void> | void;
  /** Fired once `onConfirm` resolves, with the moved session and its new
   * instant — the calendar screen re-points its focus / refetches / pulses the
   * block from here (the handler the old cross-day-drag drop used to run). */
  onMoved?: (session: Session, startISO: string) => void;
  /** When `session` belongs to a series (`getSeriesKind` !== "none"), defers
   * the commit to the caller's scope-confirmation sheet (`UpdateRecurringSheet`)
   * instead of committing directly. `onResolve(null)` means the user backed
   * out — the sheet stays open, nothing was committed. */
  onRequestScopedUpdate?: (
    session: Session,
    pending: PendingSessionUpdate,
    onResolve: (
      choice: {
        scope: UpdateRecurringScope;
        skipConflicting: boolean;
      } | null,
    ) => void,
  ) => void;
}

const MAX_START_MIN = 23 * 60 + 45;

/**
 * "Move to…" bottom sheet — the replacement for the removed edge-drag
 * cross-day / cross-month mechanic. A long-press on a Day/Week block, or the
 * per-row "Move" button in Month's day sheet, opens this; picking a date +
 * start/end time and confirming issues one `PATCH /sessions/:id`.
 *
 * One `InlineDateField` (native OS date picker, already tz-correct — `value`
 * carries the user-tz wall clock in its local fields) plus a Start/End
 * `TimePickerInline` pair (minutes-of-day, 15-min grid) — Clockify-style: the
 * session may cross midnight (`endMinutes <= startMinutes`), in which case the
 * End picker gets a primary-orange "+1" badge and the length is computed as
 * running into the next day, rather than requiring a second date input. The
 * confirm path rebuilds a wall-clock `Date` from the date + start time and
 * runs it through `zonedWallClockToUtc`, exactly like
 * `lib/session-time.ts`'s `combineToUtc`; the derived `durationMinutes` (End −
 * Start, +24h when it wraps) is what also makes this double as a resize.
 */
export const RescheduleSheet = forwardRef<
  RescheduleSheetHandle,
  RescheduleSheetProps
>(({ tz, onConfirm, onMoved, onRequestScopedUpdate }, ref) => {
  const sheet = useBottomSheet();
  const { confirm } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  // `date` carries the tz wall clock in its local fields (InlineDateField's
  // convention); `startMinutes`/`endMinutes` are minutes-of-day for the two
  // TimePickerInline pickers. `endMinutes <= startMinutes` means the session
  // runs past midnight into the next day (single date input, Clockify-style).
  const [date, setDate] = useState<Date | null>(null);
  const [startMinutes, setStartMinutes] = useState(9 * 60);
  const [endMinutes, setEndMinutes] = useState(10 * 60);
  const [busy, setBusy] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      open: (next) => {
        let seed: Date;
        let startMin: number;
        if (next.scheduledStartTime) {
          seed = zonedDate(next.scheduledStartTime, tz);
          startMin = seed.getHours() * 60 + seed.getMinutes();
        } else {
          seed = zonedNow(tz);
          const snapped = snapToNearestLaterQuarterHour(
            seed.getHours() * 60 + seed.getMinutes(),
          );
          startMin = Math.min(snapped, MAX_START_MIN);
          seed.setHours(0, startMin, 0, 0);
        }
        setSession(next);
        setDate(seed);
        setStartMinutes(startMin);
        // Re-derive End from the session's current length, wrapping past
        // midnight the same way `durationMinutes` below un-derives it.
        setEndMinutes((startMin + next.durationMinutes) % 1440);
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
      Math.floor(startMinutes / 60),
      startMinutes % 60,
      0,
      0,
    );
    return zonedWallClockToUtc(wall, tz).toISOString();
  }, [date, startMinutes, tz]);

  // End on/before Start means the session runs past midnight into the next
  // day (equal treats it as a full 24h session) — the Clockify "+1" case.
  // `date` stays a single input; only the derived length carries the wrap.
  const crossesMidnight = endMinutes <= startMinutes;
  const durationMinutes = crossesMidnight
    ? 1440 - startMinutes + endMinutes
    : endMinutes - startMinutes;

  const commit = async (scope?: UpdateScope, skipConflicting?: boolean) => {
    if (!session || !pickedISO || busy) return;
    setBusy(true);
    try {
      await onConfirm(
        session.id,
        pickedISO,
        durationMinutes,
        scope,
        skipConflicting,
      );
      onMoved?.(session, pickedISO);
      sheet.close();
    } finally {
      setBusy(false);
    }
  };

  // When `session` belongs to a series, defer to the scope-confirmation
  // sheet instead of committing directly — it resolves with a scope/skip
  // choice (proceed) or `null` (cancel: sheet stays open, nothing committed,
  // no revert needed since nothing was optimistically changed here).
  const commitWithScope = () => {
    if (!session || !pickedISO) return;
    const seriesKind = getSeriesKind(session);
    if (seriesKind !== "none" && onRequestScopedUpdate) {
      onRequestScopedUpdate(
        session,
        { scheduledStartTime: pickedISO, durationMinutes },
        (choice) => {
          if (!choice) return;
          void commit(choice.scope, choice.skipConflicting);
        },
      );
      return;
    }
    void commit();
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
          commitWithScope();
        },
      });
      return;
    }
    commitWithScope();
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

          <View>
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

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="mb-1.5 text-[12px] font-semibold text-muted-foreground">
                Start time
              </Text>
              <TimePickerInline
                value={startMinutes}
                onChange={setStartMinutes}
                label="Start time"
              />
            </View>
            <View className="flex-1">
              <Text className="mb-1.5 text-[12px] font-semibold text-muted-foreground">
                End time
                {crossesMidnight && (
                  <View pointerEvents="none" className="absolute ml-1 -top-2">
                    <Text
                      className="text-primary"
                      style={{
                        fontSize: 11,
                        lineHeight: 12,
                        fontWeight: "800",
                      }}
                    >
                      +1
                    </Text>
                  </View>
                )}
              </Text>
              <View className="relative">
                <TimePickerInline
                  value={endMinutes}
                  onChange={setEndMinutes}
                  label="End time"
                />
              </View>
            </View>
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
