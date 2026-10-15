import type { SessionAnchor } from "@zenflow/shared";

/** Snap points of the session detail sheet: peek, then full. */
export const SESSION_DETAIL_SNAP_POINTS = ["46%", "92%"];
export const PEEK_SNAP_INDEX = 0;
export const FULL_SNAP_INDEX = 1;

/** Only the full snap shows the note; the note WebView first loads there. */
export function isFullSnap(index: number): boolean {
  return index === FULL_SNAP_INDEX;
}

/** Composer route for a session. A recurring occurrence id has `::` and `:`, so it is encoded. */
export function sessionEditHref(sessionId: string): string {
  return `/task/${encodeURIComponent(sessionId)}/edit`;
}

/** Copy keys (see `lib/i18n-vi.ts`) for an anchor state, passed through `t()` by the caller. */
export const ANCHOR_LABEL_KEYS: Record<SessionAnchor, string> = {
  AUTO: "Moves freely",
  CHOSEN: "Time set by you",
  PINNED: "Pinned in place",
};

/** One-line explanation of an anchor state, under its label. */
export const ANCHOR_HINT_KEYS: Record<SessionAnchor, string> = {
  AUTO: "The scheduler can move it to make room.",
  CHOSEN: "You set this time. The scheduler asks before it moves it.",
  PINNED: "The scheduler never moves it.",
};
