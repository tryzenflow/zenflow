import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/useColorScheme";
import * as Haptics from "expo-haptics";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  Lightbulb,
  type LucideIcon,
} from "../Icons";
import { Text } from "./text";

export interface ToastAction {
  label: string;
  onPress: () => void;
}

/**
 * Per-variant chrome for the toast's icon badge — the card body itself is
 * always the neutral `bg-popover` surface from `mockups/day-view.html`'s
 * "haptic-snap toast", only the badge is tinted. `badge` is the rounded-square
 * background, `icon` its foreground (passed straight to the lucide glyph — RN
 * has no `currentColor` inheritance through `cssInterop`).
 */
const TOAST_VARIANTS = {
  default: {
    badge: "bg-foreground/10",
    icon: "text-foreground",
    Icon: Info,
    confirmBtn: "bg-foreground",
  },
  destructive: {
    badge: "bg-destructive/15",
    icon: "text-destructive",
    Icon: AlertCircle,
    confirmBtn: "bg-destructive",
  },
  warning: {
    badge: "bg-amber-500/15",
    icon: "text-amber-600 dark:text-amber-400",
    Icon: AlertTriangle,
    confirmBtn: "bg-amber-600",
  },
  success: {
    badge: "bg-green-500/15",
    icon: "text-green-600 dark:text-green-400",
    Icon: CheckCircle,
    confirmBtn: "bg-green-600",
  },
  info: {
    badge: "bg-blue-500/15",
    icon: "text-blue-600 dark:text-blue-400",
    Icon: Info,
    confirmBtn: "bg-blue-600",
  },
  tip: {
    badge: "bg-orange-500/15",
    icon: "text-orange-600 dark:text-orange-400",
    Icon: Lightbulb,
    confirmBtn: "bg-orange-600",
  },
} satisfies Record<
  string,
  { badge: string; icon: string; Icon: LucideIcon; confirmBtn: string }
>;

type ToastVariant = keyof typeof TOAST_VARIANTS;

/**
 * Resolved accent color per variant, as an explicit `#rrggbb` string for each
 * scheme — NativeWind's `className`→`color` interop on the lucide glyph and the
 * `bg-*` tokens on a reanimated `Animated.View` proved unreliable on native
 * (the card rendered untinted with an invisible icon), so the toast paints its
 * icon, badge tint, confirm button and progress bar straight from these instead
 * of relying on utility classes. Amber/blue/green mirror the Tailwind 600/400
 * pairs the web toast uses.
 */
const VARIANT_ACCENT: Record<ToastVariant, { light: string; dark: string }> = {
  default: { light: "#0f0d0a", dark: "#fbfaf8" },
  destructive: { light: "#e7000b", dark: "#ff6467" },
  warning: { light: "#d97706", dark: "#fbbf24" },
  success: { light: "#059669", dark: "#34d399" },
  info: { light: "#2563eb", dark: "#60a5fa" },
  tip: { light: "#f97316", dark: "#fb923c" },
};

/** Back-compat export — was a `variant → bg` map, now just the badge tints. */
const toastVariants = Object.fromEntries(
  Object.entries(TOAST_VARIANTS).map(([k, v]) => [k, v.badge]),
) as Record<ToastVariant, string>;

/**
 * A blocking confirm rendered as a toast — the message on top, a Cancel /
 * confirm button row beneath it, no auto-dismiss, no progress bar. Used where
 * an action needs an explicit yes/no *before* it runs (e.g. dragging a session
 * past its deadline) but a full modal would be heavy-handed. Swiping the toast
 * away counts as Cancel.
 */
export interface ToastConfirm {
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional second line under the message. */
  description?: string;
}

export interface ToastConfirmOptions extends ToastConfirm {
  variant?: ToastVariant;
}

// Cap simultaneous full-size toasts so a burst of calls (e.g. dragging a
// task a few times in a row) can't pile the whole screen with cards — extra
// toasts queue and appear one at a time as visible ones dismiss, with a
// "+N more" pill hinting at what's waiting.
const MAX_VISIBLE_TOASTS = 2;
const SWIPE_DISMISS_THRESHOLD = 72;
const ENTRANCE_DURATION = 220;
const EXIT_DURATION = 180;

/**
 * Gap from the screen's bottom edge to the toast stack when `position` is
 * `"bottom"` (the default). Enough to float clear of the calendar screens'
 * floating tab-bar pill (`lib/tab-bar-metrics.ts`: ~safe-area + 12 + 58 + 12);
 * `ToastProvider` sits above the safe-area provider in the tree so it can't
 * read the real inset, and a fixed value that clears the pill on the common
 * case beats a hook that would crash at that depth. On the modal task-form
 * screens (no pill) the toast just floats a little higher — still bottom-anchored.
 */
