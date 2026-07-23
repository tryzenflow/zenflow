import { ErrorBoundary } from "@/components/error-boundary";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { MAX_TITLE_LENGTH, type TaskFormValues } from "@zenflow/core";
import type { ReactNode } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { View } from "react-native";
import { DeadlineChipRow } from "./form/deadline-chip-row";
import { DescriptionField } from "./form/description-field";
import { DurationStepper } from "./form/duration-stepper";
import { TagAutocomplete } from "./form/tag-autocomplete";

/**
 * The five task-sheet fields, in the mockup's order — Title → Duration →
 * Deadline → Tags → Description — shared by `CreateTaskSheet` and
 * `EditTaskSheet` so the two never drift on field order/validation wiring.
 *
 * Unlike the web `TaskForm` (`frontend/src/components/tasks/form/task-form.tsx`),
 * which hides Duration entirely in edit mode (the web only changes duration
 * by dragging the block's resize handle on the calendar), the mobile mockup
 * (`mockups/task-sheets.html`'s "Edit · populated" frame) keeps the
 * duration stepper visible and editable in BOTH sheets — mobile has no
 * drag-resize handles (too small for touch), so the edit sheet's stepper is
 * one of the two ways to change duration, alongside the dedicated
 * long-press → `ChangeDurationSheet` gesture. `EditTaskSheet` is
 * responsible for turning a duration change here into a
 * `PATCH /tasks/:id/resize` call (see its `onSubmit`), since
 * `UpdateTaskInput` has no `durationMinutes` field.
 */
export function TaskSheetFields({
  form,
  disabled,
  tz,
  editing,
}: {
  form: UseFormReturn<TaskFormValues>;
  disabled?: boolean;
  tz: string;
  editing?: boolean;
}) {
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
              {/* Live character counter — validation itself only fires per
                  the form's RHF mode (submit/blur), so this gives proactive
                  feedback as the user types, matching the 60-character limit
                  the shared `taskSchema` `.max()` enforces. */}
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

      {/*
        Diagnostic re-order: was last (after Duration/Deadline/Tags) — moved
        right after Title to test whether the keyboard-occlusion issue
        reported against the WYSIWYG editor is about its depth in the
        surrounding `ScrollView` (a field this far down needs more scroll-
        into-view distance to clear the keyboard) or something inherent to
        the WebView/keyboard interaction. Verified on-device: the editor no
        longer needs to fight nearly as much scroll distance to clear the
        keyboard when focused, and Title → Description → Duration →
        Deadline → Tags still reads fine visually, so this re-order is being
        kept (not just a temporary diagnostic swap) — see
        `mobile/README.md` for the up-to-date field order if this changes
        again.
      */}
      <Controller
        control={form.control}
        name="note"
        render={({ field }) => (
          <Field label="Description">
            {/* Contains a WebView-mount crash (missing native module — see
                `ErrorBoundary`'s doc comment) to this field instead of
                letting it take the whole sheet, and every sibling sheet on
                this screen, down with it. */}
            <ErrorBoundary fallbackMessage="The description editor couldn't load. Everything else on this form still works.">
              <DescriptionField
                value={field.value ?? ""}
                onChange={field.onChange}
                disabled={disabled}
              />
            </ErrorBoundary>
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="duration"
        render={({ field, fieldState }) => (
          <Field label="Duration" error={fieldState.error?.message}>
            <DurationStepper
              value={field.value}
              onChange={field.onChange}
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
              value={field.value}
              onChange={field.onChange}
              disabled={disabled}
              editing={editing}
              tz={tz}
            />
          </Field>
        )}
      />

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
