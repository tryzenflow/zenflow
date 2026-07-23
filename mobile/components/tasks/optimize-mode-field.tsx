import { Lock, RefreshCcw, Scale, type LucideIcon } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import type { OptimizeWindowInput } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";

export type OptimizeMode = OptimizeWindowInput["mode"];

/** The three Optimize modes, with copy for the mode picker. Mode 3
 * ("balanced") is the one-click recommended default — ported from
 * `frontend/src/components/calendar/optimize-mode-field.tsx`. */
export const OPTIMIZE_MODES: {
  id: OptimizeMode;
  name: string;
  blurb: string;
  icon: LucideIcon;
}[] = [
  {
    id: "balanced",
    name: "Balanced",
    blurb: "Recommended. Repacks tasks while favoring your near-tied preferences.",
    icon: Scale,
  },
  {
    id: "full",
    name: "Full reflow",
    blurb: "Repacks every pending task in the window, including manual placements.",
    icon: RefreshCcw,
  },
  {
    id: "retainManual",
    name: "Retain manual placements",
    blurb: "Repacks auto-placed tasks only — manually moved tasks stay put.",
    icon: Lock,
  },
];

/**
 * Row-list selector for the Optimize `balanced | full | retainManual` mode —
 * mobile port of `frontend/src/components/calendar/optimize-mode-field.tsx`,
 * styled to match the rest of `OptimizeFab`'s sheet (rounded-xl cards,
 * primary/10 selected state) rather than the web version's rounded-md.
 */
export function OptimizeModeField({
  value,
  onChange,
}: {
  value: OptimizeMode;
  onChange: (mode: OptimizeMode) => void;
}) {
  return (
    <View className="gap-2">
      {OPTIMIZE_MODES.map((m) => {
        const on = value === m.id;
        const Icon = m.icon;
        return (
          <Pressable
            key={m.id}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(m.id);
            }}
            className={cn(
              "flex-row items-start gap-2.5 rounded-xl border px-3.5 py-3",
              on ? "border-primary bg-primary/10" : "border-border bg-card",
            )}
          >
            <View
              className={cn(
                "mt-0.5 h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                on
                  ? "border-primary/40 bg-primary/15"
                  : "border-border bg-muted",
              )}
            >
              <Icon
                size={14}
                className={on ? "text-primary" : "text-muted-foreground"}
              />
            </View>
            <View className="flex-1">
              <Text
                className={cn(
                  "text-[13px] font-semibold",
                  on ? "text-primary" : "text-foreground",
                )}
              >
                {m.name}
              </Text>
              <Text className="mt-0.5 text-[11.5px] text-muted-foreground">
                {m.blurb}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
