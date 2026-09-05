import {
  getSessionDetails,
  removeSeriesFrom,
  removeSession,
  removeSessionSeries,
  truncateSessionSeries,
  updateSession,
} from "@/api/tasks";
import { Trash2 } from "@/components/Icons";
import {
  type DeleteRecurringScope,
  DeleteRecurringSheet,
  type DeleteRecurringSheetHandle,
} from "@/components/tasks/delete-recurring-sheet";
import { SessionFormScreen } from "@/components/tasks/task-form-screen";
import { SessionSheetFields } from "@/components/tasks/task-sheet-fields";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useSessionForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import { isSessionPastDeadline } from "@/lib/overdue";
import { getSeriesKind } from "@/lib/session-series";
import {
  RESCHEDULE_HINT,
  shouldSurfaceRescheduleHint,
  showErrorToast,
  showSplitToast,
} from "@/lib/task-toasts";
import {
  type EditSessionFormValues,
  type SessionFormType,
  hhmmToMinutes,
  zonedDate,
  zonedWallClockToUtc,
} from "@zenflow/core";
import type { Session, UpdateSessionInput } from "@zenflow/shared";
import { format } from "date-fns";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

const EMPTY_DEFAULTS: EditSessionFormValues = {
  type: "TASK",
  title: "",
  duration: 60,
  tags: [],
  note: "",
  deadline: "",
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "Edit session" — full screen. `type` is fixed at create time and shown
 * read-only; the mutable fields depend on it (TASK → deadline only — its
 * duration is resized from the calendar's "Move to…" sheet; fixed / DND →
 * date + start/end time, DND also recurrence).
 */
export default function EditSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const [task, setSession] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteScopeSheet = useRef<DeleteRecurringSheetHandle>(null);

  const form = useSessionForm({ defaultValues: EMPTY_DEFAULTS });
  const loading = !task || form.formState.isSubmitting || deleting;

  // Warn when the deadline being picked falls *before* where the engine has
  // already scheduled this TASK — saving it would leave the session starting
  // past its own due time (the edit-form mirror of the calendar's
  // "schedule after the deadline?" drag guard). Recomputed as the user picks
  // chips via `form.watch`.
  const pendingDeadline = form.watch("deadline");
  const deadlinePastStart =
    !!task &&
    task.type === "TASK" &&
    isSessionPastDeadline({
      scheduledStartTime: task.scheduledStartTime,
      deadline: pendingDeadline,
    });

  useEffect(() => {
    getSessionDetails(id)
      .then((res) => {
        setSession(res);
        const common = {
          type: res.type as SessionFormType,
          title: res.title,
          tags: res.tags,
          note: res.note ?? "",
        };
        if (res.type === "TASK") {
          form.reset({
            ...common,
            duration: res.durationMinutes,
            deadline: res.deadline ?? "",
          });
        } else {
          const start = res.scheduledStartTime
            ? zonedDate(res.scheduledStartTime, tz)
            : null;
          const startMin = start
            ? start.getHours() * 60 + start.getMinutes()
            : 9 * 60;
          const endMin = startMin + res.durationMinutes;
          form.reset({
            ...common,
            date: start ? format(start, "yyyy-MM-dd") : "",
            startTime: `${pad(Math.floor(startMin / 60))}:${pad(
              startMin % 60,
            )}`,
            endTime: `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`,
            rrule: res.rrule ?? undefined,
          });
        }
      })
      .catch((error) => {
        showErrorToast(toast, error, "Couldn't open this session");
        router.back();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: EditSessionFormValues) {
    if (!user || !task) return;
    const patch: UpdateSessionInput = {
      title: values.title,
      note: values.note || null,
      tags: values.tags,
    };
    if (values.type === "TASK") {
      // Duration (resize) is owned by the calendar's "Move to…" sheet now —
      // the edit form only touches a TASK's deadline.
      patch.deadline = values.deadline;
    } else if (values.date && values.startTime && values.endTime) {
      const [y, mo, d] = values.date.split("-").map(Number);
      const [h, mi] = values.startTime.split(":").map(Number);
      patch.scheduledStartTime = zonedWallClockToUtc(
        new Date(y, mo - 1, d, h, mi, 0, 0),
        tz,
      ).toISOString();
      patch.durationMinutes =
        hhmmToMinutes(values.endTime) - hhmmToMinutes(values.startTime);
      // Recurrence edits are whole-series (any fixed type). On a recurring
      // occurrence, `task.id` is the "<seriesId>::<start>" ref — the backend
      // routes the patch to the series' representative row.
      patch.rrule = values.rrule || null;
    }

    try {
      const updated = await updateSession(task.id, patch);
      toast("Session updated", "success");
      if (isSessionPastDeadline(updated)) {
        toast(
          "This session is now scheduled after its deadline.",
          "warning",
          5000,
        );
      } else if (shouldSurfaceRescheduleHint()) {
        toast("Tip", "tip", 6000, "top", false, undefined, {
          description: RESCHEDULE_HINT,
        });
      }
      // Jump the calendar to the (possibly new) time and pulse the block.
      if (updated.scheduledStartTime) {
        router.replace({
          pathname: "/",
          params: { date: updated.scheduledStartTime, flash: updated.id },
        } as Href);
      } else {
        router.back();
      }
    } catch (error) {
      showErrorToast(toast, error, "Failed to update the session");
    }
  }

  function onInvalid(errors: Record<string, { message?: string } | undefined>) {
    const first = Object.values(errors)[0];
    if (first?.message) showSplitToast(toast, String(first.message));
  }

  async function runDelete(scope: DeleteRecurringScope) {
    if (!task) return;
    const seriesKind = getSeriesKind(task);
    setDeleting(true);
    try {
      if (scope === "series" && task.seriesId) {
        // Generic — works for both a recurring (rrule) series and a
        // materialized TASK series.
        await removeSessionSeries(task.seriesId);
      } else if (
        scope === "following" &&
        task.seriesId &&
        seriesKind === "recurring" &&
        task.scheduledStartTime
      ) {
        await truncateSessionSeries(task.seriesId, task.scheduledStartTime);
      } else if (
        scope === "following" &&
        task.seriesId &&
        seriesKind === "task"
      ) {
        // `task.id` is already a plain session id for a materialized TASK
        // sitting (no occurrence-ref parsing needed).
        await removeSeriesFrom(task.seriesId, task.id);
      } else {
        // "occurrence": for a recurring session `task.id` is
        // "<seriesId>::<start>" and the backend drops just that date; for a
        // TASK sitting or a one-off it's a plain delete.
        await removeSession(task.id);
      }
      toast(
        scope === "series"
          ? "Series deleted"
          : scope === "following"
            ? seriesKind === "task"
              ? "This and later sittings removed"
              : "This and later occurrences removed"
            : "Session deleted",
        "success",
      );
      router.back();
    } catch (error) {
      showErrorToast(toast, error, "Failed to delete the session");
    } finally {
      setDeleting(false);
    }
  }

  function onDelete() {
    if (!task) return;
    const seriesKind = getSeriesKind(task);
    if (seriesKind === "none") {
      void runDelete("occurrence");
      return;
    }
    const occurrenceDate = task.scheduledStartTime
      ? zonedDate(task.scheduledStartTime, tz)
      : new Date();
    deleteScopeSheet.current?.open(occurrenceDate);
  }

  return (
    <SessionFormScreen
      title="Edit session"
      subtitle={
        task
          ? `Created ${format(new Date(task.createdAt), "MMM d")}`
          : undefined
      }
      headerRight={
        <Pressable
          disabled={loading}
          onPress={onDelete}
          className="flex-row items-center gap-1.5"
          accessibilityLabel="Delete session"
        >
          <Trash2 size={15} className="text-destructive" />
          <Text className="text-[13px] font-semibold text-destructive">
            Delete
          </Text>
        </Pressable>
      }
      footer={
        <Button
          className="h-[52px] w-full"
          disabled={loading}
          onPress={form.handleSubmit(onSubmit, onInvalid)}
        >
          <Text className="text-base font-semibold text-foreground">
            {loading ? "Saving…" : "Save changes"}
          </Text>
        </Button>
      }
    >
      {task ? (
        <SessionSheetFields
          initialValue={task.note || ""}
          form={form}
          tz={tz}
          disabled={loading}
          editing
          deadlineWarning={
            deadlinePastStart
              ? "Earlier than this session's scheduled start — it'll be marked late."
              : undefined
          }
        />
      ) : (
        <View className="items-center py-16">
          <ActivityIndicator />
          <Text className="mt-3 text-sm text-muted-foreground">
            Loading session…
          </Text>
        </View>
      )}

      <DeleteRecurringSheet
        ref={deleteScopeSheet}
        kind={task && getSeriesKind(task) === "task" ? "task" : "recurring"}
        onChoose={runDelete}
      />
    </SessionFormScreen>
  );
}
