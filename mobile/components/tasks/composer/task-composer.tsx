import { useLanguage } from "@/hooks/use-language";
import { format, t } from "@/lib/i18n";
import { durationLabel } from "@/components/ui/duration-slider";
import { type ParseResult, parseTask } from "@/lib/task-parser";
import { DRAFT_NEW, useComposerStore } from "@/lib/composer-store";
import { Trash2, X as CloseIcon } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetScrollView,
  BottomSheetTextInput,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip-group";
import { GlassButton } from "@/components/ui/glass-button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { type SessionFormValues, hhmmToMinutes } from "@zenflow/core";
import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Pressable, View } from "react-native";
import { clockLabel } from "@/lib/slider-math";
import {
  CourseField,
  DeadlineField,
  DurationField,
  END_OF_DAY,
  END_OF_DAY_SECONDS,
  EventWhenField,
  SplitField,
  isoAt,
  todayIn,
} from "./composer-fields";
import { MoreOptions } from "./more-options";

const DEFAULT_EVENT_LENGTH = 60;
const DEFAULT_TASK_DURATION = 60;

export type ComposerKind = "TASK" | "EVENT";

export interface TaskComposerProps {
  mode: "create" | "edit";
  form: UseFormReturn<SessionFormValues>;
  tz: string;
  /** Sheet heading. */
  title: string;
  /** Second line under the heading, for example the day a new task opens on. */
  subtitle?: string;
  /** Known courses (the user's tags), offered as chips. */
  courses: string[];
  /** Locks every field and the footer while a request is in flight or offline. */
  busy?: boolean;
  /** Edit mode only: a delete control in the header. */
  onDelete?: () => void;
  /** Ids of files uploaded into the notes, for the save/cancel cleanup. */
  onNoteUpload?: (ids: string[]) => void;
  /** Runs with the validated values. */
  onValid: (values: SessionFormValues) => void;
  onInvalid: (errors: Record<string, { message?: string } | undefined>) => void;
  /** The sheet was dismissed by a swipe, the backdrop or Close. */
  onDismiss: () => void;
  /** Edit mode: the schedule of the sitting open, to bound the split. */
  editingInstance?: { scheduledStartTime: string | null; durationMinutes: number };
}

