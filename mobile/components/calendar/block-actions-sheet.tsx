import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { useCheckOff } from "@/hooks/use-check-off";
import {
  CalendarClock,
  Check,
  ChevronRight,
  Lock,
  MinusCircle,
  Plus,
  Trash2,
} from "@/components/Icons";
import { pinSession, removeSession, unpinSession } from "@/api/tasks";
import { UNDO_WINDOW_MS, deferCommit } from "@/lib/undo";
import { hideSessions } from "@/lib/hidden-sessions";
import { useToast } from "@/components/ui/toast";
import { showErrorToast } from "@/lib/task-toasts";
import { checkStateOf } from "@/lib/today-summary";
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
  useLanguage();
  const sheet = useBottomSheet();
  const checkOff = useCheckOff();
  const { toast } = useToast();
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

  const toggleCheck = (kind: "complete" | "skip", on: boolean) => {
    if (!session) return;
    const s = session;
    sheet.close();
    void checkOff({ id: s.id, title: s.title }, kind, on);
  };

  // One tap: a series member goes alone (this occurrence or sitting), and
  // nothing is sent until the undo window closes.
  const quickDelete = () => {
    if (!session) return;
    const s = session;
    sheet.close();
    const unhide = hideSessions({ id: s.id });
    const cancelCommit = deferCommit(() => {
      // On success the hide stays: the deleted id never returns, and the
      // refetch drops the row without a flash.
      removeSession(s.id).catch((error: unknown) => {
        unhide();
        showErrorToast(toast, error, t("Couldn't delete session"), "trash");
      });
    }, UNDO_WINDOW_MS);
    const cancel = () => {
      cancelCommit();
      unhide();
    };
    toast({
      title: t("Session deleted"),
      icon: "trash",
      duration: UNDO_WINDOW_MS,
      action: { label: t("Undo"), onPress: cancel },
    });
  };

  const togglePin = () => {
    if (!session) return;
    const s = session;
    const pinned = s.anchor === "PINNED";
    sheet.close();
    (pinned ? unpinSession(s.id) : pinSession(s.id)).catch((error: unknown) =>
      showErrorToast(
        toast,
        error,
        pinned ? t("Couldn't unpin this session") : t("Couldn't pin this session"),
        "calendar-x",
      ),
    );
  };

  const state = session ? checkStateOf(session) : "open";

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

          {session?.type === "TASK" ? (
            <>
          <Pressable
            testID="block-action-done"
            onPress={() => toggleCheck("complete", state !== "done")}
            className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70"
          >
            <Check size={18} className="text-foreground" />
            <Text className="flex-1 text-[14px] font-medium text-foreground">
              {state === "done" ? t("Mark as not done") : t("Mark as done")}
            </Text>
          </Pressable>

          <Pressable
            testID="block-action-skip"
            onPress={() => toggleCheck("skip", state !== "skipped")}
            className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70"
          >
            <MinusCircle size={18} className="text-foreground" />
            <Text className="flex-1 text-[14px] font-medium text-foreground">
              {state === "skipped" ? t("Undo skip") : t("Skip this session")}
            </Text>
          </Pressable>
            </>
          ) : null}

          <Pressable
            onPress={() => run(onSessionBefore)}
            className="flex-row items-center gap-3 rounded-xl bg-primary/10 px-3 py-3.5 active:opacity-70"
          >
            <Plus size={18} className="text-primary" />
            <Text className="flex-1 text-[14px] font-semibold text-primary">
              {t("Add study session before this")}
            </Text>
            <ChevronRight size={16} className="text-primary/60" />
          </Pressable>

          {session?.type === "TASK" && (
            <Pressable
              testID="block-action-pin"
              onPress={togglePin}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70"
            >
              <Lock size={18} className="text-foreground" />
              <Text className="flex-1 text-[14px] font-medium text-foreground">
                {session.anchor === "PINNED" ? t("Unpin") : t("Pin in place")}
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => run(onReschedule)}
            className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70"
          >
            <CalendarClock size={18} className="text-foreground" />
            <Text className="flex-1 text-[14px] font-medium text-foreground">
              {t("Move to…")}
            </Text>
            <ChevronRight size={16} className="text-muted-foreground" />
          </Pressable>

          <Pressable
            testID="block-action-delete"
            onPress={quickDelete}
            className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70"
          >
            <Trash2 size={18} className="text-destructive" />
            <Text className="flex-1 text-[14px] font-medium text-destructive">
              {t("Delete")}
            </Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
});

BlockActionsSheet.displayName = "BlockActionsSheet";
