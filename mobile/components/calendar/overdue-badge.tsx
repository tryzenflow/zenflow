import { AlertCircle } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { View } from "react-native";

/**
 * "N overdue" pill for the calendar headers — the rose treatment from
 * `mockups/day-view.html`'s "Overdue placement" state. Counts tasks the
 * scheduler placed past their own deadline (`deriveState` → `"overdue"`),
 * which is a standing condition, not a transient toast.
 *
 * Renders nothing at zero, so callers can drop it in unconditionally.
 */
export function OverdueBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <View
      accessibilityLabel={`${count} ${
        count === 1 ? "task" : "tasks"
      } scheduled past its deadline`}
      className="flex-row items-center gap-1 self-start rounded-full border border-rose-400/50 bg-rose-100 px-2 py-0.5 dark:bg-rose-950"
    >
      <AlertCircle size={12} className="text-rose-800 dark:text-rose-400" />
      <Text className="text-[11px] font-semibold text-rose-800 dark:text-rose-400">
        {count} overdue
      </Text>
    </View>
  );
}
