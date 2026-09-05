import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clock,
  X,
} from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Text } from "@/components/ui/text";
import { getSeriesKind } from "@/lib/session-series";
import { cn } from "@/lib/utils";
import type { Session } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import {
  type ComponentType,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, View } from "react-native";

/** Which slice of a series a reschedule/resize should hit. */
export type UpdateRecurringScope = "occurrence" | "following" | "series";

export interface PendingSessionUpdate {
  scheduledStartTime: string;
  durationMinutes: number;
}

export interface UpdateRecurringSheetHandle {
  /** Open the scope chooser for `session`, which is about to be moved/resized
   * to `pending`. `onResolve` fires exactly once — with the chosen scope (and
   * whether to skip conflicting landings), or `null` if the sheet was
   * dismissed without a pick. */
  open: (
    session: Session,
    pending: PendingSessionUpdate,
    onResolve: (
      choice: {
        scope: UpdateRecurringScope;
        skipConflicting: boolean;
      } | null,
    ) => void,
  ) => void;
}

interface Option {
  scope: UpdateRecurringScope;
  Icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  hint: string;
  /** Fires `onResolve` immediately on tap instead of expanding the
   * skip-conflicting confirmation row (only "This sitting", the single-
   * instance TASK row, behaves this way — mirrors `delete-recurring-sheet`'s
   * one-tap-and-close rows). */
  immediate?: boolean;
}

const COPY: Record<"recurring" | "task", { title: string; options: Option[] }> =
  {
    recurring: {
      title: "Update recurring session",
      options: [
        {
          scope: "following",
          Icon: CalendarRange,
          label: "This and following",
          hint: "Occurrences from this one onward move to the new time.",
        },
        {
          scope: "series",
          Icon: CalendarDays,
          label: "All occurrences",
          hint: "Every occurrence in the series moves to the new time.",
        },
      ],
    },
    task: {
      title: "Update session",
      options: [
        {
          scope: "occurrence",
          Icon: Clock,
          label: "This sitting",
          hint: "Only this sitting moves.",
          immediate: true,
        },
        {
          scope: "following",
          Icon: CalendarRange,
          label: "This and later sittings",
          hint: "Later sittings keep their dates but move to the new time.",
        },
        {
          scope: "series",
          Icon: CalendarDays,
          label: "All sittings",
          hint: "Every sitting keeps its date but moves to the new time.",
        },
      ],
    },
  };

type Resolve = (
  choice: { scope: UpdateRecurringScope; skipConflicting: boolean } | null,
) => void;

/**
 * Bottom-sheet confirmation for "which occurrences should this
 * drag/resize/reschedule apply to?" — opened by `RescheduleSheet` and
 * `DayTimeline`'s drag-drop whenever the touched session belongs to a series
 * (`getSeriesKind` !== "none"). Modeled directly on
 * `tasks/delete-recurring-sheet.tsx`'s structure/styling, with one behavior
 * difference: the two "spreads to multiple rows" scopes ("This and
 * following" / "All occurrences"|"All sittings") expand an inline
 * skip-conflicting checkbox + confirm row instead of firing immediately,
 * since silently overwriting a sibling into a conflict is riskier than a
 * delete.
 *
 * Everything lives in ONE `BottomSheetView` (no separate `BottomSheetHeader`)
 * — see `delete-recurring-sheet.tsx`'s comment for why a sibling header
 * breaks `enableDynamicSizing` measurement.
 */
export const UpdateRecurringSheet = forwardRef<
  UpdateRecurringSheetHandle,
  object
