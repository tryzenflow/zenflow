/**
 * A session `location` that is a meeting link ("https://meet…", "www.…",
 * "zoom.us/j/…") rather than a room — calendars show it as "Online".
 */
export function isOnlineLocation(location: string): boolean {
  const s = location.trim();
  return (
    /^(https?:\/\/|www\.)\S+$/i.test(s) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(s)
  );
}

/** The label a calendar shows for `location`: "Online" for a link, else as-is. */
export function displayLocation(location: string): string {
  return isOnlineLocation(location) ? "Online" : location;
}
