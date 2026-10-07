import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
import { useSpotlight } from "@/hooks/use-spotlight";
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
import Svg, { Path } from "react-native-svg";
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

/** Steps whose how-to is a gesture; shown as a looping fingertip over the control. */
type Gesture = "drag-down" | "drag-to-cell" | "hold";
const GESTURE: Partial<Record<ChecklistStep, Gesture>> = {
  "move-task": "drag-down",
  "block-actions": "hold",
  // Dragged out of the day's bottom sheet onto a cell of the month grid.
  "move-day": "drag-to-cell",
};
const FINGER = 88;
// Where the fingertip sits inside the finger glyph (fractions of its size), so
// the tip — not the icon's centre — lands on the control.
const TIP_X = 0.43;
const TIP_Y = 0.09;
const RIPPLE = 72;
/** Without a measured cell, drag this far up (towards the grid). */
const FALLBACK_DRAG_UP = 140;

/**
 * One closed outline (no overlapping sub-paths, so no see-through gaps): a
 * raised index finger over a curled fist.
 */
const FINGER_PATH =
  "M8.5 14.2 L8.5 4 a1.75 1.75 0 0 1 3.5 0 v6.2 a1.5 1.5 0 0 1 3 0.1 v0.4 a1.5 1.5 0 0 1 3 0.3 v0.6 a1.5 1.5 0 0 1 3 0.4 V16 c0 4 -2.5 6.5 -6 6.5 h-1.2 c-2 0 -3.3 -0.8 -4.5 -2 l-3.3 -3.5 a1.6 1.6 0 0 1 2.4 -2.1 Z";

/**
 * A looping finger. Like the real gesture it first presses and holds (the
 * ripple fills while the long-press builds), then drags — down a little for a
 * block, onto a real grid cell for a day — and lets go. Purely decorative.
 */
function GestureHint({
  kind,
  spot,
  target,
}: {
  kind: Gesture;
  spot: Rect;
  target: Rect | null;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: kind === "hold" ? 2800 : 3800,
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
  let dx = 0;
  let dy = 0;
  if (kind === "drag-down") {
    dy = Math.min(spot.height * 0.5 + 28, 96);
  } else if (kind === "drag-to-cell") {
    if (target) {
      dx = target.x + target.width / 2 - cx;
      dy = target.y + target.height / 2 - cy;
    } else {
      dy = -FALLBACK_DRAG_UP;
    }
  }
  const hold = kind === "hold";
  // Phase edges (fractions of the loop): appear, press+hold, drag, drop, fade.
  const times = hold ? [0, 0.06, 0.12, 0.72, 0.8, 0.92, 1] : [0, 0.05, 0.1, 0.4, 0.82, 0.9, 1];
  const moveX = [0, 0, 0, 0, dx, dx, dx];
  const moveY = [0, 0, 0, 0, dy, dy, dy];

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.05, 0.9, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(t.value, times, hold ? [0, 0, 0, 0, 0, 0, 0] : moveX) },
      { translateY: interpolate(t.value, times, hold ? [0, 0, 0, 0, 0, 0, 0] : moveY) },
      {
        // Presses in as the hold starts; springs back on release.
        scale: interpolate(
          t.value,
          hold ? [0, 0.06, 0.12, 0.72, 0.8] : [0, 0.05, 0.1, 0.82, 0.9],
          [1.15, 1.15, 0.92, 0.92, 1.15],
        ),
      },
    ],
  }));
  // Ripple under the fingertip: fills during the long-press, then rides along.
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      t.value,
      hold ? [0.06, 0.14, 0.72, 0.85] : [0.05, 0.12, 0.82, 0.9],
      [0, 0.6, 0.6, 0],
      "clamp",
    ),
    transform: [
      { translateX: interpolate(t.value, times, hold ? [0, 0, 0, 0, 0, 0, 0] : moveX) },
      { translateY: interpolate(t.value, times, hold ? [0, 0, 0, 0, 0, 0, 0] : moveY) },
      {
        scale: interpolate(
          t.value,
          hold ? [0.06, 0.4, 0.72] : [0.05, 0.4],
          hold ? [0.4, 1.5, 1.7] : [0.4, 1.1],
          "clamp",
        ),
      },
    ],
  }));
  // The target cell lights up while the finger travels to it and lets go.
  const targetStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.4, 0.55, 0.82, 0.9, 1], [0, 0.9, 1, 1, 0], "clamp"),
  }));

  return (
    <View pointerEvents="none" className="absolute inset-0">
      {kind === "drag-to-cell" && target ? (
        <Animated.View
          className="absolute rounded-lg border-2 border-white bg-white/25"
          style={[
            {
              left: target.x,
              top: target.y,
              width: target.width,
              height: target.height,
            },
            targetStyle,
          ]}
        />
      ) : null}
      <Animated.View
        className="absolute rounded-full bg-white"
        style={[
          {
            left: cx - RIPPLE / 2,
            top: cy - RIPPLE / 2,
            width: RIPPLE,
            height: RIPPLE,
          },
          rippleStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            position: "absolute",
            left: cx - FINGER * TIP_X,
            top: cy - FINGER * TIP_Y,
            width: FINGER,
            height: FINGER,
            shadowColor: "#000",
            shadowOpacity: 0.45,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
          },
          fingerStyle,
        ]}
      >
        <Svg width={FINGER} height={FINGER} viewBox="0 0 24 24">
          <Path
            d={FINGER_PATH}
            fill="#fff"
            stroke="#18181b"
            strokeWidth={0.9}
            strokeLinejoin="round"
          />
        </Svg>
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
  const dragTarget = useSpotlight((s) => s.dragTarget);
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
        <GestureHint kind={GESTURE[step]!} spot={spot} target={dragTarget} />
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
