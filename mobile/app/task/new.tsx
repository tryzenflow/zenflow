import { createSession } from "@/api/tasks";
import { SessionTypeTabs } from "@/components/tasks/form/session-type-tabs";
import { SessionFormScreen } from "@/components/tasks/task-form-screen";
import { SessionSheetFields } from "@/components/tasks/task-sheet-fields";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useSessionForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import { combineToUtc, shiftHhmm, splitZoned } from "@/lib/session-time";
import {
  RESCHEDULE_HINT,
  placementToastMessage,
  shouldSurfaceRescheduleHint,
} from "@/lib/task-toasts";
import {
  type SessionFormType,
  type SessionFormValues,
  hhmmToMinutes,
  zonedDate,
} from "@zenflow/core";
import type { CreateSessionInput } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";

const DEFAULT_DURATION = 60;

const EMPTY_DEFAULTS: SessionFormValues = {
  type: "TASK",
  title: "",
  duration: DEFAULT_DURATION,
  tags: [],
  note: "",
  deadline: "",
};

function toCreateInput(
  values: SessionFormValues,
  tz: string,
): CreateSessionInput {
  const base = {
    title: values.title,
    note: values.note || null,
    tags: values.tags,
  };
  if (values.type === "TASK") {
    return {
      ...base,
      type: "TASK",
      durationMinutes: values.duration ?? DEFAULT_DURATION,
      deadline: values.deadline as string,
    };
  }

  const durationMinutes =
    hhmmToMinutes(values.endTime as string) -
    hhmmToMinutes(values.startTime as string);
  const scheduledStartTime = combineToUtc(
    values.date as string,
    values.startTime as string,
    tz,
  );

  if (values.type === "DND") {
    return {
      ...base,
      type: "DND",
      durationMinutes,
      scheduledStartTime,
      rrule: values.rrule || null,
    };
  }

  // ASSIGNMENT / EXAM / LECTURE — also recurrable (a weekly lecture).
  return {
    ...base,
    type: values.type,
    durationMinutes,
    scheduledStartTime,
    rrule: values.rrule || null,
  };
}

/**
 * "New session" — full screen. A 3-way `SessionTypeTabs` selector sits just
 * below the Title field and switches between a flexible Task, a fixed
 * Assignment/Exam/Lecture, and a Do-Not-Disturb block. Reached via
 * `router.push` with an optional `start` query param (a true UTC instant — see
 * `initialStart` / `initialDefaults` below).
 */
export default function NewSessionScreen() {
  const { start } = useLocalSearchParams<{ start?: string }>();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();

  // `start` is a real UTC instant — both producers (`create-task-fab.tsx`'s
  // `createSessionAtNowHref` and `day-timeline.tsx`'s grid long-press) emit
  // `zonedWallClockToUtc(...).toISOString()`. `new Date(start)` alone would let
  // `date-fns` `format` print it in the *device* zone; `zonedDate` re-homes the
  // `tz` wall clock into the Date's local fields so the subtitle matches the
  // grid (CLAUDE.md §5 — same as `day-timeline.tsx`).
  const initialStart = useMemo(
    () => (start ? zonedDate(start, tz) : undefined),
    [start, tz],
  );

  // Seed the form's date/time fields from the pressed slot so switching to a
  // fixed type (`switchType` reads `form.getValues("date"|"startTime"|
  // "endTime")`) honours it instead of a hard-coded 09:00. A TASK ignores these
  // (it's always engine-placed — `CreateSessionInput` has no
  // `scheduledStartTime`), but carrying them costs nothing.
  const initialDefaults = useMemo<SessionFormValues>(() => {
    if (!start) return EMPTY_DEFAULTS;
    const { date, startTime } = splitZoned(start, tz);
    return {
      ...EMPTY_DEFAULTS,
      date,
      startTime,
      endTime: shiftHhmm(startTime, DEFAULT_DURATION),
    };
  }, [start, tz]);

  const form = useSessionForm({ defaultValues: initialDefaults });
  const loading = form.formState.isSubmitting;
  const type = form.watch("type");

  function switchType(next: SessionFormType) {
    const common = {
      title: form.getValues("title"),
      note: form.getValues("note"),
      tags: form.getValues("tags"),
    };
    form.reset(
      next === "TASK"
        ? {
            ...common,
            type: "TASK",
            duration: form.getValues("duration") ?? DEFAULT_DURATION,
            deadline: form.getValues("deadline") ?? "",
          }
        : {
            ...common,
            type: next,
            date: form.getValues("date"),
            startTime: form.getValues("startTime") ?? "09:00",
            endTime: form.getValues("endTime") ?? "10:00",
            rrule: form.getValues("rrule"),
          },
    );
  }

  async function onSubmit(values: SessionFormValues) {
    if (!user) return;
    try {
      const response = await createSession(toCreateInput(values, tz));
      const { message, variant } = placementToastMessage(response, user);
      toast(message, variant === "success" ? "success" : "destructive");
      if (shouldSurfaceRescheduleHint()) {
        toast("Tip", "tip", 6000, "top", false, undefined, {
          description: RESCHEDULE_HINT,
        });
      }
      // Teleport the calendar to where it landed and pulse the new block.
      // A TASK the scheduler couldn't fit before its deadline comes back
      // unscheduled — nothing to jump to, so just pop back.
      if (response.scheduledStartTime) {
        router.replace({
          pathname: "/",
          params: {
            date: response.scheduledStartTime,
            flash: response.id,
          },
        } as Href);
      } else {
        router.back();
      }
    } catch (error) {
      const message =
        (isAxiosError(error) &&
          (error.response?.data as { message?: string } | undefined)
            ?.message) ||
        "Something went wrong when creating the session";
      toast(message, "destructive");
    }
  }

  function onInvalid(errors: Record<string, { message?: string } | undefined>) {
    const first = Object.values(errors)[0];
    if (first?.message) toast(String(first.message), "destructive");
  }

  // A TASK is engine-placed, so a "· starts H:mm" here would be a lie — show
  // just the pressed date. A fixed type keeps the time (it honours the seed).
  const subtitle = !initialStart
    ? "New session"
    : type === "TASK"
      ? format(initialStart, "EEEE, MMM d")
      : `${format(initialStart, "EEEE, MMM d")} · starts ${format(
          initialStart,
          "h:mm a",
        )}`;

  return (
    <SessionFormScreen
      title="New session"
      subtitle={subtitle}
      footer={
        <Button
          className="h-[52px] w-full"
          disabled={loading}
          onPress={form.handleSubmit(onSubmit, onInvalid)}
        >
          <Text className="text-base font-semibold text-foreground">
            {loading ? "Adding…" : "Add session"}
          </Text>
        </Button>
      }
    >
      <SessionSheetFields
        form={form}
        tz={tz}
        disabled={loading}
        typeSelector={
          <SessionTypeTabs
            value={type}
            onChange={switchType}
            disabled={loading}
          />
        }
      />
    </SessionFormScreen>
  );
}
