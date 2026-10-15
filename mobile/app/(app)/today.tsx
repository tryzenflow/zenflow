import { Redirect, type Href } from "expo-router";

/**
 * The Today tab is a shortcut, not a screen: it opens the calendar on today's
 * Day view. The `date` param is the current instant; the calendar re-homes it
 * to the user's timezone.
 */
export default function TodayRedirect() {
  return (
    <Redirect
      href={
        {
          pathname: "/",
          params: { view: "day", date: new Date().toISOString() },
        } as Href
      }
    />
  );
}
