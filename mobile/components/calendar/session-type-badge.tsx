import {
  CheckSquare,
  ClipboardList,
  GraduationCap,
  type LucideIcon,
  MoonStar,
  Notebook,
} from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { SESSION_TYPE_META } from "@/lib/session-type";
import { cn } from "@/lib/utils";
import type { SessionType } from "@zenflow/shared";
import { View } from "react-native";

/** Per-type icon — kept here (not in the RN-free `lib/session-type.ts`) and
 * matched to `components/tasks/form/session-type-tabs.tsx`. */
const TYPE_ICON: Record<SessionType, LucideIcon> = {
  TASK: CheckSquare,
  ASSIGNMENT: ClipboardList,
  EXAM: Notebook,
  LECTURE: GraduationCap,
  DND: MoonStar,
};

/** The bare Lucide icon for a session type — for spots too small for the full
 * {@link SessionTypeBadge} chip (month pills, the day-sheet row). */
export const sessionTypeIcon = (type: SessionType): LucideIcon =>
  TYPE_ICON[type];

interface SessionTypeBadgeProps {
  type: SessionType;
  /** `sm` — the compact day block / month pill (icon only by default).
   * `md` — the roomy day block and list rows (icon + label). */
  size?: "sm" | "md";
  /** Force icon-only even at `md` (e.g. very short blocks). */
  iconOnly?: boolean;
  className?: string;
}

/**
 * A small tag-like chip naming a session's type, tinted with that type's colour
 * (`SESSION_TYPE_META`). Sits alongside the tag chips in `task-block.tsx` and
 * replaces the bare colour dot in the month day sheet, so the type is legible
 * without decoding the left-border colour.
 */
export function SessionTypeBadge({
  type,
  size = "md",
  iconOnly = false,
  className,
}: SessionTypeBadgeProps) {
  const meta = SESSION_TYPE_META[type];
  const Icon = TYPE_ICON[type];
  const showLabel = size === "md" && !iconOnly;
  const iconSize = size === "sm" ? 10 : 12;

  return (
    <View
      className={cn(
        "flex-row items-center self-start rounded border",
        size === "sm" ? "gap-0.5 px-1 py-0.5" : "gap-1 px-1.5 py-0.5",
        meta.badgeClass,
        className,
      )}
    >
      <Icon size={iconSize} className={meta.textClass} />
      {showLabel && (
        <Text
          className={cn(
            "text-[10px] font-semibold leading-none",
            meta.textClass,
          )}
        >
          {meta.label}
        </Text>
      )}
    </View>
  );
}
