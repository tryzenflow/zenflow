import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/datepicker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { TaskFormValues } from "@/utils/tasks";
import { format } from "date-fns";
import { isZonedToday } from "@/utils/tz";
import { useUserStore } from "@/hooks/use-user-store";
import { UseFormReturn } from "react-hook-form";
import { useEffect, useState, type ReactNode } from "react";
import { DurationInput } from "@/components/tasks/duration-input";
import { NoteEditor } from "@/components/tasks/note-editor";
import { FixedForm } from "@/components/tasks/fixed-form";
import { snapToNearestLaterQuarterHour } from "@/utils/time";
import { cn } from "@/lib/utils";
import { DAILY_HORIZON } from "@/utils/constants";
import { zonedDate } from "@/utils/tz";
import { toast } from "sonner";
import { Box, Lock } from "lucide-react";
import type { Task } from "@zenflow/shared";
import { TagsField } from "./tag-field";
import { TitleField } from "./title-field";

const DURATION_PRESETS = [15, 30, 45, 60, 120];

const presetLabel = (m: number) =>
  m % 60 === 0
    ? `${m / 60}h`
    : m >= 60
      ? `${Math.floor(m / 60)}h ${m % 60}m`
      : `${m}m`;

const segBase =
  "flex-1 py-2 flex items-center justify-center gap-1.5 transition-colors";
const segActive = "bg-primary text-primary-foreground";
const segIdle =
  "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary";

interface TaskFormProps {
  form: UseFormReturn<TaskFormValues>;
  newUploadsRef?: React.RefObject<string[]>;
  onSubmit: (values: TaskFormValues) => void;
  onCancel: () => void;
  loading: boolean;
  /** The day the task is being scheduled into (anchors fixed-time minimums). */
  date?: Date;
  initialNote?: string;
  submitLabel?: string;
  /** Extra sections rendered inside the scrollable body (e.g. history). */
  bodyExtra?: ReactNode;
  /** Extra actions rendered under the Cancel/Save row (e.g. delete). */
  footerExtra?: ReactNode;
  /**
   * Edit mode: hide the scheduling fields (duration, scheduling type, fixed
   * window) — placement and duration are changed on the calendar, not here.
   */
  editing?: boolean;
}

