import { type VariantProps, cva } from "class-variance-authority";
import { type Href, Link } from "expo-router";
import type { LinkProps } from "expo-router/build/link/Link";
import type React from "react";
import type { ElementType, ReactElement } from "react";
import {
  Pressable,
  type PressableProps,
  View,
  type ViewProps,
} from "react-native";
import { Text } from "./text";

import { Muted } from "./typography";

import { ChevronRight } from "@/components/Icons";
import { cn } from "@/lib/utils";

const listItemTextVariants = cva(
  "text-base font-normal", // base styles
  {
    variants: {
      variant: {
        default: "text-foreground",
        primary: "text-primary",
        link: "text-blue-500",
        destructive: "text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface ItemProps {
  className: string;
}

// Define props for ListItem with TypeScript interface
type ListItemProps = VariantProps<typeof listItemTextVariants> & {
  label: string;
  description?: string;
  itemLeft?: (itemProps: ItemProps) => ReactElement;
  itemRight?: (itemProps: ItemProps) => ReactElement;
  onPress?: () => void;
  /**
   * If true, a detail arrow will appear on the item.
   */
  detail?: boolean;
  /**
   * Convert the default Pressable with a Link component.
   */
  href?: Href;
  className?: string;
} & (ViewProps | PressableProps | LinkProps);

// ListItem component
const ListItem: React.FC<ListItemProps> = ({
  label,
  description,
  itemLeft,
  itemRight,
  detail = true,
  variant,
  className,
  href,
  ...props
}) => {
  // Automatically add ChevronRight if onPress is defined and detail is true
  const ItemRight = () => {
    if (itemRight) {
      return itemRight({
        className: cn("size-5 opacity-70", listItemTextVariants({ variant })),
      });
    } else if ((props?.onPress && detail) || (href && detail)) {
      return (
        <ChevronRight
          className={cn("size-5 opacity-70", listItemTextVariants({ variant }))}
        />
      );
    }
    return null;
  };
  const pressable = (props as { onPress?: unknown })?.onPress || href;
  // `Component` only ever renders as `Pressable` or `View` here — the `href`
  // case is handled separately below by wrapping `body` in a `<Link asChild>`
  // — so the element type is narrowed to just those two (dropping `LinkProps`
  // from the union) rather than requiring every render site to also supply
  // `href`.
  const Component = (pressable ? Pressable : View) as ElementType<
    ViewProps | PressableProps
  >;

  const body = (
    // `props` is still typed against the `ViewProps | PressableProps | LinkProps`
    // union from the outer `ListItemProps` intersection (`href` was destructured
    // off above, but the rest of that union's members don't collapse cleanly
    // onto the narrowed `Component` element type) — same escape hatch already
    // used for the analogous `React.cloneElement<any>` pattern in `list.tsx`.
    <Component
      className={cn(
        "flex-row items-center justify-between w-full px-4 py-3 border-b border-border bg-card",
        pressable ? "web:hover:opacity-90 active:opacity-90" : "",
        listItemTextVariants({ variant }),
        className,
      )}
      accessibilityRole={pressable ? "button" : "none"}
      accessibilityLabel={`${label}${description ? `, ${description}` : ""}`}
      {...(props as any)}
    >
      {itemLeft && (
        <View className="mr-3">
          {itemLeft({
            className: cn("text-foreground", listItemTextVariants({ variant })),
          })}
        </View>
      )}
      <View className="flex-1">
        <Text className={cn(listItemTextVariants({ variant }))}>{label}</Text>
        {description && <Muted>{description}</Muted>}
      </View>
      <ItemRight />
    </Component>
  );
  if (href) {
    return (
      <Link href={href} asChild>
        {body}
      </Link>
    );
  } else {
    return body;
  }
};

export default ListItem;
