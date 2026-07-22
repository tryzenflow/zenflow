import { createTask } from "@/api/tasks";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFooter,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useControlledBottomSheet } from "@/hooks/use-controlled-bottom-sheet";
import { useTaskForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import { placementToastMessage } from "@/lib/task-toasts";
import type { BottomSheetFooterProps } from "@gorhom/bottom-sheet";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import type { TaskFormValues } from "@zenflow/core";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { TaskSheetFields } from "./task-sheet-fields";

const DEFAULT_DURATION = 60;

/**
 * `CreateTaskSheet` — RN port of
 * `frontend/src/components/tasks/create-task-dialog.tsx` on
 * `@gorhom/bottom-sheet` v5 (RN migration Phase 5 / GitHub issue #20).
 *
 * Externally controlled (`open`/`onOpenChange`, no internal trigger) so the
 * calendar's long-press-empty-slot gesture (and, until Phase 2's real day
 * timeline lands, the minimal Day-screen wiring in `app/(app)/index.tsx`)
 * can open it pre-filled with a snapped start time.
 */
export function CreateTaskSheet({
  open,
  onOpenChange,
  initialStart,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled scheduled start (already snapped to the 15-min grid, in the
   * user's tz wall clock) — shown in the subtitle, informational only (the
   * deadline chip row, not this, is what the schema actually validates). */
  initialStart?: Date;
  onCreated: () => void;
}) {
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const sheetRef = useControlledBottomSheet(open);

  const form = useTaskForm({
    defaultValues: {
      title: "",
      duration: DEFAULT_DURATION,
      tags: [],
      note: "",
      deadline: "",
    },
  });
  const loading = form.formState.isSubmitting;

  // Reset to a clean slate every time the sheet (re)opens — mirrors the web
  // dialog's `form.reset()` after a successful create / on cancel.
  useEffect(() => {
    if (open) {
      form.reset({
        title: "",
        duration: DEFAULT_DURATION,
        tags: [],
        note: "",
        deadline: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      onOpenChange(false);
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
        ref={sheetRef}
        onDismiss={() => onOpenChange(false)}
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
}
