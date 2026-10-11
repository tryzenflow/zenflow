/**
 * Whether a 401/403 means the session is really gone. While the server itself
 * is unhealthy (a dependency down, a deploy) it can answer 401/403 for a valid
 * session, so the app keeps the saved session and its data instead of sending
 * the person to login.
 */
export function sessionIsDead(
  status: number | undefined,
  serverReady: boolean,
): boolean {
  return (status === 401 || status === 403) && serverReady;
}
