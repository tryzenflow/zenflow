import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated, Pressable, View } from "react-native";
import { Text } from "./text";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, CheckCircle, Info } from "../Icons";

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
  const opacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
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

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 1,
        duration: duration - 1000,
        useNativeDriver: false,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start(() => onHide(id));
  }, [duration]);

  return (
    <Animated.View
      className={`
        ${toastVariants[variant]}
        m-2 mb-1 p-4 flex flex-row items-center rounded-lg shadow-md transform transition-all
      `}
      style={{
        opacity,
        transform: [
          {
            translateY: opacity.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, 0],
            }),
          },
        ],
      }}
    >
      {icon}
      <Text className="flex-1 font-semibold ml-3 text-left text-background">
        {message}
      </Text>
      {action && (
        <Pressable
          onPress={() => {
            action.onPress();
            onHide(id);
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
            style={{
              width: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            }}
          />
        </View>
      )}
    </Animated.View>
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
    action?: ToastAction
  ) => void;
  removeToast: (id: number) => void;
}
const ToastContext = createContext<ToastContextProps | undefined>(undefined);

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
    duration: number = 3000,
    position: "top" | "bottom" = "top",
    showProgress: boolean = true,
    action?: ToastAction
  ) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
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

  return (
    <ToastContext.Provider value={{ toast, removeToast }}>
      {children}
      <View
        className={cn("absolute left-0 right-0", {
          "top-[45px]": position === "top",
          "bottom-0": position === "bottom",
        })}
      >
        {messages.map((message) => (
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
