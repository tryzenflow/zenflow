import { SESSION_TYPE_META } from "@zenflow/core";
import type { SessionType } from "@zenflow/shared";
import {
  CheckSquare,
  CircleAlert,
  ClipboardList,
  GraduationCap,
  type LucideIcon,
  MoonStar,
  NotebookPen,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<SessionType, LucideIcon> = {
  TASK: CheckSquare,
  ASSIGNMENT: ClipboardList,
  EXAM: NotebookPen,
  LECTURE: GraduationCap,
  DND: MoonStar,
};

export const sessionTypeIcon = (type: SessionType): LucideIcon =>
  TYPE_ICON[type];

/**
 * A small tag-like chip naming a session's type, tinted with that type's
 * colour (`SESSION_TYPE_META`). Web counterpart of
 * `mobile/components/calendar/session-type-badge.tsx`.
 */
export function SessionTypeBadge({
  type,
  iconOnly = false,
  className,
}: {
  type: SessionType;
  iconOnly?: boolean;
  className?: string;
}) {
  const meta = SESSION_TYPE_META[type];
  const Icon = TYPE_ICON[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 self-start rounded border px-1.5 py-0.5",
        meta.badgeClass,
        className,
      )}
    >
      <Icon className={cn("size-3", meta.textClass)} />
      {!iconOnly && (
        <span className={cn("text-[9px] font-semibold leading-none", meta.textClass)}>
          {meta.label}
        </span>
      )}
    </span>
  );
}

/**
 * A small tag-like chip flagging a session the server placed past its
 * deadline (`ACCEPT_LATE_DEADLINE` infeasible-schedule policy, #62). Same
 * visual family as {@link SessionTypeBadge}, rendered alongside it rather
 * than instead of it — this is additive to the existing `LATE_CARD_CLASSES`
 * red card tint (`late-context.ts`), not a replacement.
 */
export function OverdueBadge({
  iconOnly = false,
  className,
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 self-start rounded border px-1.5 py-0.5",
        "border-red-500/40 bg-red-500/15",
        className,
      )}
    >
      <CircleAlert className="size-3 text-red-600 dark:text-red-300" />
      {!iconOnly && (
        <span className="text-[9px] font-semibold leading-none text-red-600 dark:text-red-300">
          Overdue
        </span>
      )}
    </span>
  );
}
