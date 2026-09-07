import { CalendarClock, ChevronRight, Plus } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import type { Session } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { forwardRef, useImperativeHandle, useState } from "react";
import { Pressable, View } from "react-native";

export interface BlockActionsSheetHandle {
  open: (session: Session) => void;
}

interface BlockActionsSheetProps {
  /** "Move to…" — hands off to the shared `RescheduleSheet`. */
  onReschedule: (session: Session) => void;
  /** "Add study session before this" — seeds a new task whose deadline is
   * this block's start. */
  onSessionBefore: (session: Session) => void;
}

/**
 * The menu a still-finger long-press on a Day/Week block opens — mirrors the
 * context menu in `mockups/day-view.html` ("Create session before this" + the
 * move affordance), folded into one sheet. Picking a row closes this and runs
 * the matching flow.
 */
export const BlockActionsSheet = forwardRef<
  BlockActionsSheetHandle,
  BlockActionsSheetProps
>(({ onReschedule, onSessionBefore }, ref) => {
  const sheet = useBottomSheet();
  const [session, setSession] = useState<Session | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      open: (next) => {
        setSession(next);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        sheet.open();
      },
    }),
    [sheet],
  );

  const run = (fn: (s: Session) => void) => {
    if (!session) return;
    const s = session;
    sheet.close();
    // Let this sheet finish dismissing before the next flow runs — it may open
    // its own bottom sheet (Move to…) or navigate away.
    setTimeout(() => fn(s), 180);
  };

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref}>
        <BottomSheetView hadHeader={false} className="gap-1 pt-2">
          <View className="mb-1 min-w-0 px-1">
            <Text
              numberOfLines={1}
              className="text-[15px] font-bold tracking-tight"
            >
              {session?.title ?? ""}
            </Text>
          </View>

          <Pressable
            onPress={() => run(onSessionBefore)}
            className="flex-row items-center gap-3 rounded-xl bg-primary/10 px-3 py-3.5 active:opacity-70"
          >
            <Plus size={18} className="text-primary" />
            <Text className="flex-1 text-[14px] font-semibold text-primary">
              Add study session before this
            </Text>
            <ChevronRight size={16} className="text-primary/60" />
          </Pressable>

          <Pressable
            onPress={() => run(onReschedule)}
            className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70"
          >
            <CalendarClock size={18} className="text-foreground" />
            <Text className="flex-1 text-[14px] font-medium text-foreground">
              Move to…
            </Text>
            <ChevronRight size={16} className="text-muted-foreground" />
          </Pressable>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
});

BlockActionsSheet.displayName = "BlockActionsSheet";
