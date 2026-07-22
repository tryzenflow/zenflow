import { Check, Clock } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFlatList,
  BottomSheetOpenTrigger,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { minutesToLabel } from "@/utils/preferences";
import type { ListRenderItemInfo } from "react-native";
import { Pressable, View } from "react-native";

const STEP = 15;
// Flat 15-minute grid from 12:00 AM through 11:45 PM, plus a trailing 11:59 PM
// entry — the "Today"/"Tomorrow" deadline chips default to 23:59 (end of day),
// which doesn't fall on the 15-minute grid, so it needs its own selectable row.
const TIME_OPTIONS = [
  ...Array.from({ length: 1440 / STEP }, (_, i) => i * STEP),
  1439,
];

/**
 * Compact "time pill" field for the deadline chip row's Today/Tomorrow/
 * Custom time-of-day picker (`mockups/task-sheets.html`'s grid-cols-2 time
 * button). Opens a nested `@gorhom/bottom-sheet` list — stacking a second
 * modal on top of the create/edit sheet is a supported pattern under one
 * shared `BottomSheetModalProvider` (mounted once in `app/_layout.tsx`),
 * same mechanism `components/ui/combobox.tsx` already relies on.
 */
export function InlineTimeField({
  value,
  onChange,
  disabled,
  label = "Pick a time",
}: {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const bottomSheet = useBottomSheet();

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild disabled={disabled}>
        <Pressable
          className={cn(
            "h-[46px] flex-row items-center justify-between rounded-xl border border-input bg-card px-3",
            disabled && "opacity-50",
          )}
        >
          <Text className="text-[13.5px] font-medium text-foreground">
            {minutesToLabel(value)}
          </Text>
          <Clock size={16} className="shrink-0 text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={bottomSheet.ref}>
        <View className="px-5">
          <Text className="text-[19px] font-bold tracking-tight">{label}</Text>
          <Text className="mt-[3px] text-[13px] text-muted-foreground">
            15-minute steps.
          </Text>
        </View>
        <BottomSheetFlatList
          data={TIME_OPTIONS}
          keyExtractor={(item) => String(item as number)}
          className="mt-3 px-5"
          initialScrollIndex={Math.max(0, Math.floor(value / STEP) - 3)}
          getItemLayout={(_, index) => ({
            length: 56,
            offset: 56 * index,
            index,
          })}
          renderItem={({ item: rawItem }: ListRenderItemInfo<unknown>) => {
            const item = rawItem as number;
            const selected = item === value;
            return (
              <Pressable
                onPress={() => {
                  onChange(item);
                  bottomSheet.close();
                }}
                className={cn(
                  "mb-2 flex-row items-center justify-between rounded-xl border px-4 py-3.5",
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card",
                )}
              >
                <Text
                  className={cn(
                    "text-[15px]",
                    selected
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground",
                  )}
                >
                  {minutesToLabel(item)}
                </Text>
                {selected && (
                  <View className="h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <Check size={12} className="text-primary-foreground" />
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      </BottomSheetContent>
    </BottomSheet>
  );
}
