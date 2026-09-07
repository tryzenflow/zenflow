/**
 * The constrained RFC 5545 subset the session forms speak: None / Daily /
 * Weekly, an optional weekday set (Weekly only), and an optional end date.
 * `fromRrule` / `toRrule` convert between the editor state and the bare `rrule`
 * string stored on a session's series. Shared by the web and mobile recurrence
 * fields so both emit byte-identical rules.
 */
export type RecurrenceFreq = "NONE" | "DAILY" | "WEEKLY";

export interface RecurrenceState {
  freq: RecurrenceFreq;
  /** RFC 5545 weekday codes (`MO`…`SU`); only meaningful for `WEEKLY`. */
  byday: string[];
  /** `YYYY-MM-DD`, or undefined for "repeats indefinitely". */
  until?: string;
}

/** RRULE subset string → editor state. Anything unrecognised collapses to "NONE". */
export function fromRrule(rrule: string | undefined | null): RecurrenceState {
  if (!rrule) return { freq: "NONE", byday: [] };
  const parts = Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((p) => p.split("=") as [string, string]),
  );
  const freq = parts.FREQ as RecurrenceFreq | undefined;
  const byday = parts.BYDAY ? parts.BYDAY.split(",") : [];
  let until: string | undefined;
  if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (m) until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return {
    freq: freq === "DAILY" || freq === "WEEKLY" ? freq : "NONE",
    byday,
    until,
  };
}

/** Editor state → RRULE subset string (or `undefined` for a one-off). */
export function toRrule(state: RecurrenceState): string | undefined {
  if (state.freq === "NONE") return undefined;
  const parts = [`FREQ=${state.freq}`];
  if (state.freq === "WEEKLY" && state.byday.length > 0) {
    parts.push(`BYDAY=${state.byday.join(",")}`);
  }
  if (state.until) {
    parts.push(`UNTIL=${state.until.replace(/-/g, "")}T000000Z`);
  }
  return parts.join(";");
}
