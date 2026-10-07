import { TextClassContext } from "@/components/ui/text";
import { NAV_THEME } from "@/lib/constants";
import { haptic } from "@/lib/haptics";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { ActivityIndicator, Pressable } from "react-native";

const buttonVariants = cva(
  "group flex flex-row items-center justify-center rounded-xl web:ring-offset-background web:transition-colors web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "bg-primary web:hover:opacity-90 active:opacity-90",
        destructive: "bg-destructive web:hover:opacity-90 active:opacity-90",
        outline:
          "border border-input bg-background web:hover:bg-accent web:hover:text-accent-foreground active:bg-accent",
        secondary: "bg-secondary web:hover:opacity-80 active:opacity-80",
        ghost:
          "web:hover:bg-accent web:hover:text-accent-foreground active:bg-accent",
        link: "web:underline-offset-4 web:hover:underline web:focus:underline ",
      },
      size: {
        default: "h-10 px-4 py-2 native:h-12 native:px-5 native:py-3",
        sm: "h-9 min-h-11 px-3",
        lg: "h-11 px-8 native:h-14",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const buttonTextVariants = cva(
  "web:whitespace-nowrap text-sm native:text-base font-medium text-foreground web:transition-colors",
  {
    variants: {
      variant: {
        default: "text-primary-foreground",
        destructive: "text-destructive-foreground",
        outline: "group-active:text-accent-foreground",
        secondary:
          "text-secondary-foreground group-active:text-secondary-foreground",
        ghost: "group-active:text-accent-foreground",
        link: "text-primary-text group-active:underline",
      },
      size: {
        default: "",
        sm: "",
        lg: "native:text-lg",
        icon: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = {
  /** Spinner + disabled + announced as busy. Keep the label; say what is happening ("Saving…"). */
  loading?: boolean;
  /** Light tap on press. Defaults on for `default` and `destructive` (the primary actions). */
  haptic?: boolean;
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: any;
  testID?: string;
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: { disabled?: boolean; busy?: boolean; selected?: boolean };
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  delayLongPress?: number;
} & VariantProps<typeof buttonVariants>;

const Button = React.forwardRef<
  React.ElementRef<typeof Pressable>,
  ButtonProps
>(
  (
    {
      className,
      variant,
      size,
      loading,
      haptic: withHaptic,
      onPress,
      children,
      ...props
    },
    ref,
  ) => {
  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const spinner =
    variant === "destructive"
      ? NAV_THEME.light.card
      : !variant || variant === "default"
        ? palette.primaryForeground
        : palette.text;
  const disabled = props.disabled || loading;
  const tap = withHaptic ?? (!variant || variant === "default" || variant === "destructive");
  return (
    <TextClassContext.Provider
      value={cn(
        disabled && "web:pointer-events-none",
        buttonTextVariants({ variant, size }),
      )}
    >
      <Pressable
        className={cn(
          props.disabled && "opacity-50",
          disabled && "web:pointer-events-none",
          buttonVariants({ variant, size, className }),
        )}
        ref={ref}
        role="button"
        {...props}
        disabled={disabled}
        onPress={
          onPress
            ? () => {
                if (tap) haptic.tap();
                onPress();
              }
            : undefined
        }
        accessibilityState={{
          ...props.accessibilityState,
          disabled: !!disabled,
          busy: loading || props.accessibilityState?.busy,
        }}
      >
        {loading ? <ActivityIndicator
            size="small"
            color={spinner}
            style={{ marginRight: 8 }}
          /> : null}
        {children}
      </Pressable>
    </TextClassContext.Provider>
  );
  },
);
Button.displayName = "Button";

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
