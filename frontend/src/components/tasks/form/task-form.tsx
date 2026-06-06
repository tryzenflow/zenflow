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
import { TaskFormValues, parseTags } from "@/utils/tasks";
import { format } from "date-fns";
import { isZonedToday } from "@/utils/tz";
import { useUserStore } from "@/hooks/use-user-store";
import type { ViewMode } from "@zenflow/shared";
import { UseFormReturn } from "react-hook-form";
import { useState, type ReactNode } from "react";
import { DurationInput } from "../duration-input";
import { NoteEditor } from "../note-editor";
import { RRuleForm } from "../rrule-form";
import { FixedForm } from "../fixed-form";
import { snapToNearestLaterQuarterHour } from "@/utils/time";
import { cn } from "@/lib/utils";
import { Box, Lock, Repeat, Tag, X } from "lucide-react";

const DURATION_PRESETS = [15, 30, 45, 60, 120];

const presetLabel = (m: number) =>
  m % 60 === 0 ? `${m / 60}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;

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
  /** Active calendar perspective. Drives view-scoped recurrence (and is hidden
   *  in "day" / on the edit panel, where it's undefined). */
  view?: ViewMode;
  /** The day the task is being scheduled into (anchors fixed-time minimums). */
  date?: Date;
  /** Onboarding workdays (ISO 1–7) — constrains recurrence weekday choices. */
  workDays?: number[];
  initialNote?: string;
  submitLabel?: string;
  /** Extra sections rendered inside the scrollable body (e.g. history). */
  bodyExtra?: ReactNode;
  /** Extra actions rendered under the Cancel/Save row (e.g. delete). */
  footerExtra?: ReactNode;
}

export function TaskForm({
  form,
  onSubmit,
  onCancel,
  newUploadsRef,
  loading,
  initialNote,
  view,
  date,
  workDays = [1, 2, 3, 4, 5],
  submitLabel = "Save",
  bodyExtra,
  footerExtra,
}: TaskFormProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const isFixed = form.watch("isFixed");
  const fixedStart = form.watch("fixedStart");
  const fixedEnd = form.watch("fixedEnd");
  const duration = isFixed ? fixedEnd - fixedStart : form.watch("duration");
  // Recurrence is only meaningful at creation in Week/Month views.
  const recurrenceView = view === "week" || view === "month" ? view : null;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Title */}
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-xs font-semibold">Task name</FormLabel>
                <FormControl>
                  <Input
                    disabled={loading}
                    placeholder="What needs to get done?"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Duration — quick-pick + custom */}
          <FormField
            control={form.control}
            name="duration"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel className="text-xs font-semibold">Duration</FormLabel>
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
                  <span className="text-[10px] text-muted-foreground">or custom</span>
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

          {/* Scheduling type */}
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
                    className={cn(segBase, !field.value ? segActive : segIdle)}
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
                  Flexible: the engine chooses the optimal slot. Fixed: you pick the
                  exact time.
                </p>
              </FormItem>
            )}
          />

          {isFixed && (
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
              <span className="text-[10px] text-muted-foreground">Optional</span>
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
                  <span className="text-[10px] text-muted-foreground">Optional</span>
                </div>
                <TagsField
                  disabled={loading}
                  value={field.value ?? ""}
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
                <FormLabel className="text-xs font-semibold">Description</FormLabel>
                <FormControl>
                  <NoteEditor
                    initialValue={initialNote}
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

          {/* Recurrence — view-scoped; hidden in Day view and on the edit panel. */}
          {recurrenceView && (
            <FormField
              control={form.control}
              name="isRecurring"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-xs font-semibold">
                      Recurrence
                    </FormLabel>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => field.onChange(!field.value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                        field.value
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
                      )}
                    >
                      <Repeat className="size-3" />
                      {field.value ? "Repeats" : "Does not repeat"}
                    </button>
                  </div>
                  {field.value && (
                    <RRuleForm
                      form={form}
                      view={recurrenceView}
                      workDays={workDays}
                      date={date ?? new Date()}
                    />
                  )}
                </FormItem>
              )}
            />
          )}

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

/** Chip-based tag editor backed by a comma-separated string field. */
function TagsField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const tags = parseTags(value);

  const commit = (raw: string) => {
    const next = [...tags];
    for (const t of parseTags(raw)) {
      if (!next.includes(t)) next.push(t);
    }
    onChange(next.join(", "));
    setDraft("");
  };

  const remove = (tag: string) =>
    onChange(tags.filter((t) => t !== tag).join(", "));

  return (
    <div className="space-y-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
            >
              #{tag}
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(tag)}
                className="transition-colors hover:text-foreground"
                aria-label={`Remove ${tag}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Tag className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              if (draft.trim()) commit(draft);
            } else if (e.key === "Backspace" && !draft && tags.length) {
              remove(tags[tags.length - 1]);
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder="Add tag (e.g. admin, meetings)…"
          className="pl-9"
        />
      </div>
    </div>
  );
}
