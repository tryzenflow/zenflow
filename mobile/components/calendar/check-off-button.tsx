import { Check } from "@/components/Icons";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { DURATION, EASE_OUT, useReducedMotion } from "@/lib/motion";
import type { CheckState } from "@/lib/today-summary";
import { cn } from "@/lib/utils";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/** Touch target: 44pt, drawn as a 22pt disc. */
const TARGET = 44;
const DISC = 22;

/**
 * Tap to mark a session done. Filling the disc fires a light haptic and one
 * sun-coloured burst. The disc shows the tap at once; `state` catches up when
 * the server answers, and a rejected change snaps back.
 */
export function CheckOffButton({
  state,
  title,
  onToggle,
  style,
}: {
  state: CheckState;
  title: string;
  /** Resolves `false` when the change was rejected. */
  onToggle: (next: "done" | "open") => Promise<boolean> | boolean | void;
  style?: object;
}) {
  useLanguage();
  const reduceMotion = useReducedMotion();
  const [pending, setPending] = useState<"done" | "open" | null>(null);
  useEffect(() => setPending(null), [state]);

  const shown: CheckState = pending ?? state;
  const done = shown === "done";

  const burst = useSharedValue(1);
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current && !reduceMotion) {
      burst.value = 0;
      burst.value = withTiming(1, { duration: DURATION.slow, easing: EASE_OUT });
    }
    wasDone.current = done;
  }, [done, reduceMotion, burst]);

  const burstStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - burst.value),
    transform: [{ scale: 0.6 + burst.value * 1.6 }],
  }));

  return (
    <Pressable
      testID="check-off"
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={
        done
          ? t("Mark {title} not done", { title })
          : t("Mark {title} done", { title })
      }
      hitSlop={(TARGET - DISC) / 2}
      onPress={async () => {
        const next = done ? "open" : "done";
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setPending(next);
        const ok = await onToggle(next);
        if (ok === false) setPending(null);
      }}
      style={[
        {
          width: TARGET,
          height: TARGET,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: DISC,
            height: DISC,
            borderRadius: DISC / 2,
          },
          burstStyle,
        ]}
        className="bg-brand-orange"
      />
      <View
        pointerEvents="none"
        style={{ width: DISC, height: DISC, borderRadius: DISC / 2 }}
        className={cn(
          "items-center justify-center border-2",
          done
            ? "border-brand-orange bg-brand-orange"
            : "border-muted-foreground bg-card",
        )}
      >
        {done ? (
          <Check size={13} strokeWidth={3} className="text-primary-foreground" />
        ) : null}
      </View>
    </Pressable>
  );
}
