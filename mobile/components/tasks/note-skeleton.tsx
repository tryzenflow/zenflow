import { Skeleton } from "@/components/ui/skeleton";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { View } from "react-native";

// Line widths of the placeholder paragraph; the last is short like real text.
const LINE_WIDTHS = ["w-full", "w-[92%]", "w-full", "w-[78%]", "w-[55%]"];

/**
 * Placeholder for a note while its WebView boots. Lines match the note
 * typography (16px / 1.55) so the content replaces it without a layout jump.
 * Pulses like `Skeleton`; holds still under reduce-motion.
 */
export function NoteSkeleton({
  lines = LINE_WIDTHS.length,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const Line = reduceMotion ? View : Skeleton;
  return (
    <View
      testID="note-skeleton"
      accessibilityLabel="Loading"
      className={cn("gap-[11px]", className)}
    >
      {LINE_WIDTHS.slice(0, lines).map((w, i) => (
        <Line key={i} className={cn("h-[14px] rounded-md bg-border", w)} />
      ))}
    </View>
  );
}
