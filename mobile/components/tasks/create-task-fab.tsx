import { Plus } from "@/components/Icons";
import { FAB_GLOW_INNER, FAB_GLOW_OUTER } from "@/lib/fab-glow";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { snapToNearestLaterQuarterHour, zonedNow } from "@zenflow/core";
import { type Href, useRouter } from "expo-router";
import { Pressable, View } from "react-native";

/**
 * Builds the "New task" screen's `Href`, pre-filled with "now" snapped to
 * the next 15-minute mark — shared by the FAB below and the Day screen's
 * long-press-empty-area gesture (`app/(app)/index.tsx`), which needs the
 * exact same computation without going through the FAB itself.
 */
export function createSessionAtNowHref(tz: string): Href {
  const now = zonedNow(tz);
  const snappedMinutes = snapToNearestLaterQuarterHour(
    now.getHours() * 60 + now.getMinutes(),
  );
  const snapped = new Date(now);
  snapped.setHours(0, Math.min(snappedMinutes, 23 * 60 + 45), 0, 0);
  return {
    pathname: "/task/new",
    params: { start: snapped.toISOString() },
  } as Href;
}

export function CreateSessionFab({ tz }: { tz: string }) {
  const router = useRouter();
  const tabBarOverlay = useTabBarOverlayHeight();
  return (
    // Wrapper + button carry the two halves of the shared amber glow (see
    // `lib/fab-glow.ts`) — the same treatment the tab bar's Optimize button
    // gets, so the two floating actions read as one family.
    <View
      style={[
        FAB_GLOW_OUTER,
        // Anchored to the top of the tab bar rather than the screen's bottom
        // edge: the bar now overlays the screen, so a plain `bottom-6` would
        // tuck this behind it. Sitting tight above the bar also keeps it off
        // the month grid's last row.
        { borderRadius: 20, bottom: tabBarOverlay + 8 },
      ]}
      className="absolute right-[18px] z-[35]"
    >
      <Pressable
        onPress={() => router.push(createSessionAtNowHref(tz))}
        accessibilityRole="button"
        accessibilityLabel="New task"
        style={FAB_GLOW_INNER}
        className="size-[52px] items-center justify-center rounded-[20px] bg-primary"
      >
        <Plus size={26} color="black" className="text-primary-foreground" />
      </Pressable>
    </View>
  );
}
