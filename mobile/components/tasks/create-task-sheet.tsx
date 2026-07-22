import { createTask } from "@/api/tasks";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFooter,
  BottomSheetScrollView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useTaskForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import { placementToastMessage } from "@/lib/task-toasts";
import type { BottomSheetFooterProps } from "@gorhom/bottom-sheet";
import type { TaskFormValues } from "@zenflow/core";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { View } from "react-native";
import { TaskSheetFields } from "./task-sheet-fields";

const DEFAULT_DURATION = 60;

const EMPTY_DEFAULTS: TaskFormValues = {
  title: "",
  duration: DEFAULT_DURATION,
  tags: [],
  note: "",
  deadline: "",
};

export type CreateTaskSheetHandle = {
  /**
   * Pre-filled scheduled start (already snapped to the 15-min grid, in the
   * user's tz wall clock) is optional — shown in the subtitle, informational
   * only (the deadline chip row, not this, is what the schema actually
   * validates).
   */
  open: (initialStart?: Date) => void;
};

/**
 * `CreateTaskSheet` — RN port of
 * `frontend/src/components/tasks/create-task-dialog.tsx` on
 * `@gorhom/bottom-sheet` v5 (RN migration Phase 5 / GitHub issue #20).
 *
 * Imperative-handle controlled (`ref.current.open(initialStart?)`, no
 * internal trigger UI) so the calendar's long-press-empty-slot gesture (and,
 * until Phase 2's real day timeline lands, the minimal Day-screen wiring in
 * `app/(app)/index.tsx`) can open it pre-filled with a snapped start time.
 *
 * This used to be driven by an external `open`/`onOpenChange` boolean prop
 * pair bridged through `useControlledBottomSheet`, which called
 * `sheetRef.current?.present()` inside a `useEffect` keyed on `open` — i.e.
 * *after* a state update flowed through a re-render, not synchronously
 * inside the triggering `Pressable`'s press handler. That's a categorically
 * different call shape from every other working sheet in the app (see
 * `components/onboarding/time-picker-row.tsx`,
 * `components/settings/duration-mode-picker-row.tsx`): they call
 * `useBottomSheet().open()` straight from a press handler. Matching that
 * shape here (imperative `.open()` called directly inside the FAB's
 * `onPress` etc. in `app/(app)/index.tsx`) is the fix.
 */
export const CreateTaskSheet = forwardRef<
  CreateTaskSheetHandle,
  { onCreated: () => void }
>(function CreateTaskSheet({ onCreated }, ref) {
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const bottomSheet = useBottomSheet();
  const [initialStart, setInitialStart] = useState<Date | undefined>(undefined);

  const form = useTaskForm({ defaultValues: EMPTY_DEFAULTS });
  const loading = form.formState.isSubmitting;

  useImperativeHandle(
    ref,
    () => ({
      open: (start?: Date) => {
        setInitialStart(start);
        form.reset(EMPTY_DEFAULTS);
        bottomSheet.open();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function onSubmit(values: TaskFormValues) {
    if (!user) return;
    try {
      const response = await createTask({
        title: values.title,
        note: values.note || null,
        durationMinutes: values.duration,
        tags: values.tags,
        deadline: values.deadline,
      });
      onCreated();
      const { message, variant } = placementToastMessage(response.task, user);
      toast(message, variant === "success" ? "success" : "destructive");
      bottomSheet.close();
    } catch (error) {
      const message =
        (isAxiosError(error) &&
          (error.response?.data as { message?: string } | undefined)
            ?.message) ||
        "Something went wrong when creating a new task";
      toast(message, "destructive");
    }
  }

  function onInvalid(errors: Record<string, { message?: string } | undefined>) {
    const first = Object.values(errors)[0];
    if (first?.message) toast(String(first.message), "destructive");
  }

  const renderFooter = useCallback(
    (footerProps: BottomSheetFooterProps) => (
      <BottomSheetFooter bottomSheetFooterProps={footerProps}>
        <Button
          className="h-[52px] w-full"
          disabled={loading}
          onPress={form.handleSubmit(onSubmit, onInvalid)}
        >
          <Text className="text-base font-semibold text-primary-foreground">
            {loading ? "Adding…" : "Add task"}
          </Text>
        </Button>
      </BottomSheetFooter>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, user],
  );

  const subtitle = initialStart
    ? `${format(initialStart, "EEEE, MMM d")} · starts ${format(
        initialStart,
        "h:mm a",
      )}`
    : "New task";

  return (
    <BottomSheet>
      <BottomSheetContent
        ref={bottomSheet.ref}
        enableDynamicSizing={false}
        snapPoints={["90%"]}
        footerComponent={renderFooter}
      >
        <BottomSheetScrollView
          className="px-5 pt-1"
          contentContainerStyle={{ paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="mb-4">
            <Text className="text-[19px] font-bold tracking-tight">
              New task
            </Text>
            <Text className="mt-[3px] text-[13px] text-muted-foreground">
              {subtitle}
            </Text>
          </View>
          <TaskSheetFields form={form} tz={tz} disabled={loading} />
        </BottomSheetScrollView>
      </BottomSheetContent>
    </BottomSheet>
  );
});