>((_props, ref) => {
  const sheet = useBottomSheet();
  const [kind, setKind] = useState<"recurring" | "task">("recurring");
  const [expanded, setExpanded] = useState<UpdateRecurringScope | null>(null);
  const [skipConflicting, setSkipConflicting] = useState(false);
  const resolveRef = useRef<Resolve | null>(null);
  // Guards `onDismiss` (fires on ANY close, including a deliberate row pick
  // that already called `sheet.close()` itself) from also calling
  // `onResolve(null)` after a real choice already resolved it.
  const resolvedRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      open: (session, _pending, onResolve) => {
        const seriesKind = getSeriesKind(session);
        if (seriesKind === "none") {
          // Defensive guard — callers are responsible for only opening
          // this sheet for a session that belongs to a series.
          onResolve(null);
          return;
        }
        setKind(seriesKind);
        setExpanded(null);
        setSkipConflicting(false);
        resolveRef.current = onResolve;
        resolvedRef.current = false;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        sheet.open();
      },
    }),
    [sheet],
  );

  const { title, options } = COPY[kind];

  function resolve(
    choice: { scope: UpdateRecurringScope; skipConflicting: boolean } | null,
  ) {
    resolvedRef.current = true;
    const onResolve = resolveRef.current;
    resolveRef.current = null;
    onResolve?.(choice);
  }

  function pickImmediate(scope: UpdateRecurringScope) {
    Haptics.selectionAsync().catch(() => {});
    sheet.close();
    resolve({ scope, skipConflicting: false });
  }

  function toggleExpanded(scope: UpdateRecurringScope) {
    Haptics.selectionAsync().catch(() => {});
    setExpanded((prev) => (prev === scope ? null : scope));
    setSkipConflicting(false);
  }

  function confirmExpanded(scope: UpdateRecurringScope) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    sheet.close();
    resolve({ scope, skipConflicting });
  }

  function handleDismiss() {
    if (resolvedRef.current) return;
    resolve(null);
  }

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref} onDismiss={handleDismiss}>
        <BottomSheetView hadHeader={false} className="gap-4 pt-2">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[19px] font-bold tracking-tight">
                {title}
              </Text>
              <Text className="mt-[3px] text-[13px] text-muted-foreground">
                Choose which occurrences pick up the new time.
              </Text>
            </View>
            <Pressable
              onPress={sheet.close}
              accessibilityLabel="Cancel"
              className="h-8 w-8 items-center justify-center rounded-full bg-muted"
            >
              <X size={16} className="text-muted-foreground" />
            </Pressable>
          </View>

          <View className="gap-2.5">
            {options.map(({ scope, Icon, label, hint, immediate }) => {
              const isExpanded = expanded === scope;
              return (
                <View key={scope}>
                  <Pressable
                    onPress={() =>
                      immediate ? pickImmediate(scope) : toggleExpanded(scope)
                    }
                    className={cn(
                      "flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3",
                      isExpanded &&
                        "rounded-b-none border-b-0 border-primary bg-primary/10",
                    )}
                  >
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-muted">
                      <Icon size={17} className="text-muted-foreground" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-semibold text-foreground">
                        {label}
                      </Text>
                      <Text className="mt-0.5 text-[12.5px] text-muted-foreground">
                        {hint}
                      </Text>
                    </View>
                    {!immediate && (
                      <CalendarClock
                        size={16}
                        className="text-muted-foreground"
                      />
                    )}
                  </Pressable>

                  {isExpanded && (
                    <View className="gap-3 rounded-b-2xl border border-t-0 border-primary bg-primary/10 px-3.5 pb-3.5 pt-2.5">
                      <Pressable
                        onPress={() => setSkipConflicting((v) => !v)}
                        className="flex-row items-center gap-2.5"
                      >
                        <Checkbox
                          checked={skipConflicting}
                          onCheckedChange={setSkipConflicting}
                        />
                        <Text className="flex-1 text-[13px] text-foreground">
                          Skip ones that would conflict
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => confirmExpanded(scope)}
                        className="items-center justify-center rounded-xl bg-primary py-2.5"
                      >
                        <Text className="text-[14px] font-semibold text-primary-foreground">
                          Confirm
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
});

UpdateRecurringSheet.displayName = "UpdateRecurringSheet";
