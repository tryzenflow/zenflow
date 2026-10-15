import { Skeleton } from "@/components/ui/skeleton";
import { View } from "react-native";

const SECTIONS = [3, 2, 2];

/** Grouped cards of settings rows: icon tile, label, hint. */
export function SettingsSkeleton() {
  return (
    <View testID="settings.skeleton">
      {SECTIONS.map((rows, s) => (
        <View key={s}>
          <View className="mx-1 mb-2 mt-[22px]">
            <Skeleton className="h-3 w-24" />
          </View>
          <View className="overflow-hidden rounded-2xl border border-border bg-card">
            {Array.from({ length: rows }, (_, i) => (
              <View
                key={i}
                className="flex-row items-center gap-[13px] px-4 py-3.5"
              >
                <Skeleton className="h-[38px] w-[38px] rounded-xl" />
                <View className="flex-1 gap-2">
                  <Skeleton className={i % 2 ? "h-4 w-1/3" : "h-4 w-1/2"} />
                  <Skeleton className="h-3 w-2/3" />
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
