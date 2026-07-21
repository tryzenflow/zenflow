import { useMemo, useState } from "react";
import { type ListRenderItemInfo, Pressable, TextInput, View } from "react-native";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFlatList,
  BottomSheetOpenTrigger,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { Check, ChevronRight, Globe, Search } from "@/components/Icons";
import { cn } from "@/lib/utils";

/** Common IANA zones to fall back to if the runtime lacks Intl.supportedValuesOf. */
const FALLBACK_TIMEZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Asia/Tokyo",
  "Asia/Ho_Chi_Minh",
  "Asia/Singapore",
  "Australia/Sydney",
];

function allTimezones(): string[] {
  try {
    const values = Intl.supportedValuesOf?.("timeZone");
    return values && values.length > 0 ? values : FALLBACK_TIMEZONES;
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Timezone row: tapping opens a bottom sheet with a device-timezone toggle,
 * a search field, and the full IANA list (mockups/settings.html).
 */
export function TimezonePickerRow({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
}) {
  const bottomSheet = useBottomSheet();
  const [query, setQuery] = useState("");
  const zones = useMemo(() => allTimezones(), []);
  const useDevice = value === deviceTimezone();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => z.toLowerCase().replace(/_/g, " ").includes(q));
  }, [zones, query]);

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
            <Globe size={18} className="text-foreground" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold">Timezone</Text>
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              Detected automatically
            </Text>
          </View>
          <Text className="text-sm font-medium text-muted-foreground">{value}</Text>
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={bottomSheet.ref}>
        <View className="px-5">
          <Text className="text-[19px] font-bold tracking-tight">Timezone</Text>
          <Text className="mt-[3px] text-[13px] text-muted-foreground">
            Zenflow schedules using this timezone's wall clock.
          </Text>
        </View>

        <View className="mt-4 px-5">
          <View className="mb-3.5 flex-row items-center gap-[13px] rounded-2xl border border-border bg-card p-3.5">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold">Use device timezone</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                {useDevice ? `On — ${deviceTimezone()}` : "Off — pick one manually below"}
              </Text>
            </View>
            <Switch
              checked={useDevice}
              onCheckedChange={() => onChange(deviceTimezone())}
            />
          </View>

          <View className="mb-3.5 h-[46px] flex-row items-center gap-2 rounded-[13px] border border-input bg-card px-[13px]">
            <Search size={16} className="shrink-0 text-muted-foreground" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search cities or regions…"
              placeholderTextColor="#9ca3af"
              className="flex-1 text-[15px] text-foreground"
            />
          </View>
        </View>

        <BottomSheetFlatList
          data={filtered}
          keyExtractor={(item) => item as string}
          className="px-5"
          renderItem={({ item: rawItem }: ListRenderItemInfo<unknown>) => {
            const item = rawItem as string;
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
                  {item}
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
            <Text className="font-semibold text-primary-foreground">Done</Text>
          </Button>
        </View>
      </BottomSheetContent>
    </BottomSheet>
  );
}
