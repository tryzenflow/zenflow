import type { SessionSource } from "../../../generated/prisma";
import type { IngestedSessionType } from "./types";

/**
 * Per-sync-run notification digest: a run records every change here and, once
 * it finishes, raises at most one notification per item type and one
 * sync-conflict check per (source, type). Pure: no I/O, no clock.
 */

export type DigestKind = "created" | "updated" | "removed";

export interface DigestItem {
  type: IngestedSessionType;
  kind: DigestKind;
  /** The live session for `created`/`updated`; `null` for `removed` (soft-deleted). */
  sessionId: string | null;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Where the item came from; stamped by {@link SyncDigest.add}. */
  source?: SessionSource;
}

/** What {@link digestNotifications} asks the materializer to raise. */
export interface DigestNotification {
  sessionId: string | null;
  title: string;
  content: string;
  eventEndsAt: Date | null;
  eventName: string;
  /** Never synthesize a placeholder session behind a digest row. */
  materializeSession: false;
}

/** A (source, type) whose fixed blocks this run wrote — re-check for clashes. */
export interface ConflictCheck {
  source: SessionSource;
  type: IngestedSessionType;
}

/** Accumulates one run's changes; `drain` hands them over and empties it. */
export class SyncDigest {
  private items: DigestItem[] = [];
  private checks = new Map<string, ConflictCheck>();

  /**
   * @param startedAt before the run's first write; blocks written since count
   *                  as "just synced".
   */
  constructor(readonly startedAt: Date) {}

  /**
   * Record a change. `source` names it in the notification title and marks
   * created/updated blocks for the conflict pass.
   */
  add(item: DigestItem, source?: SessionSource): void {
    this.items.push(source ? { ...item, source } : item);
    if (source && item.kind !== "removed") {
      this.checks.set(`${source}:${item.type}`, { source, type: item.type });
    }
  }

  get size(): number {
    return this.items.length;
  }

  /** Every (source, type) that got a created/updated block this run. */
  conflictChecks(): ConflictCheck[] {
    return [...this.checks.values()];
  }

  drain(): DigestItem[] {
    const out = this.items;
    this.items = [];
    this.checks = new Map();
    return out;
  }
}

/** Inbox order: the rarest, most time-critical first. */
const TYPE_ORDER: readonly IngestedSessionType[] = [
  "EXAM",
  "ASSIGNMENT",
  "LECTURE",
];

/** Singular, plural, and the singular's indefinite article. */
const NOUN: Record<IngestedSessionType, [string, string, string]> = {
  EXAM: ["exam", "exams", "an"],
  ASSIGNMENT: ["assignment", "assignments", "an"],
  LECTURE: ["lecture", "lectures", "a"],
};

/**
 * "3 new exams" / "2 exam changes" / "2 exams removed". `alone` (the title's
 * only phrase, count 1) reads "a new exam" instead — digits stay in a list so
 * "2 new lectures, 1 lecture removed" doesn't mix in "a lecture".
 */
function phrase(
  type: IngestedSessionType,
  kind: DigestKind,
  n: number,
  alone: boolean,
): string {
  const [one, many, article] = NOUN[type];
  const count =
    alone && n === 1 ? (kind === "created" ? "a" : article) : `${n}`;
  if (kind === "created") return `${count} new ${n === 1 ? one : many}`;
  if (kind === "updated") {
    return `${count} ${one} ${n === 1 ? "change" : "changes"}`;
  }
  return `${count} ${n === 1 ? one : many} removed`;
}

/** Where each type normally comes from; only an off-default source is named. */
const DEFAULT_SOURCE: Record<IngestedSessionType, SessionSource> = {
  EXAM: "PORTAL",
  ASSIGNMENT: "LMS",
  LECTURE: "PORTAL",
};

/**
 * " on LMS" when every item came from LMS but the type usually doesn't (the
 * LMS also lists exams), so portal and LMS rows never share a title.
 */
function onSource(
  type: IngestedSessionType,
  items: readonly DigestItem[],
): string {
  const sources = new Set(items.map((i) => i.source));
  if (sources.size !== 1) return "";
  const [source] = sources;
  return source === "LMS" && DEFAULT_SOURCE[type] !== "LMS" ? " on LMS" : "";
}

/**
 * The session a row opens on the calendar: the soonest upcoming live one,
 * else the latest past one. `null` when every item was removed.
 */
function representative(
  items: readonly DigestItem[],
  now: Date,
): string | null {
  const live = items.filter(
    (i): i is DigestItem & { sessionId: string } => i.sessionId !== null,
  );
  if (live.length === 0) return null;
  const t = (i: DigestItem) => i.startsAt?.getTime() ?? Number.NaN;
  const upcoming = live
    .filter((i) => t(i) >= now.getTime())
    .sort((a, b) => t(a) - t(b));
  if (upcoming.length > 0) return upcoming[0].sessionId;
  const past = live
    .filter((i) => !Number.isNaN(t(i)))
    .sort((a, b) => t(b) - t(a));
  return (past[0] ?? live[0]).sessionId;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The next step, one short sentence — never a source label or sync boilerplate. */
function nextStep(
  type: IngestedSessionType,
  kind: DigestKind,
  one: boolean,
  live: boolean,
): string {
  if (!live)
    return one
      ? "It's gone from your calendar."
      : "They're gone from your calendar.";
  if (kind === "updated") return "See what changed.";
  if (type === "ASSIGNMENT") {
    return one ? "Plan it before it's due." : "Plan them before they're due.";
  }
  if (type === "EXAM") return "Plan your revision now.";
  return "Check your timetable.";
}

/**
 * One notification per item type the run touched, e.g. "3 new lectures,
 * 2 lecture changes, 1 lecture removed" with a one-line next step. `eventName` uses
 * the most significant kind (created > updated > removed); a one-item row
 * keeps its `eventEndsAt`.
 */
export function digestNotifications(
  items: readonly DigestItem[],
  now: Date,
): DigestNotification[] {
  const out: DigestNotification[] = [];
  for (const type of TYPE_ORDER) {
    const ofType = items.filter((i) => i.type === type);
    if (ofType.length === 0) continue;

    const kinds: DigestKind[] = ["created", "updated", "removed"];
    const counts = kinds
      .map((k) => [k, ofType.filter((i) => i.kind === k).length] as const)
      .filter(([, n]) => n > 0);
    const parts = counts.map(([k, n]) =>
      phrase(type, k, n, counts.length === 1),
    );

    const one = ofType.length === 1;
    const sessionId = representative(ofType, now);
    const kind = ofType.some((i) => i.kind === "created")
      ? "created"
      : ofType.some((i) => i.kind === "updated")
        ? "updated"
        : "removed";
    out.push({
      sessionId,
      title: capitalize(`${parts.join(", ")}${onSource(type, ofType)}`),
      content: nextStep(type, kind, one, sessionId !== null),
      eventEndsAt: one ? ofType[0].endsAt : null,
      eventName: `${type.toLowerCase()}.group_${kind}`,
      materializeSession: false,
    });
  }
  return out;
}
