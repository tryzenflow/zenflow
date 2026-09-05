import { ErrorBoundary } from "@/components/error-boundary";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { MAX_TITLE_LENGTH, type SessionFormValues } from "@zenflow/core";
import type { ReactNode } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { View } from "react-native";
import { DeadlineChipRow } from "./form/deadline-chip-row";
import { DescriptionField } from "./form/description-field";
import { DurationStepper } from "./form/duration-stepper";
import { FixedTimeField } from "./form/fixed-time-field";
import { RecurrenceField } from "./form/recurrence-field";
import { SessionCountField } from "./form/session-count-field";
import { TagAutocomplete } from "./form/tag-autocomplete";

/**
 * Session-form fields, branched by `type` (watched from the form):
 *
 * - **TASK** — Duration stepper + Sessions field (both create only — an
 *   existing task is resized from the calendar's "Move to…" sheet, and a
 *   series' count can't be changed after creation) + Deadline chip row. A
 *   Sessions count > 1 requests a series (issue #33), capped at one session
 *   per day (`SessionCountField`); `sessionSchema`'s `superRefine` surfaces
 *   an infeasible duration×count under the Deadline field, same as a plain
 *   missing deadline.
 * - **ASSIGNMENT / EXAM / LECTURE** — a fixed date + start/end time.
 * - **DND** — the same fixed-time picker plus a recurrence builder.
 *
 * Title / Description / Tags render for every type. `typeSelector`, when given
 * (create screen only), renders directly beneath the Title field.
 */
export function SessionSheetFields({
  initialValue = "",
  form,
  disabled,
  tz,
  editing,
  typeSelector,
  deadlineWarning,
}: {
  initialValue?: string;
  form: UseFormReturn<SessionFormValues>;
  disabled?: boolean;
  tz: string;
  editing?: boolean;
  typeSelector?: ReactNode;
  /** Shown (red) under the Deadline field — e.g. the picked deadline is
   * earlier than where this TASK is already scheduled. */
  deadlineWarning?: string;
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

          {!editing && (
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
                    disabled={disabled}
                  />
                </Field>
              )}
            />
          )}

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
                  warning={deadlineWarning}
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
          {error}
        </Text>
      )}
    </View>
  );
}
