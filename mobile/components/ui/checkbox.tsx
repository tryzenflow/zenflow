import { Check } from "@/components/Icons";
import * as CheckboxPrimitive from "@/components/primitives/checkbox";
import * as React from "react";

import { haptic } from "@/lib/haptics";
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
        "web:peer h-5 w-5 native:h-[24] native:w-[24] shrink-0 rounded-full border-[1.5px] border-primary web:ring-offset-background web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        props.checked && "bg-primary",
        className,
      )}
      // 24pt mark, 44pt touch target.
      hitSlop={10}
      {...props}
      onCheckedChange={(next: boolean) => {
        haptic.select();
        props.onCheckedChange?.(next);
      }}
    >
      <CheckboxPrimitive.Indicator
        className={cn("items-center justify-center h-full w-full")}
      >
        <Check
          size={14}
          strokeWidth={Platform.OS === "web" ? 2.5 : 3.5}
          className="text-primary-foreground"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
