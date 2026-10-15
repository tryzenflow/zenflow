import { Skeleton } from "@/components/ui/skeleton";
import { View } from "react-native";

const WEEK_COLUMNS = [0, 1, 2, 3, 4, 5, 6];
const MONTH_ROWS = [0, 1, 2, 3, 4];

/**
 * Cheap stand-in shown for the frame or two while a Week or Month view mounts,
 * so switching views answers the tap at once.
 */
export function CalendarViewSkeleton({ variant }: { variant: "week" | "month" }) {
  if (variant === "week") {
    return (
      <View testID="view-skeleton.week" className="flex-1 px-4 pt-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-28" />
        <View className="mt-4 flex-row gap-1.5">
          {WEEK_COLUMNS.map((i) => (
            <View key={i} className="flex-1 gap-1">
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-1 w-full" />
              {i % 2 === 0 ? (
                <Skeleton className="mt-6 h-20 w-full rounded-xl" />
              ) : (
                <Skeleton className="mt-12 h-14 w-full rounded-xl" />
              )}
            </View>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View testID="view-skeleton.month" className="flex-1 px-4 pt-3">
      <Skeleton className="h-6 w-44" />
      <View className="mt-4 gap-3">
        {MONTH_ROWS.map((row) => (
          <View key={row} className="flex-row gap-1.5">
            {WEEK_COLUMNS.map((i) => (
              <View key={i} className="flex-1 items-center gap-1.5">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-1 w-full" />
              </View>
            ))}
          </View>
        ))}
      </View>
      <View className="mt-6 gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </View>
    </View>
  );
}
