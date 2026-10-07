import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { useMotion } from "@/hooks/use-motion";
import { NAV_THEME, withAlpha } from "@/lib/constants";
import { useColorScheme } from "@/lib/useColorScheme";
import { haptic } from "@/lib/haptics";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
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
  Sparkles,
  type LucideIcon,
  X,
} from "../Icons";
import { Text } from "./text";

export interface ToastAction {
  label: string;
  onPress: () => void;
  /** Accent for this button (tinted fill + border + text) so several choices
   * on one toast read as different options, not a row of identical pills. */
  color?: { light: string; dark: string };
  inline?: boolean;
  mockup?: boolean;
}

/**
 * Per-variant chrome for the toast's icon badge — the card body itself is
 * always the neutral `bg-popover` surface from `mockups/day-view.html`'s
 * "haptic-snap toast", only the badge is tinted. `badge` is the rounded-square
 * background, `icon` its foreground (passed straight to the lucide glyph — RN
 * has no `currentColor` inheritance through `cssInterop`).
 */
const TOAST_VARIANTS: Record<
  string,
  {
    badge: string;
    icon: string;
    Icon: LucideIcon;
    confirmBtn: string;
    fillIcon?: boolean;
  }
> = {
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
    badge: "bg-primary/15",
    icon: "text-primary-text",
    Icon: Sparkles,
    confirmBtn: "bg-primary",
    fillIcon: true,
  },
} satisfies Record<
  string,
  {
    badge: string;
    icon: string;
    Icon: LucideIcon;
    confirmBtn: string;
    fillIcon?: boolean;
  }
>;

type ToastVariant = keyof typeof TOAST_VARIANTS;

/**
 * Resolved accent color per variant, as an explicit `#rrggbb` string for each
 * scheme — NativeWind's `className`→`color` interop on the lucide glyph and the
 * `bg-*` tokens on a reanimated `Animated.View` proved unreliable on native
 * (the card rendered untinted with an invisible icon), so the toast paints its
 * icon, badge tint, confirm button and progress bar straight from these instead
 * of relying on utility classes.
 */
