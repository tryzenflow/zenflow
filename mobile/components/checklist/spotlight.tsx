import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
import { STEP_COPY } from "@/lib/checklist";
import {
  arrowLeft,
  bubblePlacement,
  type Rect,
  spotlightRect,
} from "@/lib/spotlight";
import type { ChecklistStep } from "@zenflow/shared";
import { type ReactNode, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { Hand } from "lucide-react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";

const GUTTER = 16;
const FALLBACK_BUBBLE_HEIGHT = 120;
const ARROW = 14;

/**
 * Above everything, bottom sheets included. iOS sheets live in a
 * `FullWindowOverlay` (see `ui/bottom-sheet.native.tsx`), which sits over any
 * `Modal`, so the spotlight uses one too; Android's `Modal` is already on top.
 */
function Layer({
  children,
  onRequestClose,
}: {
  children: ReactNode;
  onRequestClose: () => void;
}) {
  if (Platform.OS === "ios") {
    return (
      <FullWindowOverlay>
        <GestureHandlerRootView style={{ flex: 1 }} pointerEvents="box-none">
          {children}
        </GestureHandlerRootView>
      </FullWindowOverlay>
    );
  }
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      {children}
    </Modal>
  );
}

/** Steps whose how-to is a gesture; shown as a looping hand over the control. */
const GESTURE: Partial<Record<ChecklistStep, "drag-y" | "drag-x" | "hold">> = {
  "move-task": "drag-y",
  "block-actions": "hold",
  "move-day": "drag-x",
};
const HAND = 40;

/**
 * A looping hand: press down on the control, drag (vertically for a task,
 * sideways for a day cell) or just hold, release, repeat. Purely decorative.
 */
function GestureHint({
  kind,
  spot,
  screenWidth,
}: {
  kind: "drag-y" | "drag-x" | "hold";
  spot: Rect;
  screenWidth: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: kind === "hold" ? 1800 : 2000,
          easing: Easing.linear,
        }),
        withDelay(500, withTiming(0, { duration: 0 })),
      ),
      -1,
    );
    return () => cancelAnimation(t);
  }, [kind, t]);

  const cx = spot.x + spot.width / 2;
  const cy = spot.y + spot.height / 2;
  // Drag toward whichever side has room: down for a task, the roomier
  // horizontal side for a day cell.
  const dx =
    kind === "drag-x" ? (cx > screenWidth * 0.6 ? -1 : 1) * (spot.width + 6) : 0;
  const dy = kind === "drag-y" ? Math.min(spot.height * 0.5 + 20, 80) : 0;

  const handStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.08, 0.88, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(t.value, [0, 0.3, 0.8, 1], [0, 0, dx, dx]) },
      { translateY: interpolate(t.value, [0, 0.3, 0.8, 1], [0, 0, dy, dy]) },
      {
        scale: interpolate(
          t.value,
          kind === "hold" ? [0, 0.15, 0.25, 0.9, 1] : [0, 0.2, 0.3, 0.8, 0.9],
          kind === "hold" ? [1, 1, 0.82, 0.82, 1] : [1, 1, 0.82, 0.82, 1],
        ),
      },
    ],
  }));
  // Ripple under the fingertip while it is pressed.
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      t.value,
      kind === "hold" ? [0.2, 0.3, 0.9] : [0.25, 0.3, 0.8],
      [0, 0.5, 0],
      "clamp",
    ),
    transform: [
      { translateX: interpolate(t.value, [0, 0.3, 0.8, 1], [0, 0, dx, dx]) },
      { translateY: interpolate(t.value, [0, 0.3, 0.8, 1], [0, 0, dy, dy]) },
      { scale: interpolate(t.value, [0.25, 0.9], [0.6, kind === "hold" ? 1.8 : 1.2], "clamp") },
    ],
  }));

  return (
    <View
      pointerEvents="none"
      className="absolute"
      style={{ left: cx - HAND / 2, top: cy - HAND / 2, width: HAND, height: HAND }}
    >
      <Animated.View
        className="absolute inset-0 rounded-full bg-white"
        style={rippleStyle}
      />
      <Animated.View style={handStyle}>
        <Hand size={HAND} color="#fff" fill="rgba(255,255,255,0.25)" />
      </Animated.View>
    </View>
  );
}

/**
 * Dims the screen around one control and shows a short bubble with **Got it**
 * (the step's how-to from the checklist). Blocks touches until dismissed.
 * `rect` is the control in window coordinates.
 */
export function Spotlight({
  step,
  rect,
  onDismiss,
}: {
  step: ChecklistStep;
  rect: Rect;
  onDismiss: () => void;
}) {
  useLanguage();
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [bubbleHeight, setBubbleHeight] = useState(FALLBACK_BUBBLE_HEIGHT);
  const { title, hint } = STEP_COPY[step];

  const spot = spotlightRect(rect, screen);
  const bubbleWidth = screen.width - GUTTER * 2;
  const { top, side } = bubblePlacement(spot, screen, insets, bubbleHeight);
  const arrowX = arrowLeft(spot, GUTTER, bubbleWidth, ARROW);

  return (
    <Layer onRequestClose={onDismiss}>
      {/* Four dim panels leave a hole over the target (no SVG mask needed, no outline);
          an empty Pressable fills the hole so taps can't reach the control. */}
      <View className="absolute inset-0" pointerEvents="box-none">
        <Pressable
          accessible={false}
          className="absolute"
          style={{
            left: spot.x,
            top: spot.y,
            width: spot.width,
            height: spot.height,
          }}
        />
        <View
          className="absolute bg-black/65"
          style={{ left: 0, right: 0, top: 0, height: spot.y }}
        />
        <View
          className="absolute bg-black/65"
          style={{ left: 0, right: 0, top: spot.y + spot.height, bottom: 0 }}
        />
        <View
          className="absolute bg-black/65"
          style={{ left: 0, width: spot.x, top: spot.y, height: spot.height }}
        />
        <View
          className="absolute bg-black/65"
          style={{
            left: spot.x + spot.width,
            right: 0,
            top: spot.y,
            height: spot.height,
          }}
        />
      </View>

      {GESTURE[step] ? (
        <GestureHint
          kind={GESTURE[step]!}
          spot={spot}
          screenWidth={screen.width}
        />
      ) : null}

      <View
        accessibilityViewIsModal
        onLayout={(e) => setBubbleHeight(e.nativeEvent.layout.height)}
        className="absolute rounded-2xl border border-border bg-card p-4"
        style={{ left: GUTTER, width: bubbleWidth, top }}
      >
        <View
          className="absolute rotate-45 border-border bg-card"
          style={[
            { left: arrowX, width: ARROW, height: ARROW },
            side === "below"
              ? { top: -ARROW / 2, borderTopWidth: 1, borderLeftWidth: 1 }
              : { bottom: -ARROW / 2, borderBottomWidth: 1, borderRightWidth: 1 },
          ]}
        />
        <Text className="text-[15px] font-bold tracking-tight text-foreground">
          {title}
        </Text>
        <Text className="mt-1 text-[13.5px] leading-5 text-muted-foreground">
          {hint}
        </Text>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("Got it")}
          className="mt-3 self-end rounded-full bg-primary px-4 py-2 active:opacity-80"
        >
          <Text className="text-[13px] font-semibold text-primary-foreground">
            {t("Got it")}
          </Text>
        </Pressable>
      </View>
    </Layer>
  );
}
