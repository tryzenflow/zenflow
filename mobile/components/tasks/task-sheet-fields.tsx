import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { ErrorBoundary } from "@/components/error-boundary";
import { ChevronDown } from "@/components/Icons";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import {
  type FormFieldKey,
  hasDetailContent,
  hasDetailError,
  showTitleCounter,
} from "@/lib/form-validation";
import { haptic } from "@/lib/haptics";
import { splitToastMessage } from "@/lib/task-toasts";
import { cn } from "@/lib/utils";
import {
  MAX_TITLE_LENGTH,
  effectiveNowForSessionCountEdit,
  type SessionFormValues,
} from "@zenflow/core";
import {
  type ElementRef,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

type InputInstance = ElementRef<typeof Input>;
import { Controller, type UseFormReturn } from "react-hook-form";
import { Keyboard, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { DeadlineChipRow } from "./form/deadline-chip-row";
import { DescriptionField } from "./form/description-field";
import { DurationStepper } from "./form/duration-stepper";
import { FixedTimeField } from "./form/fixed-time-field";
import { RecurrenceField } from "./form/recurrence-field";
import { ReminderField } from "./form/reminder-field";
import { SessionCountField } from "./form/session-count-field";
import { TagAutocomplete } from "./form/tag-autocomplete";
import { useFormFieldRegistration } from "./form/use-form-focus";

/**
 * Session-form fields, in the order a student decides things:
 * Title, Type (`typeSelector`, create only), then what the type needs, then a
 * collapsed "More details" disclosure (Description, Location, Tags, Reminder).
 *
 * - **TASK** — Duration (create only: presets + 15-minute stepper; an existing
 *   task is resized from the calendar's "Move to…" sheet), Deadline chips with
 *   no preselected chip (the schema requires one), and Sessions (a count > 1
 *   requests a series, issue #33; `sessionSchema`'s `superRefine` surfaces an
 *   infeasible duration×count under the Deadline field).
 * - **ASSIGNMENT / EXAM / LECTURE** — a fixed date + start/end time, plus Repeat.
 * - **DND** — the same plus no reminder.
 *
 * The disclosure opens by itself when an existing session already has details
 * or when a validation error lives inside it.
 */
export function SessionSheetFields({
  initialValue = "",
  form,
  disabled,
  tz,
  editing,
  typeSelector,
  editingInstance,
  autoFocusTitle,
}: {
  initialValue?: string;
  form: UseFormReturn<SessionFormValues>;
  disabled?: boolean;
  tz: string;
  editing?: boolean;
  typeSelector?: ReactNode;
  /** Focus the title as the form opens (create screen). */
  autoFocusTitle?: boolean;
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
  useLanguage();
  const type = form.watch("type");
  const isTask = type === "TASK";
  // Every fixed type can recur — a weekly lecture, a nightly DND block, a
  // recurring lab. Only the flexible TASK has no "Repeat".
  const canRepeat = type !== "TASK";
  const titleRef = useRef<InputInstance>(null);
  const locationRef = useRef<InputInstance>(null);
  const errors = form.formState.errors;

  const startOpen =
    !!editing &&
    hasDetailContent({
      note: initialValue,
      location: form.getValues("location"),
      tags: form.getValues("tags"),
      reminders: form.getValues("reminders"),
    });
  const detailError = hasDetailError(errors);

  return (
    <View className="gap-[18px]">
      <Controller
        control={form.control}
        name="title"
        render={({ field, fieldState }) => {
          const charCount = (field.value ?? "").length;
          const overLimit = charCount > MAX_TITLE_LENGTH;
          return (
            <Field
              fieldKey="title"
              label={t("Title")}
              error={fieldState.error?.message}
              inputRef={titleRef}
            >
              <Input
                ref={titleRef}
                editable={!disabled}
                autoFocus={autoFocusTitle}
                value={field.value}
                onChangeText={field.onChange}
                placeholder={t("What needs doing?")}
                accessibilityLabel={t("Title")}
                aria-invalid={!!fieldState.error}
                returnKeyType="next"
                // The next controls are taps, so "next" hands the screen back.
                onSubmitEditing={() => Keyboard.dismiss()}
                className="h-[50px] rounded-xl border border-input bg-card px-4 text-base text-foreground"
              />
              {showTitleCounter(charCount, MAX_TITLE_LENGTH) && (
                <Text
                  className={cn(
                    "mt-1.5 self-end text-label font-medium text-muted-foreground",
                    overLimit && "text-destructive",
                  )}
                >
                  {charCount}/{MAX_TITLE_LENGTH} {t("characters")}
                </Text>
              )}
            </Field>
          );
        }}
      />

      {typeSelector}

      {isTask ? (
        <>
          {!editing && (
            <Controller
              control={form.control}
              name="duration"
              render={({ field, fieldState }) => (
                <Field
                  fieldKey="duration"
                  label={t("Duration")}
                  error={fieldState.error?.message}
                >
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
            name="deadline"
            render={({ field, fieldState }) => (
              <Field
                fieldKey="deadline"
                label={t("Deadline")}
                error={fieldState.error?.message}
              >
                <DeadlineChipRow
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  disabled={disabled}
                  tz={tz}
                />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="sessionCount"
            render={({ field }) => (
              <Field fieldKey="sessionCount" label={t("Sessions")}>
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
        </>
      ) : (
        <Field
          fieldKey="when"
          label={t("When")}
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
        <Field fieldKey="rrule" label={t("Repeat")}>
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

      <MoreDetails startOpen={startOpen} forceOpen={detailError}>
        <Controller
          control={form.control}
          name="note"
          render={({ field }) => (
            <Field fieldKey="note" label={t("Description")}>
              <ErrorBoundary
                fallbackMessage={t(
                  "The editor didn't load. Everything else still works.",
                )}
              >
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
            <Field
              fieldKey="location"
              label={t("Location")}
              error={fieldState.error?.message}
              inputRef={locationRef}
            >
              <Input
                ref={locationRef}
                editable={!disabled}
                value={field.value ?? ""}
                onChangeText={field.onChange}
                placeholder={t("Room, building, or link (optional)")}
                accessibilityLabel={t("Location")}
                aria-invalid={!!fieldState.error}
                multiline={false}
                numberOfLines={1}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                className="h-[50px] rounded-xl border border-input bg-card px-4 text-base text-foreground"
              />
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="tags"
          render={({ field }) => (
            <Field fieldKey="tags" label={t("Tags")}>
              <TagAutocomplete
                value={field.value ?? []}
                onChange={field.onChange}
                disabled={disabled}
              />
            </Field>
          )}
        />

        {/* Every type except DND (a block, not an event) */}
        {type !== "DND" && (
          <Controller
            control={form.control}
            name="reminders"
            render={({ field }) => (
              <Field fieldKey="reminders" label={t("Reminder")}>
                <ReminderField
                  value={field.value ?? []}
                  onChange={field.onChange}
                  disabled={disabled}
                />
              </Field>
            )}
          />
        )}
      </MoreDetails>
    </View>
  );
}

/**
 * "More details" disclosure. The body mounts on first open and then stays
 * mounted (hidden), so the rich-text editor never loses what was typed when
 * the section is collapsed again.
 */
function MoreDetails({
  startOpen,
  forceOpen,
  children,
}: {
  startOpen: boolean;
  forceOpen: boolean;
  children: ReactNode;
}) {
  useLanguage();
  const [open, setOpen] = useState(startOpen);
  const [mounted, setMounted] = useState(startOpen);
  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setMounted(true);
    }
  }, [forceOpen]);

  const toggle = () => {
    haptic.select();
    setOpen((o) => !o);
    setMounted(true);
  };

  return (
    <View className="gap-[18px]">
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={t("More details")}
        accessibilityHint={
          open
            ? t("Hides description, location, tags and reminder")
            : t("Shows description, location, tags and reminder")
        }
        accessibilityState={{ expanded: open }}
        className="min-h-14 flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 active:bg-muted"
      >
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-foreground">
            {t("More details")}
          </Text>
          {!open && (
            <Text className="mt-0.5 text-[12.5px] text-muted-foreground">
              {t("Description, location, tags, reminder")}
            </Text>
          )}
        </View>
        <Animated.View
          style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
        >
          <ChevronDown size={18} className="text-muted-foreground" />
        </Animated.View>
      </Pressable>
      {mounted && (
        <View
          className="gap-[18px]"
          style={{ display: open ? "flex" : "none" }}
        >
          {children}
        </View>
      )}
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
  fieldKey,
  label,
  error,
  children,
  inputRef,
}: {
  fieldKey: FormFieldKey;
  label: string;
  error?: string;
  children: ReactNode;
  /** Text inputs hand the keyboard to this ref when the field is the first invalid one. */
  inputRef?: RefObject<InputInstance | null>;
}) {
  useLanguage();
  const register = useFormFieldRegistration();
  return (
    <View
      ref={(node) =>
        register?.(
          fieldKey,
          node
            ? { node, focus: inputRef ? () => inputRef.current?.focus() : undefined }
            : null,
        )
      }
    >
      <Text className="mb-2 text-[13.5px] font-semibold text-foreground">
        {t(label)}
      </Text>
      {children}
      {!!error && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="mt-1.5 text-xs font-medium text-destructive"
        >
          {inlineError(t(error))}
        </Text>
      )}
    </View>
  );
}
