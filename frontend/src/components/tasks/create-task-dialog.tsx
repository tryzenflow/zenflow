import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useSessionForm } from "@/hooks/use-task-form";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { postData } from "@/api";
import { useFilesTracker } from "@/hooks/use-files-tracker";
import { useUserStore } from "@/hooks/use-user-store";
import { useHighlightStore } from "@/hooks/use-highlight-store";
import {
  combineToUtc,
  hhmmToMinutes,
  placementQualifier,
  type SessionFormType,
  type SessionFormValues,
} from "@zenflow/core";
import { SessionForm } from "./form/task-form";
import { SessionTypeTabs } from "./form/session-type-tabs";
import { Plus } from "lucide-react";
import { createSession } from "@/api/tasks";
import { format } from "date-fns";
import { isAxiosError } from "axios";
import { zonedDate } from "@/utils/tz";
import type { CreateSessionInput, ViewMode } from "@zenflow/shared";

const DEFAULT_DURATION = 60;

const EMPTY_DEFAULTS: SessionFormValues = {
  type: "TASK",
  title: "",
  duration: DEFAULT_DURATION,
  sessionCount: 1,
  tags: [],
  note: "",
  location: "",
  deadline: "",
};

/** Form values → the `CreateSessionInput` union the API expects. */
function toCreateInput(
  values: SessionFormValues,
  tz: string,
): CreateSessionInput {
  const base = {
    title: values.title,
    note: values.note || null,
    location: values.location || null,
    tags: values.tags,
  };

  if (values.type === "TASK") {
    return {
      ...base,
      type: "TASK",
      durationMinutes: values.duration ?? DEFAULT_DURATION,
      deadline: values.deadline as string,
      // Omitted/1 → one ordinary task; >1 → a multi-sitting series.
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

export function CreateSessionDialog({
  onCreated,
  trigger,
  setDate,
}: {
  date: Date;
  view: ViewMode;
  onCreated: () => void;
  /** Custom trigger element; falls back to the default "New session" button. */
  trigger?: React.ReactNode;
  /** Navigate the calendar cursor date — used to jump to the created session's day. */
  setDate: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const user = useUserStore((state) => state.user);
  const tz = user?.timezone || "UTC";
  const setHighlight = useHighlightStore((s) => s.setHighlight);
  const fmt = (iso: string) => format(zonedDate(iso, tz), "EEE MMM d, HH:mm");

  const form = useSessionForm({ defaultValues: EMPTY_DEFAULTS });
  const type = form.watch("type");
  const note = form.watch("note");
  const { newUploadsRef, updateRemovedFileIds, removedFileIds } =
    useFilesTracker();

  useEffect(() => {
    updateRemovedFileIds(note || "", "");
  }, [note]);

  /** Swap session type, preserving the fields common to every type. */
  function switchType(next: SessionFormType) {
    const common = {
      title: form.getValues("title"),
      note: form.getValues("note"),
      location: form.getValues("location"),
      tags: form.getValues("tags"),
    };
    form.reset(
      next === "TASK"
        ? {
            ...common,
            type: "TASK",
            duration: form.getValues("duration") ?? DEFAULT_DURATION,
            sessionCount: form.getValues("sessionCount") ?? 1,
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

  async function finalizeCreate(values: SessionFormValues) {
    if (!user) return;
    setLoading(true);
    try {
      const session = await createSession(toCreateInput(values, tz));

      if (session.scheduledStartTime) {
        setHighlight(session.id);
        setDate(zonedDate(session.scheduledStartTime, tz));
      }
      onCreated();
      form.reset(EMPTY_DEFAULTS);
      setOpen(false);

      const seriesCount = session.sessions?.length ?? 0;
      if (seriesCount > 1) {
        toast.success(`Created a ${seriesCount}-session series`);
      } else if (session.scheduledStartTime) {
        const qualifier = placementQualifier(session, user);
        const suffix =
          qualifier === "pastDeadline" ? " — past its deadline" : "";
        toast.success(`Scheduled for ${fmt(session.scheduledStartTime)}${suffix}`);
      } else {
        toast.success(
          "Session created — drag it onto the calendar to schedule it",
        );
      }
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Something went wrong when creating the session",
      );
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(values: SessionFormValues) {
    if (!user) return;
    setLoading(true);
    try {
      const removed = removedFileIds.current;
      if (removed.length > 0) await postData("/files/remove", { ids: removed });
      await finalizeCreate(values);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Something went wrong when creating the session",
      );
      setLoading(false);
    }
  }

  const handleClose = async () => {
    setLoading(true);
    try {
      if (newUploadsRef.current.length > 0) {
        await postData("/files/remove", { ids: newUploadsRef.current });
      }
      form.reset(EMPTY_DEFAULTS);
      setOpen(false);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Something went wrong when cancelling",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="hidden sm:flex">
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">New session</span>
          </Button>
        )}
      </SheetTrigger>
      <SheetContent
        showOverlay={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="inset-y-auto top-14 h-[calc(100vh-3.5rem)] w-full gap-0 p-0 sm:w-[30rem] sm:max-w-[30rem]"
      >
        <div className="flex h-14 shrink-0 items-center border-b border-border px-5">
          <h2 className="text-sm font-bold tracking-tight">New Session</h2>
        </div>
        <SessionForm
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          form={form as any}
          onSubmit={onSubmit}
          newUploadsRef={newUploadsRef}
          loading={loading}
          onCancel={handleClose}
          submitLabel="Create Session"
          typeSelector={
            <SessionTypeTabs
              value={type}
              onChange={switchType}
              disabled={loading}
            />
          }
        />
      </SheetContent>
    </Sheet>
  );
}
