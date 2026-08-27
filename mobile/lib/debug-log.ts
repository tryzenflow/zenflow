/**
 * Tiny dev-only event logger for interaction/gesture debugging (week pager,
 * cross-day drag, reschedule sync). Keeps a ring buffer in memory and mirrors
 * every entry to the console with a `[zf]` prefix (visible in the Metro
 * terminal and the browser devtools). On web it also exposes
 * `window.__zenflowLog()` / `window.__zenflowLogClear()` so a session can be
 * copied straight out of the browser console.
 *
 * No files are written — the ring buffer + the dev overlay
 * (`components/dev/debug-overlay.tsx`) replace the "write a debug.log"
 * workflow: reproduce the bug, hit Copy in the overlay, paste the dump here.
 */

const MAX_ENTRIES = 500;

interface DebugEntry {
  t: string;
  event: string;
  detail?: unknown;
}

const buffer: DebugEntry[] = [];

let enabled = true;

/** Global kill switch so the logger can be left in the tree for a moment. */
export function setDebugLogEnabled(value: boolean) {
  enabled = value;
}

export function isDebugLogEnabled() {
  return enabled;
}

function fmtDetail(detail: unknown): string {
  if (detail === undefined) return "";
  if (typeof detail === "string") return detail;
  if (typeof detail === "number" || typeof detail === "boolean") {
    return String(detail);
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

/** Append an event. Safe to call from a worklet via `runOnJS(debugLog)`. */
export function debugLog(event: string, detail?: unknown) {
  if (!enabled) return;
  const t = new Date().toISOString().slice(11, 23);
  buffer.push({ t, event, detail });
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
  const rendered = fmtDetail(detail);
  // eslint-disable-next-line no-console
  console.log(`[zf] ${t} ${event}${rendered ? " " + rendered : ""}`);
}

export function clearDebugLog() {
  buffer.length = 0;
}

export function debugLogEntries(): DebugEntry[] {
  return buffer;
}

/** Newline-joined dump of the buffer (oldest → newest) for Copy. */
export function debugLogDump(): string {
  return buffer
    .map((e) => `${e.t} ${e.event}${fmtDetail(e.detail) ? " " + fmtDetail(e.detail) : ""}`)
    .join("\n");
}

declare global {
  interface Window {
    __zenflowLog?: () => string;
    __zenflowLogClear?: () => void;
  }
}

if (typeof window !== "undefined") {
  window.__zenflowLog = () => debugLogDump();
  window.__zenflowLogClear = () => clearDebugLog();
}