import * as React from "react";
import { TextInput, View } from "react-native";

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
  autoComplete?: "name" | "email" | "username" | "password" | "off" | string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters" | boolean;
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
};

const Input = React.forwardRef<React.ElementRef<typeof TextInput>, InputProps>(
  ({ className, placeholderClassName, rightElement, ...props }, ref) => {
    const input = (
      <TextInput
        ref={ref}
        className={cn(
          "web:flex h-10 native:h-12 web:w-full rounded-md border border-input bg-background px-3 web:py-2 text-base lg:text-sm native:text-lg native:leading-[1.25] text-foreground placeholder:text-muted-foreground web:ring-offset-background file:border-0 file:bg-transparent file:font-medium web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2",
          props.editable === false && "opacity-50 web:cursor-not-allowed",
          props["aria-invalid"] &&
            "border-destructive web:ring-[3px] web:ring-destructive/20 web:dark:ring-destructive/40",
          rightElement && "pr-10",
          className,
        )}
        placeholderClassName={cn("text-muted-foreground", placeholderClassName)}
        style={{ fontFamily: "Geist" }}
        {...props}
      />
    );

    if (!rightElement) return input;

    return (
      <View className="relative">
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
