import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { navigateOnce } from "@/lib/nav";
import { Check, ChevronRight, ClipboardList } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { completeStep, useChecklist } from "@/hooks/use-checklist";
import { STEP_SCREEN } from "@/lib/checklist";
import type { ChecklistStep } from "@zenflow/shared";
import { FAB_GLOW_INNER, FAB_GLOW_OUTER } from "@/lib/fab-glow";
import { cn } from "@/lib/utils";
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

/** Where each step's row goes. The DLU step opens the Me tab's DLU section. */
function routeFor(step: ChecklistStep): Href {
  if (step === "add-task") return "/task/new" as Href;
  if (STEP_SCREEN[step] === "me") {
    return { pathname: "/(app)/settings", params: { focus: "dlu" } } as Href;
  }
  return "/" as Href;
}

/**
 * The first-run "Getting started" checklist: a pill in the calendar header
 * that opens a sheet of three steps (connect DLU, add a task, finish a
 * session). Each step ticks itself off when the user does it (`completeStep`).
 * The pill goes away when every step is done or the user hides it. Render it
 * inside the calendar header.
 *
 * Deliberately loud while nothing is ticked: a slow, soft pulse, because a
 * first-run guide nobody notices is no guide.
 */
export function GettingStarted() {
  useLanguage();
  const sheet = useBottomSheet();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, done, total, visible } = useChecklist();
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

  const openStep = (step: ChecklistStep) => {
    Haptics.selectionAsync().catch(() => {});
    sheet.close();
    const href = routeFor(step);
    navigateOnce(() => router.navigate(href));
  };

  if (!visible) return null;

  return (
    <>
      <Animated.View style={[FAB_GLOW_OUTER, { borderRadius: 18 }, pulseStyle]}>
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
          testID="getting-started.pill"
          style={FAB_GLOW_INNER}
          className="h-9 flex-row items-center gap-1.5 rounded-full bg-primary px-3 active:opacity-80"
        >
          <ClipboardList size={15} className="text-primary-foreground" />
          <Text className="text-[13px] font-bold text-primary-foreground">
            {done === 0 ? t("Getting started") : `${done}/${total}`}
          </Text>
        </Pressable>
      </Animated.View>

      <BottomSheet>
        <BottomSheetContent ref={sheet.ref}>
          <BottomSheetView
            hadHeader={false}
            className="gap-1 pt-2"
            // Only the home-indicator inset: the default adds a 20px gap that
            // read as dead space under "Hide this checklist".
            style={{ paddingBottom: insets.bottom + 6 }}
          >
            <View className="mb-2 flex-row items-center justify-between px-1">
              <Text className="text-[19px] font-bold tracking-tight">
                {t("Getting started")}
              </Text>
              <View className="rounded-full bg-primary px-3 py-1">
                <Text className="text-[15px] font-bold text-primary-foreground">
                  {t("Done {done}/{total}", { done, total })}
                </Text>
              </View>
            </View>

            {items.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => openStep(item.id)}
                accessibilityRole="button"
                accessibilityLabel={t("Open: {title}", { title: item.title })}
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
                </View>
                <ChevronRight size={16} className="mt-1 text-muted-foreground" />
              </Pressable>
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
