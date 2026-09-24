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
import { Pressable, ScrollView, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
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
  X,
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
    badge: "bg-blue-500/15",
    icon: "text-blue-600 dark:text-blue-400",
    Icon: Info,
    confirmBtn: "bg-blue-600",
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
  // Plain notices read as info — blue, not the foreground ink.
  default: { light: "#2563eb", dark: "#60a5fa" },
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

// iOS-style stack: newest in front, peeking slivers behind, a pill to expand.
// Only `success` toasts auto-dismiss.
const STACK_PEEK_LAYERS = 2;
/** How far each card behind the front one peeks out below it. */
const STACK_PEEK_PX = 7;
/** How much narrower each deeper layer is, per side. */
const STACK_INSET_PX = 10;
const EXPANDED_MAX_HEIGHT = 440;
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
  /** Stop the auto-dismiss clock (the stack is expanded); restarts on resume.
   * Only a `success` toast has one — every other variant stays up until closed. */
  paused?: boolean;
  /** Behind the front card of a collapsed stack: mounted (its timer keeps
   * running) but not drawn. */
  hidden?: boolean;
  /** Gap below the card. */
  spacing?: number;
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
  paused = false,
  hidden = false,
  spacing = 10,
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

  const autoDismiss = !confirm && variant === "success";

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
    if (confirm) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only success toasts auto-dismiss.
    if (!autoDismiss) return;
    cancelAnimation(progress);
    progress.value = 0;
    // Paused while expanded; restarts on collapse.
    if (paused) return;
    progress.value = withTiming(1, {
      duration: Math.max(duration - ENTRANCE_DURATION, 100),
    });
    const timer = setTimeout(() => dismiss(0), duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, paused]);

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
            marginBottom: spacing,
            display: hidden ? "none" : "flex",
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

          <Pressable
            className="flex-1"
            disabled={!action || Boolean(confirm)}
            onPress={() => {
              if (action && !confirm) {
                action.onPress();
                dismiss(0);
              }
            }}
          >
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
          </Pressable>

          {!confirm && (
            <Pressable
              onPress={() => dismiss(0)}
              hitSlop={10}
              accessibilityLabel="Dismiss notification"
              style={{ paddingTop: 2 }}
            >
              <X size={16} color={palette.mutedForeground} />
            </Pressable>
          )}
        </View>

        {action && !confirm && (
          <View className="mt-2.5 flex-row justify-end">
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
                paddingHorizontal: 14,
                paddingVertical: 5,
                backgroundColor: isDarkColorScheme
                  ? "rgba(255, 255, 255, 0.06)"
                  : "rgba(0, 0, 0, 0.04)",
              }}
            >
              <Text
                className="text-[13px] font-semibold"
                style={{ color: palette.text }}
              >
                {action.label}
              </Text>
            </Pressable>
          </View>
        )}

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

        {showProgress && autoDismiss && (
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

/** A card-shaped sliver behind the front toast — one per hidden toast, up to
 * {@link STACK_PEEK_LAYERS}. Tapping it expands the stack. */
function StackLayer({
  depth,
  layers,
  onPress,
}: {
  depth: number;
  /** How many layers are drawn — the container reserves `layers` peeks. */
  layers: number;
  onPress: () => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Show all notifications"
      style={{
        position: "absolute",
        top: 0,
        left: STACK_INSET_PX * depth,
        right: STACK_INSET_PX * depth,
        // Layer `depth` ends `depth` peeks below the front card.
        bottom: STACK_PEEK_PX * (layers - depth),
        borderRadius: 18,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.card,
        opacity: 1 - 0.3 * depth,
        // Below the front card's elevation (10) so Android paints it behind.
        elevation: 10 - 2 * depth,
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      }}
    />
  );
}

/** "3 notifications ˅ · Clear all" above a stack of two or more. */
function StackControls({
  count,
  expanded,
  onToggle,
  onClearAll,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onClearAll: () => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const pill = {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  } as const;
  return (
    <View
      className="flex-row justify-end"
      style={{ gap: 8, marginBottom: 8 }}
      pointerEvents="box-none"
    >
      <Pressable onPress={onToggle} hitSlop={6} style={pill}>
        <Text
          className="text-[12px] font-semibold"
          style={{ color: palette.text }}
        >
          {expanded ? "Show less" : `${count} notifications`}
        </Text>
      </Pressable>
      <Pressable onPress={onClearAll} hitSlop={6} style={pill}>
        <Text
          className="text-[12px] font-semibold"
          style={{ color: palette.mutedForeground }}
        >
          Clear all
        </Text>
      </Pressable>
    </View>
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

  const [expanded, setExpanded] = useState(false);

  // Newest first; confirms always in front (stable sort).
  const ordered = [...messages]
    .reverse()
    .sort((a, b) => (b.confirm ? 1 : 0) - (a.confirm ? 1 : 0));
  const count = ordered.length;
  const peekLayers = Math.min(count - 1, STACK_PEEK_LAYERS);

  // Nothing left to expand — fall back to the collapsed stack.
  useEffect(() => {
    if (count <= 1 && expanded) setExpanded(false);
  }, [count, expanded]);

  // Confirms are decisions, not notices — "Clear all" leaves them up.
  const clearAll = () =>
    setMessages((prev) => prev.filter((message) => message.confirm));

  const renderToast = (message: ToastMessage, hidden: boolean) => (
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
      paused={expanded}
      hidden={hidden}
      spacing={expanded ? 8 : 0}
    />
  );

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
        <View
          pointerEvents="box-none"
          style={{ width: "100%", maxWidth: TOAST_MAX_WIDTH }}
        >
          {count > 1 && (
            <StackControls
              count={count}
              expanded={expanded}
              onToggle={() => setExpanded((e) => !e)}
              onClearAll={clearAll}
            />
          )}
          {expanded ? (
            <ScrollView
              style={{ maxHeight: EXPANDED_MAX_HEIGHT }}
              showsVerticalScrollIndicator={false}
            >
              {ordered.map((message) => renderToast(message, false))}
            </ScrollView>
          ) : (
            <View
              pointerEvents="box-none"
              style={{ paddingBottom: STACK_PEEK_PX * peekLayers }}
            >
              {/* Deepest layer first, so shallower ones paint over it. */}
              {Array.from({ length: peekLayers }, (_, i) => peekLayers - i).map(
                (depth) => (
                  <StackLayer
                    key={`layer-${depth}`}
                    depth={depth}
                    layers={peekLayers}
                    onPress={() => setExpanded(true)}
                  />
                ),
              )}
              {ordered.map((message, index) => renderToast(message, index > 0))}
            </View>
          )}
        </View>
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