const INFO_BLUE = { light: "#2563eb", dark: "#60a5fa" };
const VARIANT_ACCENT: Record<ToastVariant, { light: string; dark: string }> = {
  // Plain notices read as info — blue (the one accent with no theme token).
  default: INFO_BLUE,
  info: INFO_BLUE,
  // The rest come from the theme mirror, so they follow the palette.
  destructive: {
    light: NAV_THEME.light.notification,
    dark: NAV_THEME.dark.notification,
  },
  warning: { light: NAV_THEME.light.warning, dark: NAV_THEME.dark.warning },
  success: {
    light: NAV_THEME.light.successText,
    dark: NAV_THEME.dark.successText,
  },
  tip: { light: NAV_THEME.light.primaryText, dark: NAV_THEME.dark.primaryText },
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
// Errors, confirms and actionable toasts without an explicit duration stay up
// until closed or acted on; everything else dismisses after its duration.
const STACK_PEEK_LAYERS = 2;
/** How far each card behind the front one peeks out below it. */
const STACK_PEEK_PX = 7;
/** How much narrower each deeper layer is, per side. */
const STACK_INSET_PX = 10;
const EXPANDED_MAX_HEIGHT = 440;
const SWIPE_DISMISS_THRESHOLD = 72;
const SWIPE_DISMISS_VELOCITY = 600;
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
  /** Several choices on one toast (e.g. the infeasible-slot policies), shown
   * as a button row; takes precedence over `action`'s single button. */
  actions?: ToastAction[];
  confirm?: ToastConfirm;
  /** Optional second line under the message, rendered muted. When set (and
   * this isn't a confirm toast) the `message` becomes a compact title. */
  description?: string;
  /** Stop the auto-dismiss clock (the stack is expanded); restarts on resume. */
  paused?: boolean;
  /** Behind the front card of a collapsed stack: mounted (its timer keeps
   * running) but not drawn. */
  hidden?: boolean;
  /** Gap below the card. */
  spacing?: number;
  /** Where the stack sits; a swipe toward the nearest screen edge dismisses
   * (down for bottom, up for top), sideways swipes always do. */
  stackPosition?: "top" | "bottom";
}
function Toast({
  id,
  message,
  onHide,
  variant = "default",
  duration,
  showProgress = true,
  action,
  actions,
  confirm,
  description,
  paused = false,
  hidden = false,
  spacing = 10,
  stackPosition = "bottom",
}: ToastProps) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const [dragging, setDragging] = useState(false);
  const progress = useSharedValue(0);
  const dismissedRef = useRef(false);
  const motion = useMotion();

  useLanguage();
  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const meta = TOAST_VARIANTS[variant] ?? TOAST_VARIANTS.default;
  const Icon = meta.Icon;
  const accent = (VARIANT_ACCENT[variant] ?? VARIANT_ACCENT.default)[
    isDarkColorScheme ? "dark" : "light"
  ];

  const actionable = Boolean(action || actions?.length);
  const autoDismiss =
    !confirm &&
    variant !== "destructive" &&
    (duration !== undefined || !actionable);
  // Time to read a description is on top of the base duration.
  const dismissAfter = Math.max(duration ?? 3000, description ? 5000 : 0);
  // Text on an accent fill: dark ink on the light dark-mode accents, white on the deep light-mode ones.
  const onAccent = isDarkColorScheme ? palette.background : palette.card;
  const buttons = confirm
    ? []
    : (actions ?? (action && !action.inline ? [action] : []));

  const hide = useCallback(() => {
    onHide(id);
  }, [onHide, id]);

  // Shared exit path for both the auto-dismiss timer and a manual swipe —
  // `dismissedRef` guards against both firing (e.g. a swipe landing right as
  // the timer expires) so `onHide` never double-fires for the same toast.
  const dismiss = useCallback(
    (direction: 0 | 1 | -1 = 0, vertical: 0 | 1 | -1 = 0) => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      // Reduce Motion: fade out in place, no flying off the screen.
      if (direction !== 0 && !motion.reduced) {
        translateX.value = withTiming(direction * 400, {
          duration: EXIT_DURATION,
        });
      }
      if (vertical !== 0 && !motion.reduced) {
        translateY.value = withTiming(vertical * 240, {
          duration: EXIT_DURATION,
        });
      }
      opacity.value = withTiming(
        0,
        { duration: motion.duration(EXIT_DURATION) },
        (finished) => {
          if (finished) runOnJS(hide)();
        },
      );
    },
    [hide, opacity, translateX, translateY, motion],
  );

  useEffect(() => {
    opacity.value = withTiming(1, { duration: ENTRANCE_DURATION });
    if (confirm) haptic.warning();
    // Android reads the live region on the card; iOS needs an explicit announcement.
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        [message, description ?? confirm?.description]
          .filter(Boolean)
          .join(". "),
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
    // Paused while expanded or being dragged; restarts on release.
    if (paused || dragging) return;
    progress.value = withTiming(1, {
      duration: Math.max(dismissAfter - ENTRANCE_DURATION, 100),
    });
    const timer = setTimeout(() => dismiss(0), dismissAfter);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissAfter, autoDismiss, paused, dragging]);

  // Swiping a toast away dismisses it; for a confirm toast that also counts as
  // pressing Cancel.
  const handleSwipeDismiss = useCallback(
    (direction: 0 | 1 | -1, vertical: 0 | 1 | -1 = 0) => {
      if (confirm && !dismissedRef.current) confirm.onCancel?.();
      dismiss(direction, vertical);
    },
    [confirm, dismiss],
  );

  const panGesture = useMemo(() => {
    // +1 = down (bottom stack), -1 = up (top stack).
    const dir = stackPosition === "top" ? -1 : 1;
    const pan = Gesture.Pan().activeOffsetX([-10, 10]);
    // Expanded stack scrolls vertically; keep vertical swipes for the scroll.
    if (paused) pan.failOffsetY([-16, 16]);
    else pan.activeOffsetY([-10, 10]);
    return pan
      .onStart(() => {
        runOnJS(setDragging)(true);
      })
      .onUpdate((e) => {
        translateX.value = e.translationX;
        // Only follow the finger toward the dismiss edge.
        translateY.value = dir * Math.max(0, dir * e.translationY);
      })
      .onEnd((e) => {
        const pastX = Math.abs(e.translationX) > SWIPE_DISMISS_THRESHOLD;
        const towardEdge = dir * e.translationY;
        const pastY =
          towardEdge > SWIPE_DISMISS_THRESHOLD / 2 &&
          (towardEdge > SWIPE_DISMISS_THRESHOLD ||
            dir * e.velocityY > SWIPE_DISMISS_VELOCITY);
        if (pastY && !(pastX && Math.abs(e.translationX) > towardEdge)) {
          runOnJS(handleSwipeDismiss)(0, dir);
        } else if (pastX) {
          runOnJS(handleSwipeDismiss)(e.translationX > 0 ? 1 : -1);
        } else {
          translateX.value = withTiming(0, { duration: motion.duration(150) });
          translateY.value = withTiming(0, { duration: motion.duration(150) });
        }
      })
      .onFinalize(() => {
        runOnJS(setDragging)(false);
      });
  }, [handleSwipeDismiss, translateX, translateY, stackPosition, paused, motion]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      {
        translateY:
          translateY.value +
          (motion.reduced
            ? 0
            : interpolate(opacity.value, [0, 1], [14, 0], Extrapolation.CLAMP)),
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
            borderRadius: action?.mockup ? 16 : 18,
            borderWidth: 1,
            borderColor: action?.mockup
              ? withAlpha(palette.text, isDarkColorScheme ? 0.24 : 0.6)
              : palette.border,
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
        accessibilityLiveRegion={variant === "destructive" ? "assertive" : "polite"}
        accessibilityRole={variant === "destructive" ? "alert" : undefined}
      >
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <View
            style={{
              height: 30,
              width: 30,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: withAlpha(accent, 0.13),
            }}
          >
            {meta.fillIcon ? (
              <Svg width={17} height={17} viewBox="0 0 24 24">
                <Path
                  d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"
                  fill={accent}
                />
              </Svg>
            ) : (
              <Icon size={17} color={accent} />
            )}
          </View>

          <Pressable
            className="flex-1"
            accessibilityRole={action && !action.inline ? "button" : undefined}
            disabled={!action || Boolean(confirm) || Boolean(actions)}
            onPress={() => {
              if (action && !confirm && !actions) {
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
              numberOfLines={2}
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

          {action?.inline && !confirm && !actions ? (
            <Pressable
              onPress={() => {
                action.onPress();
                dismiss(0);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={{
                minHeight: 36,
                justifyContent: "center",
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 6,
                backgroundColor:
                  action.color?.[isDarkColorScheme ? "dark" : "light"] ??
                  palette.primary,
              }}
            >
              <Text
                className="text-[12.5px] font-semibold"
                style={{
                  color: action.color ? onAccent : palette.primaryForeground,
                }}
              >
                {action.label}
              </Text>
            </Pressable>
          ) : null}

          {!confirm && !action?.inline && (
            <Pressable
              onPress={() => dismiss(0)}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel={t("Dismiss notification")}
              style={{ paddingTop: 2 }}
            >
              <X size={16} color={palette.mutedForeground} />
            </Pressable>
          )}
        </View>

        {buttons.length > 0 && (
          <View
            className="mt-2.5 flex-row flex-wrap justify-end"
            style={{ gap: 8 }}
          >
            {buttons.map((b) => {
              const tint = b.color?.[isDarkColorScheme ? "dark" : "light"];
              return (
                <Pressable
                  key={b.label}
                  onPress={() => {
                    b.onPress();
                    dismiss(0);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={b.label}
                  style={{
                    minHeight: 44,
                    justifyContent: "center",
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: tint ? withAlpha(tint, 0.4) : palette.border,
                    paddingHorizontal: 14,
                    backgroundColor: tint
                      ? tint
                      : withAlpha(palette.text, isDarkColorScheme ? 0.08 : 0.05),
                  }}
                >
                  <Text
                    className="text-[13px] font-semibold"
                    style={{ color: tint ? onAccent : palette.text }}
                  >
                    {b.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {confirm && (
          <View className="mt-3 flex-row justify-end" style={{ gap: 8 }}>
            <Pressable
              onPress={() => {
                confirm.onCancel?.();
                dismiss(0);
              }}
              accessibilityRole="button"
              accessibilityLabel={confirm.cancelLabel ?? t("Cancel")}
              style={{
                minHeight: 44,
                justifyContent: "center",
                borderRadius: 999,
                borderWidth: 1,
                borderColor: palette.border,
                paddingHorizontal: 16,
              }}
            >
              <Text
                className="text-[13px] font-semibold"
                style={{ color: palette.mutedForeground }}
              >
                {confirm.cancelLabel ?? t("Cancel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                confirm.onConfirm();
                dismiss(0);
              }}
              accessibilityRole="button"
              accessibilityLabel={confirm.confirmLabel ?? t("Confirm")}
              style={{
                minHeight: 44,
                justifyContent: "center",
                borderRadius: 999,
                paddingHorizontal: 16,
                backgroundColor: accent,
              }}
            >
              <Text
                className="text-[13px] font-bold"
                style={{ color: onAccent }}
              >
                {confirm.confirmLabel ?? t("Confirm")}
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
              backgroundColor: withAlpha(accent, 0.12),
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
  useLanguage();
  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("Show all notifications")}
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
  useLanguage();
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
      <Pressable
        onPress={onToggle}
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={pill}
      >
        <Text
          className="text-[12px] font-semibold"
          style={{ color: palette.text }}
        >
          {expanded ? t("Show less") : t("{count} notifications", { count })}
        </Text>
      </Pressable>
      <Pressable
        onPress={onClearAll}
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        accessibilityRole="button"
        style={pill}
      >
        <Text
          className="text-[12px] font-semibold"
          style={{ color: palette.mutedForeground }}
        >
          {t("Clear all")}
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
  actions?: ToastAction[];
  confirm?: ToastConfirm;
  description?: string;
}
/**
 * Object form of `toast()`. Copy rule: `title` is at most 5 words, verb-first,
 * no trailing period; the explanation or next step goes in `description`.
 */
export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  position?: "top" | "bottom";
  showProgress?: boolean;
  action?: ToastAction;
  actions?: ToastAction[];
}
type ToastPositionalArgs = [
  message: string,
  variant?: ToastVariant,
  duration?: number,
  position?: "top" | "bottom",
  showProgress?: boolean,
  action?: ToastAction,
  opts?: { description?: string; actions?: ToastAction[] },
];
export interface ToastFn {
  (input: ToastInput): void;
  (...args: ToastPositionalArgs): void;
}

/** Normalise either `toast()` call shape to one object. */
export function normalizeToastArgs(
  args: [ToastInput] | ToastPositionalArgs,
): ToastInput {
  const first = args[0];
  if (typeof first === "object") return first;
  const [message, variant, duration, position, showProgress, action, opts] =
    args as ToastPositionalArgs;
  return {
    title: message,
    variant,
    duration,
    position,
    showProgress,
    action,
    description: opts?.description,
    actions: opts?.actions,
  };
}
interface ToastContextProps {
  toast: ToastFn;
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

  const toast: ToastFn = (
    ...args: [ToastInput] | ToastPositionalArgs
  ): void => {
    const {
      title,
      variant = "default",
      duration,
      position = "top",
      showProgress = true,
      action,
      actions,
      description,
    } = normalizeToastArgs(args);
    setMessages((prev) => [
      ...prev,
      {
        id: ++toastIdCounter,
        text: title,
        variant,
        duration,
        position,
        showProgress,
        action,
        actions,
        description,
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
      actions={message.actions}
      confirm={message.confirm}
      description={message.description}
      onHide={removeToast}
      paused={expanded}
      hidden={hidden}
      spacing={expanded ? 8 : 0}
      stackPosition={position}
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
