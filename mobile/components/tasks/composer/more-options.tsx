import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { ChevronDown } from "@/components/Icons";
import { ErrorBoundary } from "@/components/error-boundary";
import { BottomSheetTextInput } from "@/components/ui/bottom-sheet";
import { ChipGroup } from "@/components/ui/chip-group";
import { FieldCard } from "@/components/ui/field-card";
import { SentenceRepeat } from "@/components/ui/sentence-repeat";
import { Text } from "@/components/ui/text";
import { DescriptionField } from "@/components/tasks/note/description-field";
import { TagAutocomplete } from "@/components/tasks/tag-autocomplete";
import { cn } from "@/lib/utils";
import {
  type SessionFormType,
  type SessionFormValues,
} from "@zenflow/core";
import { useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Pressable, View } from "react-native";
import { todayIn } from "./composer-fields";
import { ReminderField } from "./reminder-field";

const FIXED_TYPES: { value: SessionFormType; label: string }[] = [
  { value: "ASSIGNMENT", label: "Assignment" },
  { value: "EXAM", label: "Exam" },
  { value: "LECTURE", label: "Lecture" },
  { value: "DND", label: "Do not disturb" },
];

/**
 * The less common fields, folded away by default: reminders, repeat (fixed
 * types only), location, notes, the other tags, and the session type of an
 * event. The first tag is the course, so the tags field lists the rest.
 */
export function MoreOptions({
  form,
  tz,
  disabled,
  onNoteUpload,
  noteInitialValue,
  defaultOpen = false,
}: {
  form: UseFormReturn<SessionFormValues>;
  tz: string;
  disabled?: boolean;
  onNoteUpload?: (ids: string[]) => void;
  noteInitialValue: string;
  defaultOpen?: boolean;
}) {
  useLanguage();
  const [open, setOpen] = useState(defaultOpen);
  const type = form.watch("type");
  const isFixed = type !== "TASK";
  const tags = form.watch("tags") ?? [];

  return (
    <View className="gap-3">
      <Pressable
        testID="task.more"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        className="min-h-[44px] flex-row items-center justify-between rounded-xl px-1"
      >
        <Text className="text-[14px] font-semibold text-foreground">
          {t("More options")}
        </Text>
        <ChevronDown
          size={18}
          className={cn("text-muted-foreground", open && "rotate-180")}
        />
      </Pressable>

      {open && (
        <View className="gap-3" testID="task.more.body">
          {type !== "DND" && (
            <FieldCard
              label="Reminder"
              hint="New tasks use your default reminder from Settings."
              testID="task.reminder"
            >
              <Controller
                control={form.control}
                name="reminders"
                render={({ field }) => (
                  <ReminderField
                    value={field.value ?? []}
                    onChange={field.onChange}
                    disabled={disabled}
                  />
                )}
              />
            </FieldCard>
          )}

          {isFixed && (
            <FieldCard label="Type" testID="task.type">
              <ChipGroup<SessionFormType>
                testID="task.type.chip"
                value={type}
                disabled={disabled}
                onChange={(next) => form.setValue("type", next)}
                options={FIXED_TYPES}
              />
            </FieldCard>
          )}

          {isFixed && (
            <FieldCard label="Repeat" testID="task.repeat">
              <Controller
                control={form.control}
                name="rrule"
                render={({ field }) => (
                  <SentenceRepeat
                    testID="task.repeat.sentence"
                    value={field.value ?? undefined}
                    onChange={field.onChange}
                    anchorDate={form.watch("date") || todayIn(tz)}
                    disabled={disabled}
                  />
                )}
              />
            </FieldCard>
          )}

          <FieldCard label="Location" testID="task.location.card">
            <Controller
              control={form.control}
              name="location"
              render={({ field }) => (
                <BottomSheetTextInput
                  testID="task.location"
                  editable={!disabled}
                  value={field.value ?? ""}
                  onChangeText={field.onChange}
                  placeholder={t("Room, building, or link (optional)")}
                  accessibilityLabel={t("Location")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="h-[50px] rounded-xl border border-glass-edge/35 bg-glass/70 px-4 text-base text-foreground dark:border-glass-edge/25"
                />
              )}
            />
          </FieldCard>

          <FieldCard
            label="Notes"
            error={form.formState.errors.note?.message}
            testID="task.note"
          >
            <ErrorBoundary
              fallbackMessage={t(
                "The editor didn't load. Everything else still works.",
              )}
            >
              <DescriptionField
                initialValue={noteInitialValue}
                onChange={(next) => form.setValue("note", next)}
                onUpload={onNoteUpload}
                disabled={disabled}
              />
            </ErrorBoundary>
          </FieldCard>

          <FieldCard label="Tags" testID="task.tags">
            <TagAutocomplete
              value={tags.slice(1)}
              disabled={disabled}
              onChange={(rest) =>
                form.setValue("tags", tags[0] ? [tags[0], ...rest] : rest)
              }
            />
          </FieldCard>
        </View>
      )}
    </View>
  );
}
