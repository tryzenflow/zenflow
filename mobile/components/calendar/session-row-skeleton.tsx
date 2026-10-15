import { Skeleton } from "@/components/ui/skeleton";
import { View } from "react-native";

/** A session row of the agenda and Month's day list: tone stripe, time, title. */
export function SessionRowSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <View className="mx-4 my-1 border-l-[3px] border-border">
      <View className="gap-1.5 py-2 pl-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className={wide ? "h-4 w-4/5" : "h-4 w-3/5"} />
      </View>
    </View>
  );
}

/** A day header of the agenda. */
export function DayHeaderSkeleton() {
  return (
    <View className="px-4 pb-1.5 pt-4">
      <Skeleton className="h-3 w-28" />
    </View>
  );
}
