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
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import type { SessionFormType } from "@zenflow/core";
import { Pressable, View } from "react-native";

type TabKey = "TASK" | "FIXED";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "TASK", label: "Task", icon: CheckSquare },
  { key: "FIXED", label: "Fixed", icon: CalendarClock },
];

/** The Fixed tab's 2×2 grid — every type pinned to a set time. */
const FIXED_TYPES: {
  key: Exclude<SessionFormType, "TASK">;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "ASSIGNMENT", label: "Assignment", icon: ClipboardList },
  { key: "EXAM", label: "Exam", icon: Notebook },
  { key: "LECTURE", label: "Lecture", icon: GraduationCap },
  { key: "DND", label: "Do not disturb", icon: MoonStar },
];

/**
 * Accent per session type, matching the calendar blocks' left border. Hex, not
 * classes: NativeWind color interop on lucide icons is unreliable on native.
 */
const TYPE_ACCENT: Record<SessionFormType, { light: string; dark: string }> = {
  TASK: { light: NAV_THEME.light.primary, dark: NAV_THEME.dark.primary },
  ASSIGNMENT: { light: "#0d9488", dark: "#2dd4bf" },
  EXAM: { light: "#e11d48", dark: "#fb7185" },
  LECTURE: { light: "#0284c7", dark: "#38bdf8" },
  DND: { light: "#64748b", dark: "#94a3b8" },
};

const isFixed = (t: SessionFormType) => t !== "TASK";

/**
 * Create-screen selector: Task | Fixed, where Fixed reveals a 2×2 Assignment /
 * Exam / Lecture / Do not disturb grid, tinted with each type's calendar colour.
 * Create-time only.
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
  const { isDarkColorScheme } = useColorScheme();
  const scheme = isDarkColorScheme ? "dark" : "light";
  const muted = NAV_THEME[scheme].mutedForeground;
  const activeTab: TabKey = isFixed(value) ? "FIXED" : "TASK";
  const accentOf = (type: SessionFormType) => TYPE_ACCENT[type][scheme];

  return (
    <View className="gap-2 pb-1">
      <View className="flex-row gap-1.5">
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          const Icon = tab.icon;
          const color = active ? accentOf(value) : muted;
          return (
            <Pressable
              key={tab.key}
              disabled={disabled}
              onPress={() => {
                if (active) return;
                onChange(tab.key === "FIXED" ? "ASSIGNMENT" : "TASK");
              }}
              className={cn(
                "flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5",
                !active && "border-input bg-card",
                disabled && "opacity-50",
              )}
              style={
                active
                  ? { borderColor: color, backgroundColor: `${color}1a` }
                  : undefined
              }
            >
              <Icon size={16} color={color} />
              <Text
                className="text-[13px] font-semibold"
                style={{ color }}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "FIXED" && (
        <View className="flex-row flex-wrap" style={{ gap: 6 }}>
          {FIXED_TYPES.map((ft) => {
            const active = ft.key === value;
            const Icon = ft.icon;
            const color = active ? accentOf(ft.key) : muted;
            return (
              <Pressable
                key={ft.key}
                disabled={disabled}
                onPress={() => onChange(ft.key)}
                // Two per row: half the width minus half the 6px gap.
                style={[
                  { flexBasis: "48%", flexGrow: 1 },
                  active && {
                    borderColor: color,
                    backgroundColor: `${color}1a`,
                  },
                ]}
                className={cn(
                  "flex-row items-center justify-center gap-1.5 rounded-md border px-2 py-2",
                  !active && "border-input bg-card",
                  disabled && "opacity-50",
                )}
              >
                <Icon size={15} color={color} />
                <Text
                  className="text-[12.5px] font-semibold"
                  style={{ color }}
                  numberOfLines={1}
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
