/**
 * Rule-based quick-add parser for the task composer. One line of text in,
 * chips out: a deadline, a duration, a kind, a session type, a start time and
 * a course. English and Vietnamese, with or without diacritics. No network,
 * no model.
 *
 * Matching runs on a folded copy of the text that keeps one character per
 * input character, so a match index is valid in the original too. Each rule
 * masks what it matched with spaces; what is left, trimmed, is the title.
 * A course is only recognised when it is in `ctx.courses`, and it stays in the
 * title, since it reads naturally there.
 */

export type ParsedKind = "TASK" | "EVENT";
export type ParsedSessionType = "TASK" | "ASSIGNMENT" | "EXAM" | "LECTURE";

export interface ParsedDeadline {
  /** `YYYY-MM-DD` in the user's calendar. */
  date: string;
  /** Which rule matched, for the chip label. */
  source: "today" | "tomorrow" | "weekday";
}

export interface ParseResult {
  title: string;
  course?: string;
  deadline?: ParsedDeadline;
  /** Minutes, always a positive multiple of 15. */
  durationMinutes?: number;
  kind: ParsedKind;
  sessionType: ParsedSessionType;
  /** `HH:mm`, present only when the text names a time of day. */
  startTime?: string;
}

export interface ParseContext {
  /** Today in the user's calendar, as `YYYY-MM-DD`. */
  today: string;
  /** The user's courses (their tags). Matched case and accent blind. */
  courses?: string[];
}

function foldUnit(c: string): string {
  if (c === "đ" || c === "Đ") return "d";
  const base = c.normalize("NFD").charAt(0).toLowerCase();
  // A stray combining mark has no base letter; keep the length by using a space.
  return base === "" || /[̀-ͯ]/.test(base) ? " " : base;
}

/**
 * Lowercase and strip diacritics, one output character per input character.
 * `ô` becomes `o`, `đ` becomes `d`.
 */
export function fold(text: string): string {
  return text
    .normalize("NFC")
    .split("")
    .map(foldUnit)
    .join("");
}

const WEEKDAYS_EN: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/** Vietnamese weekday names, folded. "thứ 2" is Monday, "chủ nhật" is Sunday. */
const WEEKDAYS_VI: [RegExp, number][] = [
  [/\bchu nhat\b|\bcn\b/, 0],
  [/\bthu hai\b|\bthu 2\b/, 1],
  [/\bthu ba\b|\bthu 3\b/, 2],
  [/\bthu tu\b|\bthu 4\b/, 3],
  [/\bthu nam\b|\bthu 5\b/, 4],
  [/\bthu sau\b|\bthu 6\b/, 5],
  [/\bthu bay\b|\bthu 7\b/, 6],
];

const UNIT_HOUR = "(?:h|gio|tieng|hour|hours|hr|hrs)";
const UNIT_MIN = "(?:m|p|phut|min|mins|minute|minutes)";

interface Text {
  raw: string;
  folded: string;
}

/**
 * Match `pattern` on the folded text. On a hit, mask the span in both copies
 * with spaces (length preserved) and return the match.
 */
function take(text: Text, pattern: RegExp): RegExpExecArray | null {
  const m = pattern.exec(text.folded);
  if (!m) return null;
  const start = m.index;
  const end = start + m[0].length;
  const blank = " ".repeat(end - start);
  text.raw = text.raw.slice(0, start) + blank + text.raw.slice(end);
  text.folded = text.folded.slice(0, start) + blank + text.folded.slice(end);
  return m;
}