export function TaskForm({
  form,
  onSubmit,
  onCancel,
  newUploadsRef,
  loading,
  initialNote,
  date,
  submitLabel = "Save",
  bodyExtra,
  footerExtra,
  editing = false,
}: TaskFormProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const isFixed = form.watch("isFixed");
  const fixedStart = form.watch("fixedStart");
  const fixedEnd = form.watch("fixedEnd");
  const duration = isFixed ? fixedEnd - fixedStart : form.watch("duration");

  // `NoteEditor` only re-renders its content when `initialValue` changes, so a
  // bare `setValue("note", …)` updates the form but not the editor. Drive the
  // editor's seed from state we bump when populating from a suggestion; the
  // normal edit path still flows through `initialNote`.
  const [noteSeed, setNoteSeed] = useState(initialNote);
  useEffect(() => setNoteSeed(initialNote), [initialNote]);

  // Populate the create form from a picked existing task. Mirrors the field
  // layout of the form (see create-task-dialog's onSubmit for the inverse map).
  const applySuggestion = (s: Task) => {
    form.setValue("title", s.title, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("duration", s.durationMinutes, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("isFixed", s.fixed, { shouldDirty: true });
    form.setValue("fixedStart", s.startTime, { shouldDirty: true });
    form.setValue(
      "fixedEnd",
      Math.min(s.startTime + s.durationMinutes, DAILY_HORIZON),
      { shouldDirty: true },
    );
    form.setValue("tags", s.tags ?? [], { shouldDirty: true });
    form.setValue("note", s.note ?? "", { shouldDirty: true });
    setNoteSeed(s.note ?? "");

    // Shift the source task's deadline forward by the same lead time it had at
    // creation, so re-using an old task never yields a past deadline. Split into
    // date/time in the user's tz wall clock (never a bare new Date for the grid).
    let deadlineDate = "";
    let deadlineTime = "";
    if (s.deadline) {
      const offsetMs =
        new Date(s.deadline).getTime() - new Date(s.createdAt).getTime();
      if (offsetMs >= 0) {
        const wall = zonedDate(new Date(Date.now() + offsetMs), tz);
        deadlineDate = format(wall, "yyyy-MM-dd");
        deadlineTime = format(wall, "HH:mm");
      }
    }
    form.setValue("deadlineDate", deadlineDate, { shouldDirty: true });
    form.setValue("deadlineTime", deadlineTime, { shouldDirty: true });
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, (errors) => {
          // Surface validation failures even when the offending field is hidden
          // (e.g. fixed-time fields while in flexible mode), so submit never
          // silently no-ops.
          const first = Object.values(errors)[0];
          if (first?.message) toast.error(String(first.message));
        })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Title */}
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-xs font-semibold">
                  Task name
                </FormLabel>
                {editing ? (
                  <FormControl>
                    <Input
                      disabled={loading}
                      placeholder="What needs to get done?"
                      {...field}
                    />
                  </FormControl>
                ) : (
                  <TitleField
                    disabled={loading}
                    value={field.value}
                    onChange={field.onChange}
                    onSelect={applySuggestion}
                  />
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Duration — quick-pick + custom (create only: editing changes
              duration by resizing the block on the calendar) */}
          {!editing && (
            <FormField
              control={form.control}
              name="duration"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel className="text-xs font-semibold">
                    Duration
                  </FormLabel>
                  <div className="grid grid-cols-5 gap-1.5">
                    {DURATION_PRESETS.map((m) => {
                      const active = duration === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={loading || isFixed}
                          onClick={() => field.onChange(m)}
                          className={cn(
                            "h-8 rounded-md border text-xs font-semibold transition-colors disabled:opacity-50",
                            active
                              ? "border-primary bg-primary/15 font-bold text-primary"
                              : "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
                          )}
                        >
                          {presetLabel(m)}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10px] text-muted-foreground">
                      or custom
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <DurationInput
                    className="w-full"
                    disabled={loading || isFixed}
                    value={duration}
                    onChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* Scheduling type (create only) */}
          {!editing && (
            <FormField
              control={form.control}
              name="isFixed"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel className="text-xs font-semibold">
                    Scheduling type
                  </FormLabel>
                  <div className="flex overflow-hidden rounded-md border border-border text-xs font-semibold">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => field.onChange(false)}
                      className={cn(
                        segBase,
                        !field.value ? segActive : segIdle,
                      )}
                    >
                      <Box className="size-3" />
                      Flexible
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => field.onChange(true)}
                      className={cn(
                        segBase,
                        "border-l border-border",
                        field.value ? segActive : segIdle,
                      )}
                    >
                      <Lock className="size-3" />
                      Fixed
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Flexible: the engine chooses the optimal slot. Fixed: you
                    pick the exact time.
                  </p>
                </FormItem>
              )}
            />
          )}

          {isFixed && !editing && (
            <FixedForm
              minTime={
                date && isZonedToday(date, tz)
                  ? snapToNearestLaterQuarterHour(
                      date.getHours() * 60 + date.getMinutes(),
                    )
                  : 0
              }
              form={form}
            />
          )}

          {/* Deadline */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <FormLabel className="text-xs font-semibold">Deadline</FormLabel>
              <span className="text-[10px] text-muted-foreground">
                Optional
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <FormField
                control={form.control}
                name="deadlineDate"
                render={({ field }) => (
                  <FormItem className="col-span-2 space-y-0">
                    <DatePicker
                      placeholder="Select date"
                      disabled={loading || { before: new Date() }}
                      date={field.value ? new Date(field.value) : undefined}
                      onSelect={(value) =>
                        field.onChange(value ? format(value, "yyyy-MM-dd") : "")
                      }
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="deadlineTime"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <Input disabled={loading} type="time" {...field} />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Tags */}
          <FormField
            control={form.control}
            name="tags"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <FormLabel className="text-xs font-semibold">Tags</FormLabel>
                  <span className="text-[10px] text-muted-foreground">
                    Optional
                  </span>
                </div>
                <TagsField
                  disabled={loading}
                  value={field.value ?? []}
                  onChange={field.onChange}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Description (rich text) */}
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-xs font-semibold">
                  Description
                </FormLabel>
                <FormControl>
                  <NoteEditor
                    initialValue={noteSeed}
                    newUploadsRef={newUploadsRef}
                    disabled={loading}
                    value={field.value || ""}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {bodyExtra}
        </div>

        {/* Footer */}
        <div className="shrink-0 space-y-3 border-t border-border p-5">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={onCancel}
              className="h-9 flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="h-9 flex-1">
              {submitLabel}
            </Button>
          </div>
          {footerExtra}
        </div>
      </form>
    </Form>
  );
}
