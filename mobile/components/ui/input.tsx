import * as React from "react";
import { TextInput, View } from "react-native";

import { NAV_THEME } from "@/lib/constants";
import { scaleType } from "@/lib/type-scale";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";

type InputProps = {
  className?: string;
  placeholderClassName?: string;
  value?: string;
  defaultValue?: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  editable?: boolean;
  autoComplete?: "name" | "email" | "username" | "password" | "off";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  multiline?: boolean;
  numberOfLines?: number;
  returnKeyType?: any;
  onSubmitEditing?: (e: any) => void;
  onFocus?: (e: any) => void;
  onBlur?: (e: any) => void;
  disabled?: boolean;
  readOnly?: boolean;
  selectTextOnFocus?: boolean;
  keyboardAppearance?: any;
  keyboardType?: any;
  style?: any;
  testID?: string;
  accessible?: boolean;
  accessibilityLabel?: string;
  "aria-invalid"?: boolean;
  rightElement?: React.ReactNode;
  /** Text-input component to render — defaults to RN `TextInput`. Sheets pass
   * `@gorhom/bottom-sheet`'s `BottomSheetTextInput` (via `BottomSheetInput`)
   * so the sheet lifts above the keyboard on focus. */
  as?: React.ComponentType<any>;
};

const Input = React.forwardRef<React.ElementRef<typeof TextInput>, InputProps>(
  (
    { className, placeholderClassName, rightElement, as, ...props },
    ref,
  ) => {
    const Component: React.ComponentType<any> = as ?? TextInput;
    const { isDarkColorScheme } = useColorScheme();
    const caret = (isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light).primary;
    const inputClassName = cn(
          "web:flex h-10 native:h-12 web:w-full rounded-xl border border-glass-edge/35 bg-glass/70 dark:border-glass-edge/25 dark:bg-glass/[0.07] px-3 web:py-2 text-base lg:text-sm native:text-[17px] native:leading-[1.25] text-foreground placeholder:text-muted-foreground web:ring-offset-background file:border-0 file:bg-transparent file:font-medium web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2",
          props.editable === false && "opacity-50 web:cursor-not-allowed",
          props["aria-invalid"] &&
            "border-destructive web:ring-[3px] web:ring-destructive/20 web:dark:ring-destructive/40",
          rightElement && "pr-10",
          className,
        );
    const { fontSize } = scaleType(inputClassName);
    const input = (
      <Component
        ref={ref}
        className={inputClassName}
        placeholderClassName={cn("text-muted-foreground", placeholderClassName)}
        style={{ fontFamily: "Geist", fontSize }}
        selectionColor={caret}
        cursorColor={caret}
        {...props}
      />
    );

    if (!rightElement) return input;

    return (
      // The wrapper, not the input, takes the width: `flex-1` on the input alone
      // left the wrapper content-sized, so the pill clipped or shrank as you typed.
      <View
        className={cn(
          "relative min-w-0",
          className?.includes("flex-1") ? "flex-1" : "w-full",
        )}
      >
        {input}
        <View className="absolute right-3 top-1/2 -translate-y-1/2">
          {rightElement}
        </View>
      </View>
    );
  },
);

Input.displayName = "Input";

export { Input };
