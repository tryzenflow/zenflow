import { cn } from "@/lib/utils";
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
import { AlertCircle, AlertTriangle, CheckCircle, Info } from "../Icons";
import { Text } from "./text";

export interface ToastAction {
  label: string;
  onPress: () => void;
}

const toastVariants = {
  default: "bg-foreground",
  destructive: "bg-destructive",
  success: "bg-green-500",
  info: "bg-blue-500",
};

// Cap simultaneous full-size toasts so a burst of calls (e.g. dragging a
// task a few times in a row) can't pile the whole screen with cards — extra
// toasts queue and appear one at a time as visible ones dismiss, with a
// "+N more" pill hinting at what's waiting.
const MAX_VISIBLE_TOASTS = 2;
const SWIPE_DISMISS_THRESHOLD = 72;
const ENTRANCE_DURATION = 220;
const EXIT_DURATION = 180;

interface ToastProps {
  id: number;
  message: string;
  onHide: (id: number) => void;
  variant?: keyof typeof toastVariants;
  duration?: number;
  showProgress?: boolean;
  action?: ToastAction;
}
function Toast({
  id,
  message,
  onHide,
  variant = "default",
  duration = 3000,
  showProgress = true,
  action,
}: ToastProps) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(0);
  const progress = useSharedValue(0);
  const dismissedRef = useRef(false);

  const icon = useMemo(() => {
    switch (variant) {
      case "destructive":
        return <AlertCircle className="text-white" />;
      case "success":
        return <CheckCircle className="text-white" />;
      case "info":
        return <Info className="text-white" />;
      default:
        return <AlertTriangle className="text-white" />;
    }
  }, [variant]);

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
    progress.value = withTiming(1, {
      duration: Math.max(duration - ENTRANCE_DURATION, 100),
    });
    const timer = setTimeout(() => dismiss(0), duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-16, 16])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > SWIPE_DISMISS_THRESHOLD) {
        runOnJS(dismiss)(e.translationX > 0 ? 1 : -1);
      } else {
        translateX.value = withTiming(0, { duration: 150 });
      }
    });

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      {
        translateY: interpolate(
          opacity.value,
          [0, 1],
          [-20, 0],
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
        className={`
          ${toastVariants[variant]}
          m-2 mb-1 p-4 flex flex-row items-center rounded-lg shadow-md
        `}
        style={containerStyle}
      >
        {icon}
        <Text className="flex-1 font-semibold ml-3 text-left text-background">
          {message}
        </Text>
        {action && (
          <Pressable
            onPress={() => {
              action.onPress();
              dismiss(0);
            }}
            hitSlop={8}
            className="ml-3 shrink-0 rounded-full border border-background/40 px-3 py-1"
          >
            <Text className="text-[13px] font-bold text-background">
              {action.label}
            </Text>
          </Pressable>
        )}
        {showProgress && (
          <View className="mt-2 rounded">
            <Animated.View
              className="bg-white dark:bg-black h-2 opacity-30 rounded"
              style={progressStyle}
            />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

type ToastVariant = keyof typeof toastVariants;

interface ToastMessage {
  id: number;
  text: string;
  variant: ToastVariant;
  duration?: number;
  position?: string;
  showProgress?: boolean;
  action?: ToastAction;
}
interface ToastContextProps {
  toast: (
    message: string,
    variant?: keyof typeof toastVariants,
    duration?: number,
    position?: "top" | "bottom",
    showProgress?: boolean,
    action?: ToastAction,
  ) => void;
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
  position = "top",
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
      },
    ]);
  };

  const removeToast = (id: number) => {
    setMessages((prev) => prev.filter((message) => message.id !== id));
  };

  const visibleMessages = messages.slice(0, MAX_VISIBLE_TOASTS);
  const queuedCount = messages.length - visibleMessages.length;

  return (
    <ToastContext.Provider value={{ toast, removeToast }}>
      {children}
      <View
        pointerEvents="box-none"
        className={cn("absolute left-0 right-0", {
          "top-[45px]": position === "top",
          "bottom-0": position === "bottom",
        })}
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
