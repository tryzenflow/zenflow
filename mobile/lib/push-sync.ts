/**
 * Pure decision logic for push state (no React Native imports, unit-tested).
 */

/** Notifications are ON iff OS permission is granted AND the server has this device. */
export function deriveNotificationsActive(
  permissionGranted: boolean | null,
  registered: boolean | null,
): boolean {
  return permissionGranted === true && registered === true;
}

export type LaunchSyncAction =
  /** Leave everything alone (never decided, or turned off). */
  | "none"
  /** Server already has this token; just remember it as this install's token. */
  | "mark"
  /** Token rotated: register the new token and drop the old one. */
  | "rotate";

/**
 * Launch / foreground rule. Must never re-enable a device the user switched
 * off, and "no server row" is ambiguous (never decided vs. turned off), so:
 *
 *  - no OS permission or no token            -> none
 *  - server has this token                   -> mark (refresh the local marker)
 *  - server lacks it, and this install last
 *    registered a DIFFERENT token (marker)   -> rotate (the OS rotated the token)
 *  - otherwise (no marker, or marker equals
 *    the current token => row was removed)   -> none
 *
 * The marker (`markerToken`) is the last token this install registered; it is
 * cleared when the user turns notifications off or signs out, so an opt-out is
 * never mistaken for a rotation.
 */
export function decideLaunchSync(input: {
  permissionGranted: boolean;
  token: string | null;
  registered: boolean;
  markerToken: string | null;
}): LaunchSyncAction {
  const { permissionGranted, token, registered, markerToken } = input;
  if (!permissionGranted || !token) return "none";
  if (registered) return markerToken === token ? "none" : "mark";
  if (markerToken && markerToken !== token) return "rotate";
  return "none";
}
