/**
 * Runtime kill-switch flags (ADR-0008). Two defaults per flag:
 * - `normal`: the value while the key is absent (never toggled) or the URL is
 *   unset — the product's normal operating state.
 * - `failSafe`: the value only while Redis is *unreachable*, chosen so an
 *   outage degrades toward the safer behaviour.
 */
export const KILLSWITCH_FLAGS = {
  /** DLU/LMS sync. Off on outage to protect the upstream portals. */
  ingestion: { normal: true, failSafe: false },
  /** Push + reminder delivery. */
  notifications: { normal: true, failSafe: true },
  /** Bandit placement. Off = frozen TS heuristic placement. */
  bandit: { normal: true, failSafe: false },
  /** Creation of new accounts (login is unaffected). */
  signups: { normal: true, failSafe: true },
  /** Rejects non-GET API requests with 503. */
  maintenance: { normal: false, failSafe: false },
} as const;

export type KillSwitchFlag = keyof typeof KILLSWITCH_FLAGS;

export const KILLSWITCH_FLAG_NAMES = Object.keys(
  KILLSWITCH_FLAGS,
) as KillSwitchFlag[];

export const KILLSWITCH_KEY_PREFIX = "killswitch:";
export const KILLSWITCH_AUDIT_STREAM = "killswitch:audit";
export const KILLSWITCH_AUDIT_MAXLEN = 10000;

export interface KillSwitchAuditEntry {
  id: string;
  flag: KillSwitchFlag;
  value: boolean;
  actor: string;
  reason: string;
  at: string;
}
