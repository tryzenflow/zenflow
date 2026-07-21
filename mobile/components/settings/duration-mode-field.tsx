import { Pressable, View } from "react-native";
import type { DurationAdjustmentMode } from "@zenflow/shared";
import {
  MessageCircleQuestion,
  MinusCircle,
  Sparkles,
} from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/** The three duration-corrector UX modes, with copy for the radio control. */
export const DURATION_MODES: {
  id: DurationAdjustmentMode;
  name: string;
  blurb: string;
  icon: typeof Sparkles;
}[] = [
  {
    id: "auto",
    name: "Automatic",
    blurb:
      "Apply the learned duration and let me undo it. Best once Zenflow knows your pace.",
    icon: Sparkles,
  },
  {
    id: "ask",
    name: "Ask first",
    blurb: "Show the suggestion and let me accept it or keep my estimate.",
    icon: MessageCircleQuestion,
  },
  {
    id: "never",
    name: "Never",
    blurb:
      "Always use the duration I type. Zenflow still learns in the background.",
    icon: MinusCircle,
  },
];

/**
 * Radio-style selector for the `auto | ask | never` duration-adjustment mode.
 * Shared between the Settings screen and the onboarding wizard so the copy
 * and visuals stay in lockstep (port of frontend's duration-mode-field.tsx).
 */
export function DurationModeField({
  value,
  onChange,
}: {
  value: DurationAdjustmentMode;
  onChange: (mode: DurationAdjustmentMode) => void;
}) {
  return (
    <View className="gap-2">
      {DURATION_MODES.map((m) => {
        const on = value === m.id;
        const Icon = m.icon;
        return (
          <Pressable
            key={m.id}
            onPress={() => onChange(m.id)}
            className={cn(
              "flex-row items-start gap-3 rounded-md border p-3",
              on ? "border-primary bg-primary/10" : "border-border bg-card",
            )}
          >
            <View
              className={cn(
                "mt-0.5 h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                on
                  ? "border-orange-200 bg-orange-50"
                  : "border-border bg-muted",
              )}
            >
              <Icon
                size={16}
                className={on ? "text-primary" : "text-muted-foreground"}
              />
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-sm font-semibold">{m.name}</Text>
              <Text className="text-[11px] text-muted-foreground">
                {m.blurb}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
