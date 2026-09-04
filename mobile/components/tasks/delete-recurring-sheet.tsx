import { CalendarDays, CalendarRange, Trash2, X } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import {
  type ComponentType,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { Pressable, View } from "react-native";

/** Which slice of a recurring series a delete should hit. */
export type DeleteRecurringScope = "occurrence" | "following" | "series";

export interface DeleteRecurringSheetHandle {
  /** Open the chooser for the occurrence starting on `occurrenceDate`. */
  open: (occurrenceDate: Date) => void;
}

interface DeleteRecurringSheetProps {
  /** Called with the chosen scope once the user taps a row (sheet closes itself). */
  onChoose: (scope: DeleteRecurringScope) => void;
}

interface Option {
  scope: DeleteRecurringScope;
  Icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  hint: (date: string) => string;
  destructive?: boolean;
}

const OPTIONS: Option[] = [
  {
    scope: "occurrence",
    Icon: Trash2,
    label: "This occurrence",
    hint: (d) => `Only ${d} is removed.`,
  },
  {
    scope: "following",
    Icon: CalendarRange,
    label: "This and all following",
    hint: (d) => `The series ends before ${d}.`,
  },
  {
    scope: "series",
    Icon: CalendarDays,
    label: "All occurrences",
    hint: () => "Delete the entire series.",
    destructive: true,
  },
];

/**
 * Bottom-sheet replacement for the OS `Alert` that used to ask "delete which
 * part of this recurring session?" — same three choices, in the app's own
 * card/row idiom. Opened imperatively from the edit screen's Delete button.
 *
 * Everything lives in ONE `BottomSheetView` (no separate `BottomSheetHeader`):
 * with `enableDynamicSizing` the library only measures the first
 * `BottomSheetView`, so a sibling header renders un-measured and the content
 * view gets laid out on top of it — the "content overlaps the header" bug.
 * (`settings/profile-row.tsx` uses this same single-view shape.)
 */
export const DeleteRecurringSheet = forwardRef<
  DeleteRecurringSheetHandle,
  DeleteRecurringSheetProps
>(({ onChoose }, ref) => {
  const sheet = useBottomSheet();
  const [date, setDate] = useState<Date | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      open: (occurrenceDate) => {
        setDate(occurrenceDate);
        sheet.open();
      },
    }),
    [sheet],
  );

  const dateLabel = date ? format(date, "EEE, MMM d") : "";

  function pick(scope: DeleteRecurringScope) {
    Haptics.selectionAsync().catch(() => {});
    sheet.close();
    onChoose(scope);
  }

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref}>
        <BottomSheetView hadHeader={false} className="gap-4 pt-2">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[19px] font-bold tracking-tight">
                Delete recurring session
              </Text>
              {!!dateLabel && (
                <Text className="mt-[3px] text-[13px] text-muted-foreground">
                  Tapped occurrence · {dateLabel}
                </Text>
              )}
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
            {OPTIONS.map(({ scope, Icon, label, hint, destructive }) => (
              <Pressable
                key={scope}
                onPress={() => pick(scope)}
                className={cn(
                  "flex-row items-center gap-3 rounded-2xl border px-3.5 py-3",
                  destructive
                    ? "border-destructive/35 bg-destructive/5"
                    : "border-border bg-card",
                )}
              >
                <View
                  className={cn(
                    "h-9 w-9 items-center justify-center rounded-xl",
                    destructive ? "bg-destructive/15" : "bg-muted",
                  )}
                >
                  <Icon
                    size={17}
                    className={
                      destructive ? "text-destructive" : "text-muted-foreground"
                    }
                  />
                </View>
                <View className="min-w-0 flex-1">
                  <Text
                    className={cn(
                      "text-[15px] font-semibold",
                      destructive ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {label}
                  </Text>
                  <Text className="mt-0.5 text-[12.5px] text-muted-foreground">
                    {hint(dateLabel)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
});

DeleteRecurringSheet.displayName = "DeleteRecurringSheet";
