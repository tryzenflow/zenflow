import { Pressable, View } from "react-native";
import type { DurationAdjustmentMode } from "@zenflow/shared";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetOpenTrigger,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { ChevronRight, Sliders } from "@/components/Icons";
import { DURATION_MODES } from "@/components/settings/duration-mode-field";
import { cn } from "@/lib/utils";

/**
 * Scheduling row: tapping opens a bottom sheet with the three
 * duration-adjustment modes, ported straight from duration-mode-field.tsx's
 * data (mockups/settings.html's "Duration adjustments" sheet).
 */
export function DurationModePickerRow({
  value,
  onChange,
  className,
}: {
  value: DurationAdjustmentMode;
  onChange: (mode: DurationAdjustmentMode) => void;
  className?: string;
}) {
  const bottomSheet = useBottomSheet();
  const current = DURATION_MODES.find((m) => m.id === value);

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild>
        <Pressable
          className={cn(
            "flex-row items-center gap-[13px] bg-card px-4 py-3.5",
            className,
          )}
        >
          <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <Sliders size={18} className="text-foreground" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold">Duration adjustments</Text>
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              How Zenflow applies learned task lengths
            </Text>
          </View>
          <Text className="text-sm font-medium text-muted-foreground">
            {current?.name}
          </Text>
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={bottomSheet.ref}>
        <BottomSheetView className="px-0" hadHeader={false}>
          <View className="px-5">
            <Text className="text-[19px] font-bold tracking-tight">
              Duration adjustments
            </Text>
            <Text className="mt-[3px] text-[13px] text-muted-foreground">
              How Zenflow applies learned task lengths.
            </Text>
          </View>
          <View className="mt-4 gap-2.5 px-5">
            {DURATION_MODES.map((m) => {
              const selected = value === m.id;
              const Icon = m.icon;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => onChange(m.id)}
                  className={cn(
                    "flex-row items-start gap-3 rounded-xl border p-3.5",
                    selected ? "border-primary bg-primary/10" : "border-border bg-card",
                  )}
                >
                  <View
                    className={cn(
                      "mt-0.5 h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border",
                      selected
                        ? "border-primary/40 bg-primary/15"
                        : "border-border bg-muted",
                    )}
                  >
                    <Icon
                      size={16}
                      className={selected ? "text-primary" : "text-muted-foreground"}
                    />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold">{m.name}</Text>
                    <Text className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {m.blurb}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View className="px-5 pt-3.5">
            <Button className="w-full" onPress={bottomSheet.close}>
              <Text className="font-semibold text-primary-foreground">Done</Text>
            </Button>
          </View>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
}
