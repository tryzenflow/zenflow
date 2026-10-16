import { GradientFill } from "@/components/ui/gradient-fill";
import { Check } from "@/components/Icons";
import * as CheckboxPrimitive from "@/components/primitives/checkbox";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Platform } from "react-native";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "web:peer h-5 w-5 native:h-[28] native:w-[28] shrink-0 rounded-full border-[1.5px] border-primary web:ring-offset-background web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        "overflow-hidden",
        props.checked && "border-transparent",
        className,
      )}
      {...props}
    >
      {props.checked ? <GradientFill /> : null}
      <CheckboxPrimitive.Indicator
        className={cn("items-center justify-center h-full w-full")}
      >
        <Check
          size={17}
          strokeWidth={Platform.OS === "web" ? 2.5 : 3.5}
          className="text-black"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
