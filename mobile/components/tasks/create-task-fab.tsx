import { Plus } from "@/components/Icons";
import {
  CreateTaskSheet,
  type CreateTaskSheetHandle,
} from "@/components/tasks/create-task-sheet";
import { snapToNearestLaterQuarterHour, zonedNow } from "@zenflow/core";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { Pressable } from "react-native";

export type CreateTaskFabHandle = {
  /** Opens the sheet pre-filled with "now" snapped to the next 15-min mark
   * — same behaviour the FAB's own `onPress` uses, exposed so a screen can
   * trigger it from another gesture too (e.g. Day's long-press-empty-area). */
  openAtNow: () => void;
};

/**
 * Floating "+" create-task button + its paired `CreateTaskSheet`, factored
 * out of `app/(app)/index.tsx` so `week.tsx`/`month.tsx` (still Phase 3/4
 * stub screens) can offer task creation too instead of only the Day tab.
 *
 * `onCreated` is intentionally screen-supplied: Day has a task list to
 * `refetch`, while Week/Month have no task list yet (see their own
 * doc comments) — see call sites for what each passes.
 */
export const CreateTaskFab = forwardRef<
  CreateTaskFabHandle,
  {
    tz: string;
    onCreated: () => void;
  }
>(function CreateTaskFab({ tz, onCreated }, ref) {
  const createSheetRef = useRef<CreateTaskSheetHandle>(null);

  function openAtNow() {
    const now = zonedNow(tz);
    const snappedMinutes = snapToNearestLaterQuarterHour(
      now.getHours() * 60 + now.getMinutes(),
    );
    const snapped = new Date(now);
    snapped.setHours(0, Math.min(snappedMinutes, 23 * 60 + 45), 0, 0);
    createSheetRef.current?.open(snapped);
  }

  useImperativeHandle(ref, () => ({ openAtNow }), [tz]);

  return (
    <>
      <Pressable
        onPress={openAtNow}
        accessibilityLabel="New task"
        className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg"
      >
        <Plus size={22} className="text-primary-foreground" />
      </Pressable>

      <CreateTaskSheet ref={createSheetRef} onCreated={onCreated} />
    </>
  );
});
