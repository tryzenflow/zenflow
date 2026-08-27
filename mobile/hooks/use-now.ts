import { useEffect, useState } from "react";

/** How often the live clock ticks. Coarser than a minute would visibly lag
 * the now-line; finer buys nothing since the grid renders in minutes. */
const TICK_MS = 30_000;

/**
 * A `Date` that re-renders its consumers every {@link TICK_MS}, so anything
 * deriving from "now" (the day view's header clock and now-line) stays live
 * without the screen having to re-render for another reason.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return now;
}