const TOAST_BOTTOM_INSET = 110;
const TOAST_MAX_WIDTH = 480;

interface ToastProps {
  id: number;
  message: string;
  onHide: (id: number) => void;
  variant?: ToastVariant;
  duration?: number;
  showProgress?: boolean;
  action?: ToastAction;
  confirm?: ToastConfirm;
  /** Optional second line under the message, rendered muted. When set (and
   * this isn't a confirm toast) the `message` becomes a compact title. */
  description?: string;
}
function Toast({
  id,
  message,
  onHide,
  variant = "default",
  duration = 3000,
  showProgress = true,
  action,
  confirm,
  description,
}: ToastProps) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(0);
  const progress = useSharedValue(0);
  const dismissedRef = useRef(false);

  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const meta = TOAST_VARIANTS[variant] ?? TOAST_VARIANTS.default;
  const Icon = meta.Icon;
  const accent = (VARIANT_ACCENT[variant] ?? VARIANT_ACCENT.default)[
    isDarkColorScheme ? "dark" : "light"
  ];

  const hide = useCallback(() => {
    onHide(id);
  }, [onHide, id]);

  // Shared exit path for both the auto-dismiss timer and a manual swipe —
  // `dismissedRef` guards against both firing (e.g. a swipe landing right as
  // the timer expires) so `onHide` never double-fires for the same toast.
  const dismiss = useCallback(
    (direction: 0 | 1 | -1 = 0) => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      if (direction !== 0) {
        translateX.value = withTiming(direction * 400, {
          duration: EXIT_DURATION,
        });
      }
      opacity.value = withTiming(0, { duration: EXIT_DURATION }, (finished) => {
        if (finished) runOnJS(hide)();
      });
    },
    [hide, opacity, translateX],
  );

  useEffect(() => {
    opacity.value = withTiming(1, { duration: ENTRANCE_DURATION });
    // A confirm toast never auto-dismisses — it waits for a button (or a
    // swipe, which counts as cancel).
    if (confirm) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
      return;
    }
    progress.value = withTiming(1, {
      duration: Math.max(duration - ENTRANCE_DURATION, 100),
    });
    const timer = setTimeout(() => dismiss(0), duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  // Swiping a toast away dismisses it; for a confirm toast that also counts as
  // pressing Cancel.
  const handleSwipeDismiss = useCallback(
    (direction: 0 | 1 | -1) => {
      if (confirm && !dismissedRef.current) confirm.onCancel?.();
      dismiss(direction);
    },
    [confirm, dismiss],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-16, 16])
        .onUpdate((e) => {
          translateX.value = e.translationX;
        })
        .onEnd((e) => {
          if (Math.abs(e.translationX) > SWIPE_DISMISS_THRESHOLD) {
            runOnJS(handleSwipeDismiss)(e.translationX > 0 ? 1 : -1);
          } else {
            translateX.value = withTiming(0, { duration: 150 });
          }
        }),
    [handleSwipeDismiss, translateX],
  );

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      {
        translateY: interpolate(
          opacity.value,
          [0, 1],
          [14, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[
          {
            width: "100%",
            maxWidth: TOAST_MAX_WIDTH,
            alignSelf: "center",
            marginBottom: 10,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.card,
            padding: 14,
            shadowColor: "#000",
            shadowOpacity: isDarkColorScheme ? 0.45 : 0.16,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          },
          containerStyle,
        ]}
      >
        <View className="flex-row items-start" style={{ gap: 10 }}>
          <View
            style={{
              height: 30,
              width: 30,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${accent}22`,
            }}
          >
            <Icon size={17} color={accent} />
          </View>

          <View className="flex-1">
            <Text
              className={
                description ? "text-sm font-medium" : "text-sm font-semibold"
              }
              style={{ color: palette.text }}
            >
              {message}
            </Text>
            {(description ?? confirm?.description) ? (
              <Text
                className="mt-0.5 text-[12.5px]"
                style={{ color: palette.mutedForeground }}
              >
                {description ?? confirm?.description}
              </Text>
            ) : null}
          </View>

          {action && !confirm && (
            <Pressable
              onPress={() => {
                action.onPress();
                dismiss(0);
              }}
              hitSlop={8}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: palette.border,
                paddingHorizontal: 12,
                paddingVertical: 4,
              }}
            >
              <Text
                className="text-[13px] font-bold"
                style={{ color: palette.text }}
              >
                {action.label}
              </Text>
            </Pressable>
          )}
        </View>

        {confirm && (
          <View className="mt-3 flex-row justify-end" style={{ gap: 8 }}>
            <Pressable
              onPress={() => {
                confirm.onCancel?.();
                dismiss(0);
              }}
              hitSlop={8}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: palette.border,
                paddingHorizontal: 16,
                paddingVertical: 6,
              }}
            >
              <Text
                className="text-[13px] font-semibold"
                style={{ color: palette.mutedForeground }}
              >
                {confirm.cancelLabel ?? "Cancel"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                confirm.onConfirm();
                dismiss(0);
              }}
              hitSlop={8}
              style={{
                borderRadius: 999,
                paddingHorizontal: 16,
                paddingVertical: 6,
                backgroundColor: accent,
              }}
            >
              <Text className="text-[13px] font-bold" style={{ color: "#fff" }}>
                {confirm.confirmLabel ?? "Confirm"}
              </Text>
            </Pressable>
          </View>
        )}

        {showProgress && !confirm && (
          <View
            className="mt-2.5 overflow-hidden"
            style={{
              height: 2,
              borderRadius: 999,
              backgroundColor: `${accent}1f`,
            }}
          >
            <Animated.View
              style={[
                { height: "100%", borderRadius: 999, backgroundColor: accent },
                progressStyle,
              ]}
            />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

interface ToastMessage {
  id: number;
  text: string;
  variant: ToastVariant;
  duration?: number;
  position?: string;
  showProgress?: boolean;
  action?: ToastAction;
  confirm?: ToastConfirm;
  description?: string;
}
interface ToastContextProps {
  toast: (
    message: string,
    variant?: ToastVariant,
    duration?: number,
    position?: "top" | "bottom",
    showProgress?: boolean,
    action?: ToastAction,
    opts?: { description?: string },
  ) => void;
  /** Blocking yes/no rendered as a toast — resolves via its callbacks, not a
   * return value. See {@link ToastConfirmOptions}. */
  confirm: (message: string, options: ToastConfirmOptions) => void;
  removeToast: (id: number) => void;
}
const ToastContext = createContext<ToastContextProps | undefined>(undefined);

// Monotonic counter rather than `Date.now()` — two `toast()` calls in the
// same millisecond (confirmed live: two off-screen month-pager pages failing
// their fetch in the same tick, see `components/calendar/month-page.tsx`)
// used to collide on one id and make React throw a duplicate-key warning.
let toastIdCounter = 0;

// TODO: refactor to pass position to Toast instead of ToastProvider
function ToastProvider({
  children,
  position = "bottom",
}: {
  children: React.ReactNode;
  position?: "top" | "bottom";
}) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast: ToastContextProps["toast"] = (
    message: string,
    variant: ToastVariant = "default",
    duration = 3000,
    position: "top" | "bottom" = "top",
    showProgress = true,
    action?: ToastAction,
    opts?: { description?: string },
  ) => {
    setMessages((prev) => [
      ...prev,
      {
        id: ++toastIdCounter,
        text: message,
        variant,
        duration,
        position,
        showProgress,
        action,
        description: opts?.description,
      },
    ]);
  };

  const confirm: ToastContextProps["confirm"] = (message, options) => {
    const { variant = "warning", ...rest } = options;
    setMessages((prev) => [
      ...prev,
      {
        id: ++toastIdCounter,
        text: message,
        variant,
        duration: 0,
        showProgress: false,
        confirm: rest,
      },
    ]);
  };

  const removeToast = (id: number) => {
    setMessages((prev) => prev.filter((message) => message.id !== id));
  };

  // Confirm toasts jump the queue — a blocking yes/no shouldn't sit behind two
  // informational toasts (`.sort` is stable, so same-kind order is preserved).
  const ordered = [...messages].sort(
    (a, b) => (b.confirm ? 1 : 0) - (a.confirm ? 1 : 0),
  );
  const visibleMessages = ordered.slice(0, MAX_VISIBLE_TOASTS);
  const queuedCount = messages.length - visibleMessages.length;

  return (
    <ToastContext.Provider value={{ toast, confirm, removeToast }}>
      {children}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          paddingHorizontal: 16,
          alignItems: "center",
          ...(position === "top"
            ? { top: 45 }
            : { bottom: TOAST_BOTTOM_INSET }),
        }}
      >
        {visibleMessages.map((message) => (
          <Toast
            key={message.id}
            id={message.id}
            message={message.text}
            variant={message.variant}
            duration={message.duration}
            showProgress={message.showProgress}
            action={message.action}
            confirm={message.confirm}
            description={message.description}
            onHide={removeToast}
          />
        ))}
        {queuedCount > 0 && (
          <View pointerEvents="none" className="items-center">
            <View className="rounded-full bg-foreground/80 px-2.5 py-1">
              <Text className="text-[11px] font-semibold text-background">
                +{queuedCount} more
              </Text>
            </View>
          </View>
        )}
      </View>
    </ToastContext.Provider>
  );
}

function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

export { ToastProvider, ToastVariant, Toast, toastVariants, useToast };
