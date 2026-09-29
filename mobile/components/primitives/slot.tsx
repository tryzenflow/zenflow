import * as React from "react";
import {
  type Image as RNImage,
  type ImageProps as RNImageProps,
  type ImageStyle as RNImageStyle,
  type Pressable as RNPressable,
  type PressableProps as RNPressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  StyleSheet,
  type Text as RNText,
  type TextProps as RNTextProps,
  type View as RNView,
  type ViewProps as RNViewProps,
} from "react-native";

const Pressable = React.forwardRef<
  React.ElementRef<typeof RNPressable>,
  RNPressableProps
>((props, forwardedRef) => {
  const { children, ...pressableSlotProps } = props;

  if (!React.isValidElement(children)) {
    console.log("Slot.Pressable - Invalid asChild element", children);
    return null;
  }

  // RN 0.88's `cloneElement<Props, RefType>` overload requires `RefType` to
  // extend `Component<Props, ...>` (a class-component instance) — no longer
  // satisfiable now that `Pressable`'s host ref is `ReactNativeElement`, not
  // a class instance. Cast the element instead so the single-generic
  // overload (props-only) applies; `children` genuinely does carry these
  // props at runtime, `isValidElement` just can't narrow that far.
  const element = (
    isTextChildren(children) ? <></> : children
  ) as React.ReactElement<React.ComponentPropsWithRef<typeof RNPressable>>;
  return React.cloneElement(element, {
    ...mergeProps(pressableSlotProps, children.props as AnyProps),
    ref: forwardedRef
      ? composeRefs(forwardedRef, (children as any).ref)
      : (children as any).ref,
  });
});

Pressable.displayName = "SlotPressable";

const View = React.forwardRef<React.ElementRef<typeof RNView>, RNViewProps>(
  (props, forwardedRef) => {
    const { children, ...viewSlotProps } = props;

    if (!React.isValidElement(children)) {
      console.log("Slot.View - Invalid asChild element", children);
      return null;
    }

    // See Slot.Pressable above for why this is a single-generic call with a
    // cast rather than the old two-generic `cloneElement<Props, RefType>`.
    const element = (
      isTextChildren(children) ? <></> : children
    ) as React.ReactElement<React.ComponentPropsWithRef<typeof RNView>>;
    return React.cloneElement(element, {
      ...mergeProps(viewSlotProps, children.props as AnyProps),
      ref: forwardedRef
        ? composeRefs(forwardedRef, (children as any).ref)
        : (children as any).ref,
    });
  },
);

View.displayName = "SlotView";

const Text = React.forwardRef<React.ElementRef<typeof RNText>, RNTextProps>(
  (props, forwardedRef) => {
    const { children, ...textSlotProps } = props;

    if (!React.isValidElement(children)) {
      console.log("Slot.Text - Invalid asChild element", children);
      return null;
    }

    // See Slot.Pressable above for why this is a single-generic call with a
    // cast rather than the old two-generic `cloneElement<Props, RefType>`.
    const element = (
      isTextChildren(children) ? <></> : children
    ) as React.ReactElement<React.ComponentPropsWithRef<typeof RNText>>;
    return React.cloneElement(element, {
      ...mergeProps(textSlotProps, children.props as AnyProps),
      ref: forwardedRef
        ? composeRefs(forwardedRef, (children as any).ref)
        : (children as any).ref,
    });
  },
);

Text.displayName = "SlotText";

// `RNImageProps` declares its own `children?: never` (native `Image` doesn't
// accept children) — intersecting it directly with `{ children?:
// React.ReactNode }` collapses the field to `never` instead of widening it,
// which then makes `children.props` below untypeable. Omit RN's `children`
// first so ours is the only declaration left standing.
type ImageSlotProps = Omit<RNImageProps, "children"> & {
  children?: React.ReactNode;
};

const Image = React.forwardRef<
  React.ElementRef<typeof RNImage>,
  ImageSlotProps
