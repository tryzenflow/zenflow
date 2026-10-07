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
