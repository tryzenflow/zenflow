import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Check, ChevronRight, ClipboardList } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { completeStep, useChecklist } from "@/hooks/use-checklist";
import { useSpotlight } from "@/hooks/use-spotlight";
import { STEP_SCREEN } from "@/lib/checklist";
import { FAB_GLOW_INNER, FAB_GLOW_OUTER } from "@/lib/fab-glow";
import { cn } from "@/lib/utils";
import type { ChecklistStep } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/** Gap from the screen's right edge to clear the notification bell (16 + 36 + 8). */
const BELL_CLEARANCE = 60;

/**
 * The first-run "Getting started" checklist (issue #116): a small pill floating
 * at the top of the screen, just left of the notification bell that opens a
 * sheet of steps, grouped Week view / Month view. Each step ticks itself off
 * when the user does it (`completeStep`); the pill goes away when every step
 * is done or the user hides it. Render it once in the Week and Month screens.
 *
 * Deliberately loud — the same amber glow as the + button, and a slow, soft
 * pulse until the first step is ticked — because a first-run guide nobody
 * notices is no guide. Tapping a step closes the sheet, switches to the screen
 * that step lives on and spotlights the control (`SpotlightAnchor`).
 */
export function GettingStarted() {
  useLanguage();
  const sheet = useBottomSheet();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { groups, done, total, visible } = useChecklist();
  const reduceMotion = useReducedMotion();

  // Gentle "bump" while nothing is ticked yet; calm once the user is under way.
  const pulse = useSharedValue(1);
  const pulsing = visible && done === 0 && !reduceMotion;
  useEffect(() => {
    if (pulsing) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.035, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 150 });
    }
    return () => cancelAnimation(pulse);
  }, [pulsing, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  // Tap a step: close the sheet, go to its screen, then spotlight its control.
  // If nothing turns up to point at (no task yet), point at + instead.
  const showMe = (tapped: ChecklistStep, blockedBy: ChecklistStep | null) => {
    Haptics.selectionAsync().catch(() => {});
    sheet.close();
    // A step that needs a task: point at the + button instead.
    const step = blockedBy ?? tapped;
    const screen = STEP_SCREEN[step];
    setTimeout(() => {
      if (screen) router.navigate((screen === "week" ? "/" : "/month") as Href);
      useSpotlight.getState().show(step);
      // Nothing to point at (the task was deleted, say): point at + instead.
      setTimeout(() => {
        const { step: current, shown, show } = useSpotlight.getState();
        if (current === step && !shown && step !== "create-task")
          show("create-task");
      }, 5000);
    }, 320);
  };

  if (!visible) return null;

  return (
    <>
      <View
        pointerEvents="box-none"
        style={{ top: insets.top + 8, right: BELL_CLEARANCE }}
        className="absolute z-20"
      >
        <Animated.View
          style={[FAB_GLOW_OUTER, { borderRadius: 18 }, pulseStyle]}
        >
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              sheet.open();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("Getting started, {done} of {total} done", {
              done,
              total,
            })}
            style={FAB_GLOW_INNER}
            className="h-9 flex-row items-center gap-1.5 rounded-full bg-primary px-3 active:opacity-80"
          >
            <ClipboardList size={15} className="text-primary-foreground" />
            <Text className="text-[13px] font-bold text-primary-foreground">
              {done === 0 ? t("Getting started") : `${done}/${total}`}
            </Text>
          </Pressable>
        </Animated.View>
      </View>

      <BottomSheet>
        <BottomSheetContent ref={sheet.ref}>
          <BottomSheetView hadHeader={false} className="gap-1 pt-2">
            <View className="mb-2 px-1">
              <Text className="text-[19px] font-bold tracking-tight">
                {t("Getting started")}
              </Text>
              <Text className="mt-[3px] text-[13px] text-muted-foreground">
                {t(
                  "{done} of {total} done. Steps tick off as you try them — tap one for a quick guide.",
                  { done, total },
                )}
              </Text>
            </View>

            {groups.map((group) => (
              <View key={group.id} className="mt-1">
                <Text className="px-1 pb-0.5 pt-2 text-[12px] font-medium text-muted-foreground">
                  {group.title}
                </Text>
                {group.items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => showMe(item.id, item.blockedBy)}
                    accessibilityRole="button"
                    accessibilityLabel={t("Show me: {title}", { title: item.title })}
                    className="flex-row items-start gap-3 rounded-xl px-1 py-2.5 active:opacity-70"
                  >
                    <View
                      className={cn(
                        "mt-0.5 size-[22px] items-center justify-center rounded-full border-[1.5px]",
                        item.done
                          ? "border-primary bg-primary"
                          : "border-border bg-transparent",
                      )}
                    >
                      {item.done ? (
                        <Check
                          size={13}
                          strokeWidth={3}
                          className="text-primary-foreground"
                        />
                      ) : null}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text
                        className={cn(
                          "text-[15px] font-semibold",
                          item.done
                            ? "text-muted-foreground line-through"
                            : "text-foreground",
                        )}
                      >
                        {item.title}
                      </Text>
                      <Text className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
                        {item.hint}
                      </Text>
                      {item.blockedBy ? (
                        <Text className="mt-0.5 text-[12.5px] font-medium text-primary-text">
                          {t("Create a task first.")}
                        </Text>
                      ) : null}
                    </View>
                    <ChevronRight
                      size={16}
                      className="mt-1 text-muted-foreground"
                    />
                  </Pressable>
                ))}
              </View>
            ))}

            <Pressable
              onPress={() => {
                sheet.close();
                completeStep("checklist-hidden");
              }}
              accessibilityRole="button"
              className="mt-2 items-center rounded-xl py-3 active:opacity-70"
            >
              <Text className="text-[14px] font-medium text-muted-foreground">
                {t("Hide this checklist")}
              </Text>
            </Pressable>
          </BottomSheetView>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
