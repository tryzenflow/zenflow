/**
 * Pure decision logic for push state (no React Native imports, unit-tested).
 */

/**
 * OS notification permission, normalized:
 *  - granted      -> allowed
 *  - undetermined -> never asked (or the OS will ask again); can prompt
 *  - denied       -> denied but the OS would still show a prompt
 *  - blocked      -> denied and the OS will not prompt again (Settings only)
 */
export type PushPermission = "granted" | "undetermined" | "denied" | "blocked";

/** Notifications are ON iff the user wants them (server) AND the OS allows. */
export function deriveNotificationsActive(
  allowNotifications: boolean | null | undefined,
  permission: PushPermission | null,
): boolean {
  return allowNotifications === true && permission === "granted";
}

export type PushAction =
  /** Nothing to do. */
  | "none"
  /** Permission granted + wanted: (re)register the token, no prompt. */
  | "register"
  /** Show the system prompt; then register on grant, PATCH false on deny. */
  | "prompt"
  /** Cannot get permission: PATCH allowNotifications:false. */
  | "disable";

/**
 * Login / launch / foreground rule.
 *
 *  - not onboarded (onboardedAt null)       -> none (the onboarding step asks)
 *  - allowNotifications false / unknown     -> none (never register)
 *  - permission unread                      -> none
 *  - granted                                -> register (silent, idempotent)
 *  - blocked (cannot prompt)                -> disable
 *  - undetermined / denied-but-askable      -> prompt, at most once per
 *    login (`alreadyPrompted`); afterwards a still-ungranted permission
 *    is treated as denied -> disable
 */
export function decidePushAction(input: {
  allowNotifications: boolean | null | undefined;
  permission: PushPermission | null;
  onboarded: boolean;
  alreadyPrompted: boolean;
}): PushAction {
  const { allowNotifications, permission, onboarded, alreadyPrompted } = input;
  if (!onboarded || allowNotifications !== true || permission === null) {
    return "none";
  }
  if (permission === "granted") return "register";
  if (permission === "blocked") return "disable";
  return alreadyPrompted ? "disable" : "prompt";
}
