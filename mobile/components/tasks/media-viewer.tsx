import { X } from "@/components/Icons";
import { GlassButton } from "@/components/ui/glass-button";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import type { OpenMedia } from "@/lib/note-media";
import { Modal, StyleSheet, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { WebView } from "react-native-webview";

const MAX_SCALE = 5;

/**
 * Full-screen viewer for a note's image or video. Images pinch to zoom, drag
 * when zoomed and double-tap to toggle; video opens in a black page with the
 * native controls (the WebView's own pinch zoom covers video).
 */
export function MediaViewer({
  media,
  onClose,
}: {
  media: OpenMedia | null;
  onClose: () => void;
}) {
  useLanguage();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={media != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        {media?.kind === "image" && <ZoomableImage uri={media.src} />}
        {media?.kind === "video" && (
          <WebView
            originWhitelist={["*"]}
            style={styles.root}
            allowsInlineMediaPlayback
            source={{
              html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes"><style>html,body{margin:0;height:100%;background:#000;display:flex;align-items:center;justify-content:center}video{width:100%;max-height:100%}</style></head><body><video src="${media.src.replace(/"/g, "&quot;")}" controls autoplay playsinline></video></body></html>`,
            }}
          />
        )}
        <GlassButton
          onPress={onClose}
          icon={X}
          accessibilityLabel={t("Close")}
          style={[styles.close, { top: insets.top + 8 }]}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);

  const reset = () => {
    "worklet";
    scale.value = withTiming(1);
    x.value = withTiming(0);
    y.value = withTiming(0);
    baseScale.value = 1;
    baseX.value = 0;
    baseY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, baseScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) reset();
      else baseScale.value = scale.value;
    });
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      x.value = baseX.value + e.translationX;
      y.value = baseY.value + e.translationY;
    })
    .onEnd(() => {
      baseX.value = x.value;
      baseY.value = y.value;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) reset();
      else {
        scale.value = withTiming(2.5);
        baseScale.value = 2.5;
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector
      gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}
    >
      <View style={styles.root}>
        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          style={[styles.image, style]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  image: { width: "100%", height: "100%" },
  close: {
    position: "absolute",
    right: 12,
  },
});
