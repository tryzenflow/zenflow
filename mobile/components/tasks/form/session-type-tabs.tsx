import {
  CalendarClock,
  CheckSquare,
  ClipboardList,
  GraduationCap,
  type LucideIcon,
  MoonStar,
  Notebook,
} from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import type { SessionFormType } from "@zenflow/core";
import { Pressable, View } from "react-native";

const TABS: {
  key: SessionFormType | "FIXED";
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "TASK", label: "Task", icon: CheckSquare },
  { key: "FIXED", label: "Fixed", icon: CalendarClock },
  { key: "DND", label: "Do Not Disturb", icon: MoonStar },
];

const FIXED_TYPES: {
  key: SessionFormType;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "ASSIGNMENT", label: "Assignment", icon: ClipboardList },
  { key: "EXAM", label: "Exam", icon: Notebook },
  { key: "LECTURE", label: "Lecture", icon: GraduationCap },
];

const isFixed = (t: SessionFormType) =>
  t === "ASSIGNMENT" || t === "EXAM" || t === "LECTURE";

/**
 * Top-of-form 3-way selector for the create screen. "Fixed" reveals a nested
 * Assignment / Exam / Lecture picker. `type` is create-time only — this is
 * not rendered on the edit screen. Each option carries an icon that mirrors how
 * that session type reads on the day view (mockups/day-view.html): a graduation
 * cap for lectures, a ruled notebook for exams, etc.
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
    <View className="gap-2 pb-1">
      <View className="flex-row gap-1.5">
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.key}
              disabled={disabled}
              onPress={() =>
                onChange(tab.key === "FIXED" ? "ASSIGNMENT" : tab.key)
              }
              className={cn(
                "flex-1 items-center gap-1 rounded-lg border px-2 py-2",
                active
                  ? "border-primary bg-primary/10"
                  : "border-input bg-card",
                disabled && "opacity-50",
              )}
            >
              <Icon
                size={16}
                className={active ? "text-primary" : "text-muted-foreground"}
              />
              <Text
                className={cn(
                  "text-[12.5px] font-semibold",
                  active ? "text-primary" : "text-muted-foreground",
                )}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "FIXED" && (
        <View className="flex-row gap-1.5">
          {FIXED_TYPES.map((ft) => {
            const active = ft.key === value;
            const Icon = ft.icon;
            return (
              <Pressable
                key={ft.key}
                disabled={disabled}
                onPress={() => onChange(ft.key)}
                className={cn(
                  "flex-1 flex-row items-center justify-center gap-1.5 rounded-md border px-2 py-1.5",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-input bg-card",
                  disabled && "opacity-50",
                )}
              >
                <Icon
                  size={14}
                  className={active ? "text-primary" : "text-muted-foreground"}
                />
                <Text
                  className={cn(
                    "text-[11.5px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {ft.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
