import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { SessionFormValues } from "@zenflow/core";
import { UseFormReturn } from "react-hook-form";
import { useEffect, useState, type ReactNode } from "react";
import { DurationInput } from "@/components/tasks/duration-input";
import { NoteEditor } from "@/components/tasks/note-editor";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Session } from "@zenflow/shared";
import { TagsField } from "./tag-field";
import { TitleField } from "./title-field";
import { DeadlineChipField } from "./deadline-chip-field";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedDate, zonedNow, zonedWallClockToUtc } from "@/utils/tz";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Shift a deadline forward by the same lead time (in whole days) it had at
 * creation, keeping the exact time-of-day of the original deadline — so a
 * midnight deadline stays midnight, never drifting to whatever time the
 * suggestion happens to be applied at. The session also needs room to actually
 * be scheduled, so if that candidate leaves less than `durationMinutes`
 * between now and the deadline, bump forward a day at a time — still
 * preserving the original time-of-day — until the full duration fits before
 * it. Returns "" when the source has no deadline or had a negative lead time. */
function shiftedDeadline(
  session: Session,
  tz: string,
  durationMinutes: number,
): string {
  if (!session.deadline || !session.createdAt) return "";
  const deadlineZoned = zonedDate(session.deadline, tz);
  const createdZoned = zonedDate(session.createdAt, tz);
  const leadDays = Math.round(
    (deadlineZoned.getTime() - createdZoned.getTime()) / MS_PER_DAY,
  );
  if (leadDays < 0) return "";

  const candidate = zonedNow(tz);
  candidate.setDate(candidate.getDate() + leadDays);
  candidate.setHours(
    deadlineZoned.getHours(),
    deadlineZoned.getMinutes(),
    0,
    0,
  );

  const earliestFit = zonedNow(tz);
  earliestFit.setMinutes(earliestFit.getMinutes() + durationMinutes);
  while (candidate.getTime() <= earliestFit.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return zonedWallClockToUtc(candidate, tz).toISOString();
}

const DURATION_PRESETS = [15, 30, 45, 60, 120];

const presetLabel = (m: number) =>
  m % 60 === 0
    ? `${m / 60}h`
    : m >= 60
      ? `${Math.floor(m / 60)}h ${m % 60}m`
      : `${m}m`;

interface SessionFormProps {
  form: UseFormReturn<SessionFormValues>;
  newUploadsRef?: React.RefObject<string[]>;
  onSubmit: (values: SessionFormValues) => void;
  onCancel: () => void;
  loading: boolean;
  initialNote?: string;
  submitLabel?: string;
  /** Extra sections rendered inside the scrollable body (e.g. history). */
  bodyExtra?: ReactNode;
  /** Extra actions rendered under the Cancel/Save row (e.g. delete). */
  footerExtra?: ReactNode;
  /**
   * Edit mode: hide the scheduling fields (duration) — placement and
   * duration are changed on the calendar, not here.
   */
  editing?: boolean;
}

export function SessionForm({
  form,
  onSubmit,
  onCancel,
  newUploadsRef,
  loading,
  initialNote,
  submitLabel = "Save",
  bodyExtra,
  footerExtra,
  editing = false,
}: SessionFormProps) {
  const duration = form.watch("duration");
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  // `NoteEditor` only re-renders its content when `initialValue` changes, so a
  // bare `setValue("note", …)` updates the form but not the editor. Drive the
  // editor's seed from state we bump when populating from a suggestion; the
  // normal edit path still flows through `initialNote`.
  const [noteSeed, setNoteSeed] = useState(initialNote);
  useEffect(() => setNoteSeed(initialNote), [initialNote]);

  // Populate the create form from a picked existing session. Mirrors the field
  // layout of the form (see create-session-dialog's onSubmit for the inverse map).
  const applySuggestion = (s: Session) => {
    form.setValue("title", s.title, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("duration", s.durationMinutes, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("tags", s.tags ?? [], { shouldDirty: true });
    form.setValue("note", s.note ?? "", { shouldDirty: true });
    setNoteSeed(s.note ?? "");
    form.setValue("deadline", shiftedDeadline(s, tz, s.durationMinutes), {
      shouldValidate: true,
      shouldDirty: true,
    });
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
                  Session name
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
                          disabled={loading}
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
                    disabled={loading}
                    value={duration}
                    onChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* Deadline — quick-action chips (todo.md); required now. */}
          <FormField
            control={form.control}
            name="deadline"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-xs font-semibold">
                  Deadline
                </FormLabel>
                <DeadlineChipField
                  value={field.value}
                  onChange={field.onChange}
                  disabled={loading}
                  editing={editing}
                />
                <FormMessage />
              </FormItem>
            )}
          />

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
