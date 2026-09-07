import type { SessionFormType } from "@zenflow/core";
import {
  CalendarClock,
  CheckSquare,
  ClipboardList,
  GraduationCap,
  type LucideIcon,
  MoonStar,
  NotebookPen,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { key: SessionFormType | "FIXED"; label: string; icon: LucideIcon }[] =
  [
    { key: "TASK", label: "Task", icon: CheckSquare },
    { key: "FIXED", label: "Fixed", icon: CalendarClock },
    { key: "DND", label: "Do Not Disturb", icon: MoonStar },
  ];

const FIXED_TYPES: { key: SessionFormType; label: string; icon: LucideIcon }[] = [
  { key: "ASSIGNMENT", label: "Assignment", icon: ClipboardList },
  { key: "EXAM", label: "Exam", icon: NotebookPen },
  { key: "LECTURE", label: "Lecture", icon: GraduationCap },
];

const isFixed = (t: SessionFormType) =>
  t === "ASSIGNMENT" || t === "EXAM" || t === "LECTURE";

/**
 * Top-of-form 3-way selector for the create dialog. "Fixed" reveals a nested
 * Assignment / Exam / Lecture picker. `type` is create-time only — not rendered
 * on the edit dialog. Mirrors `mobile/components/tasks/form/session-type-tabs.tsx`.
 */
export function SessionTypeTabs({
  value,
  onChange,
  disabled,
}: {
  value: SessionFormType;
  onChange: (type: SessionFormType) => void;
  disabled?: boolean;
}) {
  const activeTab: string = isFixed(value) ? "FIXED" : value;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange(tab.key === "FIXED" ? "ASSIGNMENT" : tab.key)
              }
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-50",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
              )}
            >
              <Icon className="size-4" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "FIXED" && (
        <div className="grid grid-cols-3 gap-1.5">
          {FIXED_TYPES.map((ft) => {
            const active = ft.key === value;
            const Icon = ft.icon;
            return (
              <button
                key={ft.key}
                type="button"
                disabled={disabled}
                onClick={() => onChange(ft.key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
                )}
              >
                <Icon className="size-3.5" />
                {ft.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