/** Durations: "2h", "1.5h", "1h30", "90p", "90 phút", "2 giờ", "45 min", "2 hours". */
function takeDuration(text: Text): number | undefined {
  let minutes: number | undefined;
  const hm = take(
    text,
    new RegExp(`\\b(\\d{1,2})\\s*${UNIT_HOUR}\\s*(\\d{1,2})\\s*(?:${UNIT_MIN})?\\b`),
  );
  if (hm) {
    minutes = Number(hm[1]) * 60 + Number(hm[2]);
  } else {
    const h = take(text, new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*${UNIT_HOUR}\\b`));
    if (h) {
      minutes = Math.round(Number(h[1].replace(",", ".")) * 60);
    } else {
      const mm = take(text, new RegExp(`\\b(\\d{1,3})\\s*${UNIT_MIN}\\b`));
      if (mm) minutes = Number(mm[1]);
    }
  }
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  // The 15-minute grid, never below one slot.
  return Math.max(15, Math.round(minutes / 15) * 15);
}

/** Session type from keywords. Fixed types for exams and lectures. */
function inferSessionType(folded: string): ParsedSessionType {
  if (/\b(exam|midterm|final|test|quiz|thi|kiem tra|giua ky|cuoi ky)\b/.test(folded)) {
    return "EXAM";
  }
  if (/\b(lecture|class|lop|giang|seminar)\b/.test(folded)) return "LECTURE";
  if (
    /\b(essay|assignment|homework|report|project|bai tap|tieu luan|bao cao|do an)\b/.test(
      folded,
    )
  ) {
    return "ASSIGNMENT";
  }
  return "TASK";
}

/** Days from `from` (`YYYY-MM-DD`) to the next `weekday`, today included. */
function daysUntil(from: string, weekday: number): number {
  const [y, m, d] = from.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (weekday - dow + 7) % 7;
}

/** `YYYY-MM-DD` plus `days` calendar days. */
export function addDaysIso(from: string, days: number): string {
  const [y, m, d] = from.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function takeDeadline(text: Text, today: string): ParsedDeadline | undefined {
  if (take(text, /\b(hom nay|today)\b/)) {
    return { date: today, source: "today" };
  }
  if (take(text, /\b(ngay mai|tomorrow|mai)\b/)) {
    return { date: addDaysIso(today, 1), source: "tomorrow" };
  }
  let weekday: number | undefined;
  for (const [pattern, day] of WEEKDAYS_VI) {
    if (take(text, pattern)) {
      weekday = day;
      break;
    }
  }
  if (weekday === undefined) {
    const en = take(
      text,
      /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b/,
    );
    if (en) weekday = WEEKDAYS_EN[en[1]];
  }
  if (weekday === undefined) return undefined;
  return {
    date: addDaysIso(today, daysUntil(today, weekday)),
    source: "weekday",
  };
}

/**
 * A start time: "9:30", or a clock after "at" or "lúc" ("at 9am", "lúc 14h",
 * "lúc 9 giờ"). "9h30" without a cue reads as a duration, not a time.
 */
function takeStartTime(text: Text): string | undefined {
  const clock =
    take(text, /\b(\d{1,2}):(\d{2})\b/) ??
    take(text, /\b(?:at|luc)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|h|gio)?\b/);
  if (!clock) return undefined;
  let hour = Number(clock[1]);
  const minute = clock[2] ? Number(clock[2]) : 0;
  const meridiem = clock[3];
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parse one line. `ctx.today` anchors "today", "tomorrow" and weekdays. A
 * bare weekday means the next one on or after today.
 */
export function parseTask(input: string, ctx: ParseContext): ParseResult {
  const raw = input.normalize("NFC").replace(/\s+/g, " ").trim();
  const text: Text = { raw: ` ${raw} `, folded: ` ${fold(raw)} ` };

  const sessionType = inferSessionType(text.folded);

  // Course is recognised but kept in the title: the longest match wins.
  let course: string | undefined;
  for (const candidate of [...(ctx.courses ?? [])].sort(
    (a, b) => fold(b).trim().length - fold(a).trim().length,
  )) {
    const needle = fold(candidate).trim();
    if (!needle) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(text.folded)) {
      course = candidate;
      break;
    }
  }

  const startTime = takeStartTime(text);
  const durationMinutes = takeDuration(text);
  const deadline = takeDeadline(text, ctx.today);
  if (deadline) {
    // Connectors that only introduced the deadline ("due fri", "hạn thứ 6").
    while (take(text, /\b(due|by|han)\b/)) {
      // `take` masks each one; loop until none are left.
    }
  }

  const kind: ParsedKind = startTime ? "EVENT" : "TASK";
  const title = text.raw.replace(/\s+/g, " ").trim();

  return {
    title,
    course,
    deadline,
    durationMinutes,
    kind,
    sessionType:
      kind === "EVENT" && sessionType === "TASK" ? "LECTURE" : sessionType,
    startTime,
  };
}
