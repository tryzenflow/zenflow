import { listSessions } from "@/api/tasks";
import { fetchDaySessions } from "@/lib/session-cache";
import { zonedDate } from "@zenflow/core";
import { format } from "date-fns";

/** Longest we hold the form open for the landing day; past it we navigate and
 * let the calendar's own skeleton cover the rest. */
const WARM_TIMEOUT_MS = 2500;

/**
 * Load the day a create/edit is about to teleport the calendar to, so it opens
 * already populated. That day is usually one the user never visited, so it has
 * no cache entry: without this the calendar lands on a blank/skeleton grid
 * until its own fetch resolves, a visible gap right after saving. Never
 * rejects; a failure just means the calendar fetches it itself.
 */
export async function warmLandingDay(iso: string, tz: string): Promise<void> {
  const date = zonedDate(iso, tz);
  const load = fetchDaySessions(format(date, "yyyy-MM-dd"), () =>
    listSessions("day", date).then((res) => res.sessions),
  ).catch(() => undefined);
  await Promise.race([
    load,
    new Promise((resolve) => setTimeout(resolve, WARM_TIMEOUT_MS)),
  ]);
}
