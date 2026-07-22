import { Plus } from "@/components/Icons";
import { snapToNearestLaterQuarterHour, zonedNow } from "@zenflow/core";
import { type Href, useRouter } from "expo-router";
import { Pressable } from "react-native";

/**
 * Builds the "New task" screen's `Href`, pre-filled with "now" snapped to
 * the next 15-minute mark — shared by the FAB below and the Day screen's
 * long-press-empty-area gesture (`app/(app)/index.tsx`), which needs the
 * exact same computation without going through the FAB itself.
 */
export function createTaskAtNowHref(tz: string): Href {
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

/**
 * Floating "+" create-task button, factored out of `app/(app)/index.tsx` so
 * `week.tsx`/`month.tsx` (still Phase 3/4 stub screens) can offer task
 * creation too instead of only the Day tab.
 *
 * Used to pair with its own `CreateTaskSheet`; the task form now lives on
 * its own screen (`app/task/new.tsx` — see mobile/README.md), so this is
 * just a navigation trigger. No more `onCreated` callback either: the
 * new-task screen shows its own placement toast before calling
 * `router.back()`, and callers refetch their own task list via
 * `useFocusEffect` when they regain focus instead of a threaded callback
 * (see `app/(app)/index.tsx`).
 */
export function CreateTaskFab({ tz }: { tz: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(createTaskAtNowHref(tz))}
      accessibilityLabel="New task"
      className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg"
    >
      <Plus size={22} className="text-primary-foreground" />
    </Pressable>
  );
}
