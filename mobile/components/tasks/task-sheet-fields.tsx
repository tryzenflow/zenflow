import { ErrorBoundary } from "@/components/error-boundary";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { splitToastMessage } from "@/lib/task-toasts";
import { cn } from "@/lib/utils";
import {
  MAX_TITLE_LENGTH,
  effectiveNowForSessionCountEdit,
  type SessionFormValues,
} from "@zenflow/core";
import type { ReactNode } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { View } from "react-native";
import { DeadlineChipRow } from "./form/deadline-chip-row";
import { DescriptionField } from "./form/description-field";
import { DurationStepper } from "./form/duration-stepper";
import { FixedTimeField } from "./form/fixed-time-field";
import { RecurrenceField } from "./form/recurrence-field";
import { ReminderField } from "./form/reminder-field";
import { SessionCountField } from "./form/session-count-field";
import { TagAutocomplete } from "./form/tag-autocomplete";

/**
 * Session-form fields, branched by `type` (watched from the form):
 *
 * - **TASK** — Duration stepper (create only — an existing task is resized
 *   from the calendar's "Move to…" sheet) + Sessions field (editable in both
 *   create and edit mode; edit mode bounds its feasible-max window off the
 *   edited sitting's own schedule via `editingInstance`, not raw "now") +
 *   Deadline chip row. A Sessions count > 1 requests a series (issue #33),
 *   capped at one session per day (`SessionCountField`); `sessionSchema`'s
 *   `superRefine` surfaces an infeasible duration×count under the Deadline
 *   field, same as a plain missing deadline.
 * - **ASSIGNMENT / EXAM / LECTURE** — a fixed date + start/end time.
 * - **DND** — the same fixed-time picker plus a recurrence builder.
 *
 * Title / Description / Location / Tags render for every type. `typeSelector`,
 * when given (create screen only), renders directly beneath the Title field.
 */
