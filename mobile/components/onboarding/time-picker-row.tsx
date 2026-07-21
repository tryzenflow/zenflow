import { useMemo } from "react";
import { type ListRenderItemInfo, Pressable, View } from "react-native";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFlatList,
  BottomSheetOpenTrigger,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Check, ChevronRight } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { minutesToLabel, TIME_OPTIONS } from "@/utils/preferences";

/**
 * A tappable "label — value" row that opens a bottom sheet listing every
 * 30-minute mark in the day. Port of mockups/onboarding.html's work-hours
 * picker (the "Sheet" frame), replacing the old inline hour/minute Selects.
 *
 * Uses the shared BottomSheetFlatList (not a bare ScrollView) so the list
 * scrolls correctly nested inside @gorhom/bottom-sheet's pan-gesture handling
 * on native.
 */
export function TimePickerRow({
  label,
  sheetTitle,
  value,
  onChange,
  className,
  stepMinutes = 30,
  subtitle,
}: {
  label: string;
  /** Bottom-sheet heading, if it should differ from the row label. */
  sheetTitle?: string;
  value: number;
  onChange: (v: number) => void;
  className?: string;
  stepMinutes?: number;
  subtitle?: string;
}) {
  const bottomSheet = useBottomSheet();
  const options = useMemo(
    () =>
      stepMinutes === 30
        ? TIME_OPTIONS
        : Array.from({ length: 1440 / stepMinutes }, (_, i) => i * stepMinutes),
    [stepMinutes],
  );

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild>
        <Pressable
          className={cn(
            "flex-row items-center justify-between gap-3 bg-card px-4 py-[15px]",
            className,
          )}
        >
          <Text className="flex-1 text-[15px] font-semibold">{label}</Text>
          <Text className="text-sm font-medium text-muted-foreground">
            {minutesToLabel(value)}
          </Text>
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={bottomSheet.ref}>
        <View className="px-5">
          <Text className="text-[19px] font-bold tracking-tight">
            {sheetTitle ?? label}
          </Text>
          <Text className="mt-[3px] text-[13px] text-muted-foreground">
            {subtitle ?? `${stepMinutes}-minute steps for a quick pick.`}
          </Text>
        </View>
        <BottomSheetFlatList
          data={options}
          keyExtractor={(item) => String(item as number)}
          className="mt-4 px-5"
          renderItem={({ item: rawItem }: ListRenderItemInfo<unknown>) => {
            const item = rawItem as number;
            const selected = item === value;
            return (
              <Pressable
                onPress={() => onChange(item)}
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
        <View className="px-5 pt-3.5">
          <Button className="w-full" onPress={bottomSheet.close}>
            <Text className="font-semibold text-primary-foreground">
              Done
            </Text>
          </Button>
        </View>
      </BottomSheetContent>
    </BottomSheet>
  );
}
