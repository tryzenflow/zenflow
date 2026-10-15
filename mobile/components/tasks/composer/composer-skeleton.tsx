import { Skeleton } from "@/components/ui/skeleton";
import { View } from "react-native";

const CARDS = [0, 1, 2];

/** The composer body while the session loads: title line, then field cards of chips. */
export function ComposerSkeleton() {
  return (
    <View testID="task.composer.skeleton" style={{ gap: 16 }}>
      <Skeleton className="h-14 rounded-2xl" />
      {CARDS.map((i) => (
        <View
          key={i}
          className="gap-3 rounded-2xl border border-glass-edge/30 p-4 dark:border-glass-edge/20"
        >
          <Skeleton className="h-3.5 w-24" />
          <View className="flex-row gap-2">
            <Skeleton className="h-10 w-20 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
            <Skeleton className="h-10 w-20 rounded-full" />
          </View>
        </View>
      ))}
    </View>
  );
}