export function SessionSheetFields({
  initialValue = "",
  form,
  disabled,
  tz,
  editing,
  typeSelector,
  editingInstance,
}: {
  initialValue?: string;
  form: UseFormReturn<SessionFormValues>;
  disabled?: boolean;
  tz: string;
  editing?: boolean;
  typeSelector?: ReactNode;
  /**
   * Edit mode only: the schedule info of the specific `TASK` sitting
   * currently open in the form, used to bound the session-count slider's
   * feasible-max window off an adjusted "now" (see
   * `effectiveNowForSessionCountEdit`). Undefined in create mode.
   */
  editingInstance?: {
    scheduledStartTime: string | null;
    durationMinutes: number;
  };
}) {
  const type = form.watch("type");
  const isTask = type === "TASK";
  // Every fixed type can recur — a weekly lecture, a nightly DND block, a
  // recurring lab. Only the flexible TASK has no "Repeat".
  const canRepeat = type !== "TASK";

  return (
    <View className="gap-[18px]">
      <Controller
        control={form.control}
        name="title"
        render={({ field, fieldState }) => {
          const charCount = (field.value ?? "").length;
          const overLimit = charCount > MAX_TITLE_LENGTH;
          return (
            <Field label="Title" error={fieldState.error?.message}>
              <Input
                editable={!disabled}
                value={field.value}
                onChangeText={field.onChange}
                placeholder="What needs doing?"
                className="h-[50px] rounded-xl border border-input bg-card px-4 text-base text-foreground"
              />
              <Text
                className={cn(
                  "mt-1.5 self-end text-[11px] font-medium text-muted-foreground",
                  overLimit && "text-destructive",
                )}
              >
                {charCount}/{MAX_TITLE_LENGTH} characters
              </Text>
            </Field>
          );
        }}
      />

      {typeSelector}

      <Controller
        control={form.control}
        name="note"
        render={({ field }) => (
          <Field label="Description">
            <ErrorBoundary fallbackMessage="The description editor couldn't load. Everything else on this form still works.">
              <DescriptionField
                initialValue={initialValue}
                onChange={field.onChange}
                disabled={disabled}
              />
            </ErrorBoundary>
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="location"
        render={({ field, fieldState }) => (
          <Field label="Location" error={fieldState.error?.message}>
            <Input
              editable={!disabled}
              value={field.value ?? ""}
              onChangeText={field.onChange}
              placeholder="Room, building, or link (optional)"
              className="h-[50px] rounded-xl border border-input bg-card px-4 text-base text-foreground"
            />
          </Field>
        )}
      />

      {isTask ? (
        <>
          {!editing && (
            <Controller
              control={form.control}
              name="duration"
              render={({ field, fieldState }) => (
                <Field label="Duration" error={fieldState.error?.message}>
                  <DurationStepper
                    value={field.value ?? 60}
                    onChange={field.onChange}
                    disabled={disabled}
                  />
                </Field>
              )}
            />
          )}

          <Controller
            control={form.control}
            name="sessionCount"
            render={({ field }) => (
              <Field label="Sessions">
                <SessionCountField
                  value={field.value ?? 1}
                  onChange={field.onChange}
                  deadline={form.watch("deadline")}
                  duration={form.watch("duration")}
                  from={
                    editingInstance
                      ? effectiveNowForSessionCountEdit(editingInstance)
                      : undefined
                  }
                  disabled={disabled}
                />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="deadline"
            render={({ field, fieldState }) => (
              <Field label="Deadline" error={fieldState.error?.message}>
                <DeadlineChipRow
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  disabled={disabled}
                  editing={editing}
                  tz={tz}
                />
              </Field>
            )}
          />
        </>
      ) : (
        <Field
          label="When"
          error={
            form.formState.errors.date?.message ??
            form.formState.errors.startTime?.message ??
            form.formState.errors.endTime?.message
          }
        >
          <FixedTimeField
            date={form.watch("date")}
            startTime={form.watch("startTime")}
            endTime={form.watch("endTime")}
            onChangeDate={(v) =>
              form.setValue("date", v, { shouldValidate: true })
            }
            onChangeStart={(v) =>
              form.setValue("startTime", v, { shouldValidate: true })
            }
            onChangeEnd={(v) =>
              form.setValue("endTime", v, { shouldValidate: true })
            }
            tz={tz}
            disabled={disabled}
          />
        </Field>
      )}

      {canRepeat && (
        <Field label="Repeat">
          <Controller
            control={form.control}
            name="rrule"
            render={({ field }) => (
              <RecurrenceField
                value={field.value}
                onChange={field.onChange}
                tz={tz}
                disabled={disabled}
              />
            )}
          />
        </Field>
      )}

      {/* Every type except DND (a block, not an event) */}
      {type !== "DND" && (
        <Controller
          control={form.control}
          name="reminders"
          render={({ field }) => (
            <Field label="Reminder">
              <ReminderField
                value={field.value ?? []}
                onChange={field.onChange}
                disabled={disabled}
              />
            </Field>
          )}
        />
      )}

      <Controller
        control={form.control}
        name="tags"
        render={({ field }) => (
          <Field label="Tags">
            <TagAutocomplete
              value={field.value ?? []}
              onChange={field.onChange}
              disabled={disabled}
            />
          </Field>
        )}
      />
    </View>
  );
}

/** A "title\ndescription" message (split into two lines for toasts, see
 * `splitToastMessage`) reads as one sentence under a field. */
function inlineError(message: string): string {
  const { title, description } = splitToastMessage(message);
  return description ? `${title}. ${description}` : title;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <View>
      <Text className="mb-2 text-[13.5px] font-semibold text-foreground">
        {label}
      </Text>
      {children}
      {!!error && (
        <Text className="mt-1.5 text-[12px] font-medium text-destructive">
          {inlineError(error)}
        </Text>
      )}
    </View>
  );
}