>((props, forwardedRef) => {
  const { children, ...imageSlotProps } = props;

  if (!React.isValidElement(children)) {
    console.log("Slot.Image - Invalid asChild element", children);
    return null;
  }

  // See Slot.Pressable above for why this is a single-generic call with a
  // cast rather than the old two-generic `cloneElement<Props, RefType>`.
  const element = (
    isTextChildren(children) ? <></> : children
  ) as React.ReactElement<React.ComponentPropsWithRef<typeof RNImage>>;
  return React.cloneElement(element, {
    ...mergeProps(imageSlotProps, children.props as AnyProps),
    ref: forwardedRef
      ? composeRefs(forwardedRef, (children as any).ref)
      : (children as any).ref,
  });
});

Image.displayName = "SlotImage";

export { Image, Pressable, Text, View };

// This project uses code from WorkOS/Radix Primitives.
// The code is licensed under the MIT License.
// https://github.com/radix-ui/primitives/tree/main

function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (node: T) =>
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref != null) {
        (ref as React.MutableRefObject<T>).current = node;
      }
    });
}

type AnyProps = Record<string, any>;

function mergeProps(slotProps: AnyProps, childProps: AnyProps) {
  // all child props should override
  const overrideProps = { ...childProps };

  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];

    const isHandler = /^on[A-Z]/.test(propName);
    if (isHandler) {
      // if the handler exists on both, we compose them
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args: unknown[]) => {
          childPropValue(...args);
          slotPropValue(...args);
        };
      }
      // but if it exists only on the slot, we use only this one
      else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    }
    // if it's `style`, we merge them
    else if (propName === "style") {
      overrideProps[propName] = combineStyles(slotPropValue, childPropValue);
    } else if (propName === "className") {
      overrideProps[propName] = [slotPropValue, childPropValue]
        .filter(Boolean)
        .join(" ");
    }
  }

  return { ...slotProps, ...overrideProps };
}

type PressableStyle = RNPressableProps["style"];
type ImageStyle = StyleProp<RNImageStyle>;
type Style = PressableStyle | ImageStyle;

// `StyleSheet.flatten`'s own generic constraint
// (`____DangerouslyImpreciseAnimatedStyleProp_Internal`) is RN's narrow,
// native-only style-prop union; `PressableStyle` picks up the public,
// web-widened `ViewStyle` (via Expo's `react-native-web` ambient
// augmentation of `PressableProps`, see `lib/native-style.ts`), so an array
// mixing the two no longer satisfies the constraint. This function only
// ever merges plain style objects here (never actually touches Animated
// values), so bridge through `unknown` rather than re-deriving RN's
// internal union by hand.
type FlattenableStyle = Parameters<typeof StyleSheet.flatten>[0];

function combineStyles(slotStyle?: Style, childValue?: Style) {
  if (typeof slotStyle === "function" && typeof childValue === "function") {
    return (state: PressableStateCallbackType) => {
      return StyleSheet.flatten([
        slotStyle(state),
        childValue(state),
      ] as unknown as FlattenableStyle);
    };
  }
  if (typeof slotStyle === "function") {
    return (state: PressableStateCallbackType) => {
      return childValue
        ? StyleSheet.flatten([
            slotStyle(state),
            childValue,
          ] as unknown as FlattenableStyle)
        : slotStyle(state);
    };
  }
  if (typeof childValue === "function") {
    return (state: PressableStateCallbackType) => {
      return slotStyle
        ? StyleSheet.flatten([
            slotStyle,
            childValue(state),
          ] as unknown as FlattenableStyle)
        : childValue(state);
    };
  }

  return StyleSheet.flatten(
    [slotStyle, childValue].filter(Boolean) as unknown as FlattenableStyle,
  );
}

export function isTextChildren(
  children:
    | React.ReactNode
    | ((state: PressableStateCallbackType) => React.ReactNode),
) {
  return Array.isArray(children)
    ? children.every((child) => typeof child === "string")
    : typeof children === "string";
}
