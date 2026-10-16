import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { format } from "@/lib/i18n";
import {
  confirmPlacement,
  createSession,
  getSessionDetails,
  undoPlacement,
} from "@/api/tasks";
import {
  MakeRoomSheet,
  type MakeRoomSheetHandle,
} from "@/components/calendar/make-room-sheet";
import { TaskComposer } from "@/components/tasks/composer/task-composer";
import { getPlacementPlan } from "@/lib/make-room";
import { showMovedToast } from "@/lib/move-toast";
import { notifySessionsMutated } from "@/lib/session-cache";
import { useCourseNames } from "@/hooks/use-course-names";
import { DRAFT_NEW, useComposerStore } from "@/lib/composer-store";
import {
  ModalToastScope,
  useModalToast,
} from "@/components/tasks/modal-toast-scope";
import { completeStep } from "@/hooks/use-checklist";
import { useLastCreated } from "@/hooks/use-last-created";
import { useSessionForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import { rememberPlacement } from "@/lib/slot-alternatives";
import { useUploadTracker } from "@/hooks/use-upload-tracker";
import { goToCalendar, safeBack } from "@/lib/nav";
import { warmLandingDay } from "@/lib/warm-day";
import {
  RESCHEDULE_HINT,
  placementToastMessage,
  showErrorToast,
  showDisplacedToast,
  showSplitToast,
  shouldSurfaceRescheduleHint,
  withInfeasibleRetry,
} from "@/lib/task-toasts";
import {
  type SessionFormType,
  type SessionFormValues,
  combineToUtc,
  hhmmToMinutes,
  shiftHhmm,
  splitZoned,
  zonedDate,
} from "@zenflow/core";
import {
  type CreateSessionInput,
  DEFAULT_REMINDER_MINUTES,
  type PlacementPlan,
  type Session,
} from "@zenflow/shared";

import { useLocalSearchParams, useRouter } from "expo-router";
import { sittingMinutes } from "@/lib/split-sittings";
import { useMemo, useRef, useState } from "react";

const DEFAULT_DURATION = 60;
const DEFAULT_SESSION_COUNT = 1;

const EMPTY_DEFAULTS: SessionFormValues = {
  type: "TASK",
  title: "",
  duration: DEFAULT_DURATION,
  sessionCount: DEFAULT_SESSION_COUNT,
  // `duration` is the whole task; the count splits it into equal sittings.
  splitTotal: true,
  tags: [],
  note: "",
  location: "",
  deadline: "",
  reminders: [DEFAULT_REMINDER_MINUTES],
};

function toCreateInput(
  values: SessionFormValues,
  tz: string,
): CreateSessionInput {
  const base = {
    title: values.title,
    note: values.note || null,
    location: values.location || null,
    tags: values.tags,
    // DND blocks carry no reminders.
    ...(values.type === "DND" ? {} : { reminders: values.reminders ?? [] }),
  };
  if (values.type === "TASK") {
    const count = values.splitTotal ? (values.sessionCount ?? 1) : 1;
    const parts = sittingMinutes(values.duration ?? DEFAULT_DURATION, count);
    return {
      ...base,
      type: "TASK",
      // A split task sends the length of one sitting: the series is N of them.
      durationMinutes: parts[0],
      // The series sums to the total; the last sitting takes the remainder.
      ...(parts.length > 1 ? { sessionDurations: parts } : {}),
      deadline: values.deadline as string,
      // Omitted/1 → one ordinary task; >1 → a series (issue #33) — see
      // SessionCountField.
      sessionCount:
        values.sessionCount && values.sessionCount > 1
          ? values.sessionCount
          : undefined,
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
 * "New session" — full screen. A Task | Fixed `SessionTypeTabs` selector sits
 * just below the Title field and switches between a flexible Task and a fixed
 * Assignment / Exam / Lecture / Do-Not-Disturb block. Reached via
 * `router.push` with an optional `start` query param (a true UTC instant — see
 * `initialStart` / `initialDefaults` below).
 */
export default function NewSessionScreen() {
  useLanguage();
  return (
    <ModalToastScope>
      <NewSessionForm />
    </ModalToastScope>
  );
}

function NewSessionForm() {
  useLanguage();
  const { start, deadline, sessions, title } = useLocalSearchParams<{
    start?: string;
    /** UTC ISO instant — pre-selects the deadline (used by the Day/Week
     * block long-press "Add study session before this"). */
    deadline?: string;
    /** Pre-fills the session count when > 1 (same source). */
    sessions?: string;
    /** Pre-fills the title (same source: "Prepare for <session>"). */
    title?: string;
  }>();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useModalToast();

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
    // Pre-fill the user's Settings → Default reminder (0 = none).
    const reminderMinutes =
      user?.defaultReminderMinutes ?? DEFAULT_REMINDER_MINUTES;
    const base: SessionFormValues = {
      ...EMPTY_DEFAULTS,
      reminders: reminderMinutes > 0 ? [reminderMinutes] : [],
    };
    if (deadline) base.deadline = deadline;
    if (title) base.title = title;
    const n = sessions ? Number.parseInt(sessions, 10) : Number.NaN;
    if (Number.isFinite(n) && n > 1) base.sessionCount = n;
    if (start) {
      const { date, startTime } = splitZoned(start, tz);
      base.date = date;
      base.startTime = startTime;
      base.endTime = shiftHhmm(startTime, DEFAULT_DURATION);
    }
    return base;
  }, [start, deadline, sessions, title, tz, user?.defaultReminderMinutes]);

  // A draft from an earlier swipe-down wins over the route prefill.
  const [draft] = useState(() => useComposerStore.getState().drafts[DRAFT_NEW]);
  const form = useSessionForm({ defaultValues: draft ?? initialDefaults });
  const loading = form.formState.isSubmitting;
  const type = form.watch("type");
  const courses = useCourseNames();

  const uploads = useUploadTracker();
  const makeRoom = useRef<MakeRoomSheetHandle>(null);

  async function onSubmit(values: SessionFormValues) {
    if (!user) return;
    const handleCreated = async (
      response: Awaited<ReturnType<typeof createSession>>,
    ) => {
      useComposerStore.getState().clearDraft(DRAFT_NEW);
      void uploads.settle(values.note);
      completeStep("add-task");
      useLastCreated.getState().set(response.id);
      // The block keeps the applied slot and offers "Other time" when the
      // placement proposed one; no sheet opens.
      rememberPlacement(response);
      if (response.scheduledStartTime) {
        await warmLandingDay(response.scheduledStartTime, tz);
      }

      // Toasts fire as the form leaves, so none shows over a form still open.
      showDisplacedToast(toast, response.displacedSessions);
      const { message, variant } = placementToastMessage(response, user);
      showSplitToast(
        toast,
        message,
        variant,
        response.scheduledStartTime ? "calendar-check" : "calendar-plus",
      );
      if (shouldSurfaceRescheduleHint()) {
        toast({
          title: t("Tip"),
          description: t(RESCHEDULE_HINT),
          variant: "tip",
          icon: "lightbulb",
          duration: 6000,
        });
      }
      // Teleport the calendar to where it landed and pulse the new block.
      // A TASK the scheduler couldn't fit before its deadline comes back
      // unscheduled — nothing to jump to, so just pop back.
      if (response.scheduledStartTime) {
        goToCalendar(router, {
          date: response.scheduledStartTime,
          flash: response.id,
        });
      } else {
        safeBack(router);
      }
    };
    // The plan moves a session the user chose: nothing is saved until they
    // pick an action in the Make room sheet (ADR-0022).
    const openMakeRoom = async (plan: PlacementPlan) => {
      const moved = await Promise.all(
        plan.moves.map((move) => getSessionDetails(move.id).catch(() => null)),
      );
      const createLate = async () => {
        try {
          await handleCreated(
            await createSession({
              ...toCreateInput(values, tz),
              infeasiblePolicy: "ACCEPT_LATE_DEADLINE",
            } as Parameters<typeof createSession>[0]),
          );
        } catch (error) {
          const again = getPlacementPlan(error);
          if (again) return openMakeRoom(again);
          showErrorToast(toast, error, t("Couldn't create the session"), "calendar-x");
        }
      };
      makeRoom.current?.open({
        subtitle: t("{title} needs a time. These sessions move to fit it.", {
          title: values.title,
        }),
        plan,
        title: values.title,
        durationMinutes: values.duration ?? DEFAULT_DURATION,
        sessions: moved.filter((s): s is Session => s !== null),
        actions: [
          {
            id: "move",
            label: t("Move it"),
            run: async () => {
              try {
                const confirmed = await confirmPlacement(plan.id);
                // The confirm answers with an undo group: Undo removes the new
                // session and puts the moved ones back.
                if (confirmed.session.scheduledStartTime) {
                  showMovedToast(toast, {
                    to: zonedDate(confirmed.session.scheduledStartTime, tz),
                    withTime: true,
                    onUndo: () =>
                      void undoPlacement(confirmed.undoGroupId)
                        .then(() => notifySessionsMutated())
                        .catch((error) =>
                          showErrorToast(
                            toast,
                            error,
                            t("Couldn't move this session"),
                            "calendar-x",
                          ),
                        ),
                  });
                }
                await handleCreated({
                  ...confirmed.session,
                  displacedSessions: confirmed.displacedSessions,
                  undoGroupId: confirmed.undoGroupId,
                  slotProposalId: null,
                  primarySlot: null,
                  alternativeSlot: null,
                  divergent: false,
                });
              } catch (error) {
                showErrorToast(
                  toast,
                  error,
                  t("The plan changed. Try again."),
                  "calendar-x",
                );
              }
            },
          },
          {
            id: "late",
            label: t("Keep mine and accept late"),
            variant: "outline",
            run: createLate,
          },
          { id: "pick", label: t("Pick another time"), variant: "ghost", run: () => {} },
        ],
      });
    };

    await withInfeasibleRetry(
      toast,
      (infeasiblePolicy) =>
        createSession({
          ...toCreateInput(values, tz),
          ...(infeasiblePolicy ? { infeasiblePolicy } : {}),
        } as Parameters<typeof createSession>[0]),
      handleCreated,
      (error) => {
        const plan = getPlacementPlan(error);
        if (plan) {
          void openMakeRoom(plan);
          return;
        }
        showErrorToast(
          toast,
          error,
          t("Couldn't create the session"),
          "calendar-x",
        );
      },
    );
  }

  function onInvalid(errors: Record<string, { message?: string } | undefined>) {
    const first = Object.values(errors)[0];
    if (first?.message) showSplitToast(toast, String(first.message));
  }

  // A TASK is engine-placed, so a "· starts H:mm" here would be a lie — show
  // just the pressed date. A fixed type keeps the time (it honours the seed).
  const subtitle = !initialStart
    ? t("New session")
    : type === "TASK"
      ? t("From {date}", { date: format(initialStart, "EEEE, MMM d") })
      : t("From {date}, starts {time}", {
          date: format(initialStart, "EEEE, MMM d"),
          time: format(initialStart, "h:mm a"),
        });

  return (
    <>
      <TaskComposer
        mode="create"
        form={form}
        tz={tz}
        title={t("New session")}
        subtitle={subtitle}
        courses={courses}
        busy={loading}
        onNoteUpload={uploads.track}
        onValid={onSubmit}
        onInvalid={onInvalid}
        onDismiss={() => safeBack(router)}
      />
      <MakeRoomSheet ref={makeRoom} tz={tz} />
    </>
  );
}
