import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSessionForm } from "@/hooks/use-task-form";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isAxiosError } from "axios";
import { errorToast } from "@/lib/toast";
import { postData } from "@/api";
import { useUserStore } from "@/hooks/use-user-store";
import type { Session } from "@/types/tasks";
import type { UpdateSessionInput } from "@zenflow/shared";
import { EditSessionFormValues, deleteSession } from "@/utils/tasks";
import { getSeriesKind, hhmmToMinutes } from "@zenflow/core";
import { zonedDate, zonedWallClockToUtc } from "@/utils/tz";
import { SessionForm } from "./form/task-form";
import {
  DeleteRecurringDialog,
  type DeleteRecurringScope,
} from "./delete-recurring-dialog";
import { SESSION_TYPE_META } from "@zenflow/core";
import { sessionTypeIcon } from "@/components/calendar/session-type-badge";
import {
  getSessionDetails,
  removeSeriesFrom,
  removeSessionSeries,
  truncateSessionSeries,
  updateSession,
} from "@/api/tasks";
import { Clock, Trash2 } from "lucide-react";
import { useFilesTracker } from "@/hooks/use-files-tracker";

interface EditSessionDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  taskId: string;
  onSaved: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function EditSessionDialog({
  open,
  setOpen,
  taskId,
  onSaved,
}: EditSessionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [task, setSession] = useState<Session | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { newUploadsRef } = useFilesTracker();

  const seriesKind = task ? getSeriesKind(task) : "none";

  useEffect(() => {
    if (!open) return;
    getSessionDetails(taskId).then(setSession);
  }, [taskId, open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail === taskId) {
        getSessionDetails(taskId).then(setSession);
      }
    };
    window.addEventListener("zenflow:task-updated", handler);
    return () => window.removeEventListener("zenflow:task-updated", handler);
  }, [taskId, open]);

  const form = useSessionForm({
    defaultValues: {
      type: "TASK",
      title: "",
      duration: 60,
      tags: [],
      note: "",
      location: "",
      deadline: "",
    },
  });

  useEffect(() => {
    if (!task) return;
    const common = {
      type: task.type,
      title: task.title,
      tags: task.tags,
      note: task.note ?? "",
      location: task.location ?? "",
    };
    if (task.type === "TASK") {
      form.reset({
        ...common,
        duration: task.durationMinutes,
        deadline: task.deadline ?? "",
      });
    } else {
      const start = task.scheduledStartTime
        ? zonedDate(task.scheduledStartTime, tz)
        : null;
      const startMin = start
        ? start.getHours() * 60 + start.getMinutes()
        : 9 * 60;
      const endMin = startMin + task.durationMinutes;
      form.reset({
        ...common,
        date: start ? format(start, "yyyy-MM-dd") : "",
        startTime: `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`,
        endTime: `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`,
        rrule: task.rrule ?? undefined,
      });
    }
  }, [task, form, tz]);

  async function onSubmit(values: EditSessionFormValues) {
    if (!user || !task) return;
    setLoading(true);
    try {
      const patch: UpdateSessionInput = {
        title: values.title,
        note: values.note || null,
        location: values.location || null,
        tags: values.tags,
      };
      if (values.type === "TASK") {
        // Duration (resize) is owned by the calendar now — the edit form only
        // touches a TASK's deadline.
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
        // Recurrence edits are whole-series (any fixed type).
        patch.rrule = values.rrule || null;
      }

      await updateSession(task.id, patch);
      onSaved();
      toast.success("Session updated");
      setOpen(false);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Failed to update session",
      );
    } finally {
      setLoading(false);
    }
  }

  async function runDelete(scope: DeleteRecurringScope) {
    if (!task) return;
    setLoading(true);
    try {
      if (scope === "series" && task.seriesId) {
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
        await removeSeriesFrom(task.seriesId, task.id);
      } else {
        // "occurrence": a recurring occurrence id, a TASK sitting, or a one-off.
        await deleteSession(task.id);
      }
      onSaved();
      toast.success(scope === "series" ? "Series deleted" : "Session deleted");
      setOpen(false);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Failed to delete session",
      );
    } finally {
      setLoading(false);
    }
  }

  function onDelete() {
    if (!task) return;
    if (seriesKind === "none") {
      void runDelete("occurrence");
      return;
    }
    setScopeOpen(true);
  }

  const handleClose = async () => {
    if (newUploadsRef.current.length > 0) {
      await postData("/files/remove", { ids: newUploadsRef.current });
    }
    form.reset();
    setOpen(false);
  };

  const scheduledStart = task?.scheduledStartTime
    ? new Date(task.scheduledStartTime)
    : null;
  const scheduledEnd =
    scheduledStart && task
      ? new Date(scheduledStart.getTime() + task.durationMinutes * 60_000)
      : null;
  const typeMeta = task ? SESSION_TYPE_META[task.type] : null;
  const TypeIcon = task ? sessionTypeIcon(task.type) : null;

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetContent
        showOverlay={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="inset-y-auto top-14 h-[calc(100vh-3.5rem)] w-full gap-0 p-0 sm:w-[30rem] sm:max-w-[30rem]"
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-5">
          {typeMeta && TypeIcon ? (
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                typeMeta.badgeClass,
                typeMeta.textClass,
              )}
              title={typeMeta.label}
            >
              <TypeIcon className="size-4" />
            </span>
          ) : (
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground" />
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold tracking-tight">
              {task?.title || "Session detail"}
            </h2>
            {task && (
              <p className="truncate text-[11px] text-muted-foreground">
                {typeMeta?.label} · Created{" "}
                {format(new Date(task.createdAt), "MMM d")}
                {task.sessionTotal &&
                  ` · Sitting ${task.sessionIndex}/${task.sessionTotal}`}
              </p>
            )}
          </div>
        </div>

        {/* Schedule banner */}
        {task && (
          <div className="mx-5 mt-4 flex shrink-0 items-center gap-2.5 rounded-md border border-border bg-muted p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card">
              <Clock className="size-3.5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs font-bold">
                {scheduledStart && scheduledEnd
                  ? `${format(scheduledStart, "EEE MMM d, HH:mm")} – ${format(scheduledEnd, "HH:mm")}`
                  : "Not yet scheduled"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {task.durationMinutes} min
                {task.rrule ? " · repeats" : ""}
                {task.location ? ` · ${task.location}` : ""}
              </p>
            </div>
          </div>
        )}

        <SessionForm
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          form={form as any}
          onSubmit={onSubmit}
          loading={loading}
          editing
          onCancel={handleClose}
          newUploadsRef={newUploadsRef}
          initialNote={task?.note ?? undefined}
          submitLabel="Save Changes"
          footerExtra={
            <Button
              type="button"
              variant="outline"
              onClick={onDelete}
              disabled={loading}
              className="h-8 w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Delete Session
            </Button>
          }
        />

        {seriesKind !== "none" && (
          <DeleteRecurringDialog
            open={scopeOpen}
            onOpenChange={setScopeOpen}
            kind={seriesKind}
            onChoose={runDelete}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
