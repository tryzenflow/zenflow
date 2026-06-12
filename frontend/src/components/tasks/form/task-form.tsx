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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DurationInput } from "@/components/tasks/duration-input";
import { NoteEditor } from "@/components/tasks/note-editor";
import { FixedForm } from "@/components/tasks/fixed-form";
import { snapToNearestLaterQuarterHour } from "@/utils/time";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { listTags } from "@/api/tags";
import { toast } from "sonner";
import { Box, Check, Lock, Plus, Tag, X } from "lucide-react";

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

          {/* Duration — quick-pick + custom (create only: editing changes
              duration by resizing the block on the calendar) */}
          {!editing && (
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

/**
 * Combobox tag editor backed by a `string[]` field of tag NAMES.
 *
 * Existing tags are fetched from `GET /tags` and offered in a searchable list;
 * typing a name that matches none of them surfaces a "Create …" option that
 * adds the name as a *pending* tag (no API call — the backend upserts unknown
 * names on save). Pending tags are a UI-only distinction (dashed chip + "new"
 * hint); the form value is just the flat list of names.
 */
function TagsField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [existing, setExisting] = useState<string[]>([]);

  useEffect(() => {
    listTags()
      .then((tags) => setExisting(tags.map((t) => t.name)))
      .catch(() => setExisting([]));
  }, []);

  const trimmed = query.trim();
  // Existing tags shown in the list: not already selected (cmdk filters by text).
  const options = useMemo(() => {
    const selected = new Set(value);
    return existing.filter((name) => !selected.has(name));
  }, [existing, value]);
  // Offer "Create" when the typed text is non-empty, not already selected, and
  // not an exact (case-insensitive) match of an existing tag.
  const canCreate =
    !!trimmed &&
    !value.some((t) => t.toLowerCase() === trimmed.toLowerCase()) &&
    !existing.some((t) => t.toLowerCase() === trimmed.toLowerCase());

  const add = (name: string) => {
    const clean = name.trim();
    if (!clean || value.some((t) => t.toLowerCase() === clean.toLowerCase()))
      return;
    onChange([...value, clean]);
    setQuery("");
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => {
            const isPending = !existing.includes(tag);
            return (
              <span
                key={tag}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  isPending
                    ? "border-dashed border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground",
                )}
                title={isPending ? "New tag — created on save" : undefined}
              >
                #{tag}
                {isPending && (
                  <span className="text-[8px] font-bold uppercase tracking-wide opacity-70">
                    new
                  </span>
                )}
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
            );
          })}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-transparent px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Tag className="size-3.5 shrink-0" />
            Add tag…
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput
              placeholder="Search or create…"
              value={query}
              onValueChange={setQuery}
              className="h-9"
            />
            <CommandList>
              {!canCreate && <CommandEmpty>No tags found.</CommandEmpty>}
              {options.length > 0 && (
                <CommandGroup heading="Existing">
                  {options.map((name) => (
                    <CommandItem
                      key={name}
                      value={name}
                      onSelect={() => add(name)}
                    >
                      #{name}
                      <Check className="ml-auto opacity-0" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {canCreate && (
                <CommandGroup heading="Create">
                  <CommandItem
                    value={`__create__${trimmed}`}
                    onSelect={() => add(trimmed)}
                  >
                    <Plus className="size-4" />
                    Create "{trimmed}"
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
