import { fromZonedTime } from "date-fns-tz";
import { Options, RRule } from "rrule";

export function filterRecurringTasks(
  tasks: { rrule: string | null }[],
  startDate: Date,
  endDate: Date,
  complement: boolean = false,
  timezone: string = "UTC",
) {
  return tasks.filter((task) => {
    if (!task.rrule) return true;

    // Support storing the rrule as an iCalendar-like block that may include DTSTART and RRULE lines
    const raw = task.rrule;
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Find RRULE line if present, otherwise treat entire string as the rule body
    const rruleLine = lines.find((l) => /^RRULE[:;]/i.test(l));
    const rruleBody = rruleLine ? rruleLine.replace(/^RRULE:/i, "") : raw;

    // Parse options from RRULE body (support parseString fallback)
    let options: Partial<Options>;
    if (typeof RRule.parseString === "function") {
      options = RRule.parseString(rruleBody);
    } else {
      // Some RRule builds expose parseString differently; fall back to fromString.options
      try {
        options = RRule.fromString(rruleBody).options;
      } catch {
        options = {};
      }
    }

    // If there's a DTSTART line, parse it and set options.dtstart
    const dtstartLine = lines.find((l) => /^DTSTART\b/i.test(l));
    if (dtstartLine) {
      // Format: DTSTART[:TZID=...]:YYYYMMDD[T]HHMMSS[Z]
      const afterColon = dtstartLine.split(":").slice(1).join(":").trim();
      const tzidMatch = dtstartLine.match(/TZID=([^:;]+)/i);

      try {
        if (/Z$/i.test(afterColon)) {
          // UTC timestamp: convert compact to ISO with trailing Z, e.g. 20251202T170000Z -> 2025-12-02T17:00:00Z
          const isoUtc = afterColon.replace(
            /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z$/i,
            "$1-$2-$3T$4:$5:$6Z",
          );
          options.dtstart = new Date(isoUtc);
        } else {
          // No trailing Z -> interpret in TZID if present, otherwise use provided user's timezone
          const tzForDtstart = tzidMatch ? tzidMatch[1] : timezone;

          // Convert compact YYYYMMDDTHHMMSS into ISO-like string for fromZonedTime
          // e.g. 20251203T000000 -> 2025-12-03T00:00:00
          const isoLike = afterColon.replace(
            /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})$/,
            "$1-$2-$3T$4:$5:$6",
          );

          // fromZonedTime will interpret the local time in the tz and return the corresponding UTC instant
          options.dtstart = fromZonedTime(isoLike, tzForDtstart);
        }
      } catch {
        // If parsing failed, ensure we don't pass an invalid dtstart below
        options.dtstart = undefined;
      }
    }

    // Validate dtstart is a real Date object
    if (options.dtstart) {
      const ds = options.dtstart;
      if (!(ds instanceof Date) || isNaN(ds.getTime())) {
        delete options.dtstart;
      }
    }

    // Build the rule with the parsed options so dtstart is honored.
    // Guard against malformed rules so one bad rule doesn't crash listing.
    let rule: RRule;
    try {
      rule = new RRule(options);
    } catch (err) {
      // If rule cannot be constructed, treat it as having no matching occurrences.
      // (For complement=true, that means it will be included in unscheduled; for complement=false it will be excluded.)
      return complement ? true : false;
    }

    const matches = rule.between(startDate, endDate, true);
    return complement ? matches.length === 0 : matches.length > 0;
  });
}
