import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { format } from "@/lib/i18n";
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
import { SessionView } from "@/components/tasks/session-view";
import { SessionSheetFields } from "@/components/tasks/task-sheet-fields";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import {
  ModalToastScope,
  useModalToast,
} from "@/components/tasks/modal-toast-scope";
import { useSessionForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import { setPendingSlotPick } from "@/lib/pending-slot-pick";
import { divergentSittings } from "@/lib/series-alternatives";
import { isSessionPastDeadline } from "@/lib/overdue";
import {
  RESCHEDULE_HINT,
  shouldSurfaceRescheduleHint,
  showDisplacedToast,
  showErrorToast,
  showSplitToast,
  withInfeasibleRetry,
} from "@/lib/task-toasts";
import {
  type EditSessionFormValues,
  type SessionFormType,
  getSeriesKind,
  hhmmToMinutes,
  zonedDate,
  zonedWallClockToUtc,
} from "@zenflow/core";
import type { Session, UpdateSessionInput } from "@zenflow/shared";

import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

const EMPTY_DEFAULTS: EditSessionFormValues = {
  type: "TASK",
  title: "",
  duration: 60,
  tags: [],
  note: "",
  location: "",
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
  useLanguage();
  return (
    <ModalToastScope>
      <EditSessionForm />
    </ModalToastScope>
  );
}

function EditSessionForm() {
  useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useModalToast();
  const [task, setSession] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Opens as a read-only page; the header switch flips into the edit form.
  const [editing, setEditing] = useState(false);
  const deleteScopeSheet = useRef<DeleteRecurringSheetHandle>(null);

  const form = useSessionForm({ defaultValues: EMPTY_DEFAULTS });
  const loading = !task || form.formState.isSubmitting || deleting;

  useEffect(() => {
    getSessionDetails(id)
      .then((res) => {
        setSession(res);
        const common = {
          type: res.type as SessionFormType,
          title: res.title,
          tags: res.tags,
          reminders: res.reminders ?? [],
          note: res.note ?? "",
          location: res.location ?? "",
        };
        if (res.type === "TASK") {
          form.reset({
            ...common,
            duration: res.durationMinutes,
            deadline: res.deadline ?? "",
            sessionCount: res.sessionTotal ?? 1,
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
        showErrorToast(
          toast,
          error,
          t("Couldn't open this session"),
          "calendar-x",
        );
        router.back();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: EditSessionFormValues) {
    if (!user || !task) return;
    const patch: UpdateSessionInput = {
      title: values.title,
      note: values.note || null,
      location: values.location || null,
      tags: values.tags,
    };
    if (values.type !== "DND") patch.reminders = values.reminders ?? [];
    if (values.type === "TASK") {
      // Duration (resize) is owned by the calendar's "Move to…" sheet now —
      // the edit form only touches a TASK's deadline and, now, its session
      // count (grow/shrink the series).
      patch.deadline = values.deadline;
      if (values.sessionCount != null) {
        patch.sessionCount = values.sessionCount;
      }
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

    const handleUpdated = (
      updated: Awaited<ReturnType<typeof updateSession>>,
    ) => {
      // Handle divergent response — hand the primary-vs-alternative pick off
      // to the week view, which owns the slot-pick sheet and presents it over
      // the calendar (`useFocusEffect`, app/(app)/index.tsx).
      if (
        updated.divergent &&
        updated.slotProposalId &&
        updated.primarySlot &&
        updated.alternativeSlot
      ) {
        setPendingSlotPick({
          kind: "single",
          session: updated,
          primarySlot: updated.primarySlot,
          alternativeSlot: updated.alternativeSlot,
          slotProposalId: updated.slotProposalId,
          tz,
        });
        router.replace({
          pathname: "/",
          params: { date: updated.primarySlot, flash: updated.id },
        } as Href);
        return;
      }

      // A redistributed series (#59): same shape as the create path, the
      // per-sitting divergence is on `sessions[]` and nothing at the top level.
      const series = divergentSittings(updated.sessions);
      if (series.length > 0) {
        setPendingSlotPick({
          kind: "series",
          title: updated.title,
          sittings: series,
          tz,
        });
        router.replace({
          pathname: "/",
          params: { date: series[0].primarySlot, flash: series[0].session.id },
        } as Href);
        return;
      }

      showDisplacedToast(toast, updated.displacedSessions);
      toast({
        title: t("Session updated"),
        variant: "success",
        icon: "calendar-check",
      });
      if (isSessionPastDeadline(updated)) {
        toast({
          title: t("Scheduled after deadline"),
          description: t("This session now ends past its due time."),
          variant: "warning",
          icon: "calendar-clock",
          duration: 5000,
        });
      } else if (shouldSurfaceRescheduleHint()) {
        toast({
          title: t("Tip"),
          description: t(RESCHEDULE_HINT),
          variant: "tip",
          icon: "lightbulb",
          duration: 6000,
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
    };
    await withInfeasibleRetry(
      toast,
      (infeasiblePolicy) =>
        updateSession(
          task.id,
          infeasiblePolicy ? { ...patch, infeasiblePolicy } : patch,
        ),
      handleUpdated,
      (error) =>
        showErrorToast(
          toast,
          error,
          t("Couldn't update session"),
          "calendar-x",
        ),
    );
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
          ? t("Series deleted")
          : scope === "following"
            ? seriesKind === "task"
              ? t("This and later sittings removed")
              : t("This and later occurrences removed")
            : t("Session deleted"),
        "success",
        { icon: "trash" },
      );
      router.back();
    } catch (error) {
      showErrorToast(toast, error, t("Couldn't delete session"), "trash");
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
      title={editing ? t("Edit session") : t("Session details")}
      editSwitch={
        task ? { value: editing, onValueChange: setEditing } : undefined
      }
      subtitle={
        task
          ? t("Created {date}", {
              date: format(new Date(task.createdAt), "MMM d"),
            })
          : undefined
      }
      headerRight={
        <Pressable
          disabled={loading}
          onPress={onDelete}
          className="h-10 w-10 items-center justify-center rounded-full bg-destructive/15"
          accessibilityLabel={t("Delete session")}
        >
          <Trash2 size={20} className="text-destructive" />
        </Pressable>
      }
      footer={
        editing ? (
          <Button
            className="h-[52px] w-full"
            disabled={loading}
            onPress={form.handleSubmit(onSubmit, onInvalid)}
          >
            <Text className="text-base font-semibold text-primary-foreground">
              {loading ? t("Saving…") : t("Save changes")}
            </Text>
          </Button>
        ) : undefined
      }
    >
      {task && !editing ? (
        <SessionView task={task} values={form.watch()} tz={tz} />
      ) : task ? (
        <SessionSheetFields
          initialValue={form.getValues("note") ?? task.note ?? ""}
          form={form}
          tz={tz}
          disabled={loading}
          editing
          editingInstance={{
            scheduledStartTime: task.scheduledStartTime,
            durationMinutes: task.durationMinutes,
          }}
        />
      ) : (
        <View className="items-center py-16">
          <ActivityIndicator />
          <Text className="mt-3 text-sm text-muted-foreground">
            {t("Loading session…")}
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