/** What the top line was read as: only the parts it named, as small pills. */
function ParsedChips({ parsed }: { parsed: ParseResult }) {
  const pills: string[] = [];
  if (parsed.course) pills.push(parsed.course);
  if (parsed.deadline) {
    const [y, m, d] = parsed.deadline.date.split("-").map(Number);
    pills.push(format(new Date(y, m - 1, d), "EEE, MMM d"));
  }
  if (parsed.startTime) pills.push(parsed.startTime);
  if (parsed.durationMinutes) pills.push(durationLabel(parsed.durationMinutes));
  if (parsed.kind === "EVENT") pills.push(t("Event"));
  if (pills.length === 0) return null;
  return (
    <View className="-mt-2 flex-row flex-wrap gap-1.5" testID="task.parsed">
      {pills.map((label) => (
        <View key={label} className="rounded-full bg-primary/15 px-3 py-1">
          <Text className="text-[13px] font-semibold text-primary">{label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The task composer: one bottom sheet for creating or editing a task or an
 * event. In create mode the top line is the whole input. It is parsed as you
 * type (course, deadline, duration, kind and start time become chips), and the
 * chips stay editable below. Edit mode uses the same fields over the saved
 * values. A new task's values are kept as a draft while the sheet is closed.
 */
export function TaskComposer({
  mode,
  form,
  tz,
  title,
  subtitle,
  courses,
  busy = false,
  onDelete,
  onNoteUpload,
  onValid,
  onInvalid,
  onDismiss,
  editingInstance,
}: TaskComposerProps) {
  useLanguage();
  const sheet = useBottomSheet();
  const create = mode === "create";
  const type = form.watch("type");
  const kind: ComposerKind = type === "TASK" ? "TASK" : "EVENT";
  const isTask = kind === "TASK";
  const saveDraft = useComposerStore((s) => s.saveDraft);
  const remember = useComposerStore((s) => s.rememberDuration);
  const [line, setLine] = useState(() => form.getValues("title") ?? "");
  const lastParse = useRef<ParseResult | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  useEffect(() => {
    sheet.open();
    // Opens once, when the composer mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The course list loads after mount: re-read the line once it arrives.
  const courseKey = courses.join("\u0000");
  useEffect(() => {
    if (create && line) applyLine(line);
    // Only when the list changes; `applyLine` reads the current props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseKey]);

  // Persist a new task's values on every change, so swiping down keeps them.
  useEffect(() => {
    if (!create) return;
    const sub = form.watch((values) => {
      saveDraft(DRAFT_NEW, values as SessionFormValues);
    });
    return () => sub.unsubscribe();
  }, [create, form, saveDraft]);

  function applyLine(raw: string) {
    setLine(raw);
    if (!create) {
      form.setValue("title", raw, { shouldValidate: false });
      return;
    }
    const r = parseTask(raw, { today: todayIn(tz), courses });
    lastParse.current = r;
    setParsed(r);
    form.setValue("title", r.title, { shouldValidate: false });

    if (r.course) {
      const tags = form.getValues("tags") ?? [];
      if (tags[0] !== r.course) form.setValue("tags", [r.course, ...tags.slice(1)]);
      const remembered = useComposerStore.getState().courseDuration[r.course];
      if (remembered && !r.durationMinutes && isTask) {
        form.setValue("duration", remembered, { shouldValidate: true });
      }
    }

    if (r.kind === "EVENT") {
      const start = r.startTime ?? "09:00";
      const length = r.durationMinutes ?? DEFAULT_EVENT_LENGTH;
      const startMin = hhmmToMinutes(start);
      form.setValue("type", r.sessionType === "TASK" ? "LECTURE" : r.sessionType);
      form.setValue("date", r.deadline?.date ?? todayIn(tz));
      form.setValue("startTime", start);
      form.setValue("endTime", clockLabel(Math.min(24 * 60 - 15, startMin + length)));
      return;
    }

    if (isTask) {
      if (r.durationMinutes) form.setValue("duration", r.durationMinutes, { shouldValidate: true });
      if (r.deadline) {
        form.setValue("deadline", isoAt(r.deadline.date, END_OF_DAY, tz, END_OF_DAY_SECONDS), {
          shouldValidate: true,
        });
      }
    }
  }

  /** Switch between a task and a fixed event, keeping the title and tags. */
  function setKind(next: ComposerKind) {
    if (next === kind) return;
    if (next === "TASK") {
      form.setValue("type", "TASK");
      form.setValue("duration", form.getValues("duration") ?? DEFAULT_TASK_DURATION);
      form.setValue("sessionCount", form.getValues("sessionCount") ?? 1);
      return;
    }
    const day = form.getValues("date") || todayIn(tz);
    form.setValue("type", "LECTURE");
    form.setValue("date", day);
    form.setValue("startTime", "09:00");
    form.setValue("endTime", clockLabel(9 * 60 + DEFAULT_EVENT_LENGTH));
    form.setValue("rrule", undefined);
  }

  const submit = form.handleSubmit((values) => {
    if (create && values.type === "TASK" && values.tags?.[0] && values.duration) {
      remember(values.tags[0], values.duration);
    }
    onValid(values);
  }, onInvalid);

  const submitLabel = busy
    ? create
      ? t("Adding…")
      : t("Saving…")
    : create
      ? t("Schedule it")
      : t("Save changes");

  return (
    <BottomSheet>
      <BottomSheetContent
        ref={sheet.ref}
        snapPoints={["94%"]}
        enableDynamicSizing={false}
        onDismiss={onDismiss}
      >
        <View className="flex-1">
          <View className="flex-row items-center justify-between gap-3 px-5 pb-3 pt-1">
            <View className="min-w-0 flex-1">
              <Text testID="task.composer.title" className="text-[19px] font-bold tracking-tight">
                {title}
              </Text>
              {!!subtitle && (
                <Text className="mt-[3px] text-[13px] text-muted-foreground">{subtitle}</Text>
              )}
            </View>
            <View className="flex-row items-center gap-2.5">
              {onDelete && !busy && (
                <Pressable
                  testID="task.delete"
                  onPress={onDelete}
                  accessibilityLabel={t("Delete session")}
                  className="size-11 items-center justify-center rounded-full bg-destructive/15"
                >
                  <Trash2 size={20} className="text-destructive" />
                </Pressable>
              )}
              <GlassButton
                testID="task.close"
                icon={CloseIcon}
                onPress={() => sheet.close()}
                accessibilityLabel={t("Close")}
              />
            </View>
          </View>

          <BottomSheetScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingBottom: 24, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {create && (
              <View className="flex-row gap-2" testID="task.kind">
                <Chip
                  testID="task.kind.task"
                  label={t("Task")}
                  active={isTask}
                  disabled={busy}
                  onPress={() => setKind("TASK")}
                />
                <Chip
                  testID="task.kind.event"
                  label={t("Event")}
                  active={!isTask}
                  disabled={busy}
                  onPress={() => setKind("EVENT")}
                />
              </View>
            )}

            <BottomSheetTextInput
              testID="task.title"
              editable={!busy}
              value={line}
              onChangeText={applyLine}
              placeholder={
                create
                  ? t("Essay due Friday 3h")
                  : t("What needs doing?")
              }
              accessibilityLabel={t("What needs doing?")}
              returnKeyType="done"
              className={cn(
                "h-14 rounded-2xl border border-primary/30 bg-glass/70 dark:bg-glass/[0.07] px-5 text-[18px] text-foreground dark:border-primary/25",
              )}
            />
            {create && parsed ? <ParsedChips parsed={parsed} /> : null}
            {form.formState.errors.title?.message && (
              <Text className="-mt-3 text-[12.5px] font-medium text-destructive">
                {t(form.formState.errors.title.message)}
              </Text>
            )}

            {isTask ? (
              <>
                <DeadlineField form={form} tz={tz} editing={!create} disabled={busy} />
                {create && <DurationField form={form} disabled={busy} />}
                <SplitField form={form} disabled={busy} />
              </>
            ) : (
              <EventWhenField form={form} tz={tz} disabled={busy} />
            )}

            <CourseField form={form} courses={courses} disabled={busy} />

            <MoreOptions
              form={form}
              tz={tz}
              disabled={busy}
              onNoteUpload={onNoteUpload}
              noteInitialValue={form.getValues("note") ?? ""}
            />
          </BottomSheetScrollView>

          <View
            className="gap-2 border-t border-border bg-background px-5 pb-6 pt-3"
            testID="task.footer"
          >
            <Button
              testID="task.save"
              className="h-[52px] w-full"
              disabled={busy}
              onPress={() => void submit()}
            >
              <Text className="text-base font-semibold text-primary-foreground">
                {submitLabel}
              </Text>
            </Button>
          </View>
        </View>
      </BottomSheetContent>
    </BottomSheet>
  );
}
