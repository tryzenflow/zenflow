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

/** Which slice of a series a delete should hit. */
export type DeleteRecurringScope = "occurrence" | "following" | "series";

/**
 * Which flavor of series this sheet is choosing a scope for (see
 * `lib/session-series.ts`'s `SeriesKind`, minus `"none"` — the sheet never
 * opens for a non-series session) — governs copy only, not behavior; the
 * caller still owns which API calls each scope maps to.
 */
export type DeleteRecurringSheetKind = "recurring" | "task";

export interface DeleteRecurringSheetHandle {
  /** Open the chooser for the occurrence/sitting starting on `occurrenceDate`. */
  open: (occurrenceDate: Date) => void;
}

interface DeleteRecurringSheetProps {
  /** Which flavor of series this is deleting from — flexes copy. Defaults to "recurring". */
  kind?: DeleteRecurringSheetKind;
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

const COPY: Record<
  DeleteRecurringSheetKind,
  {
    title: string;
    tappedLabel: string;
    options: Option[];
  }
> = {
  recurring: {
    title: "Delete recurring session",
    tappedLabel: "Tapped occurrence",
    options: [
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
    ],
  },
  task: {
    title: "Delete session",
    tappedLabel: "This sitting",
    options: [
      {
        scope: "occurrence",
        Icon: Trash2,
        label: "This sitting",
        hint: (d) => `Only ${d} is removed.`,
      },
      {
        scope: "following",
        Icon: CalendarRange,
        label: "This and all later sittings",
        hint: (d) => `Sittings from ${d} onward are removed.`,
      },
      {
        scope: "series",
        Icon: CalendarDays,
        label: "All sittings",
        hint: () => "Delete the entire task and all its sittings.",
        destructive: true,
      },
    ],
  },
};

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
>(({ kind = "recurring", onChoose }, ref) => {
  const sheet = useBottomSheet();
  const [date, setDate] = useState<Date | null>(null);
  const { title, tappedLabel, options } = COPY[kind];

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
                {title}
              </Text>
              {!!dateLabel && (
                <Text className="mt-[3px] text-[13px] text-muted-foreground">
                  {tappedLabel} · {dateLabel}
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
            {options.map(({ scope, Icon, label, hint, destructive }) => (
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
