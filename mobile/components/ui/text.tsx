import * as Slot from "@/components/primitives/slot";
import type {
  SlottableTextProps,
  TextRef,
} from "@/components/primitives/types";
import { cn } from "@/lib/utils";
import * as React from "react";
import { Text as RNText } from "react-native";

const FONT_WEIGHT_REGEX = /font-(regular|medium|semibold|bold|extrabold)/;

// Tailwind's default `font-mono` is a CSS font *stack* ("ui-monospace,
// SFMono-Regular, Menlo, …"), which native `fontFamily` can't parse, so
// `font-mono` has to be mapped to a single loaded family — the same way the
// weight utilities are below. Without this it was a silent no-op app-wide:
// the `style={{ fontFamily }}` below always won over whatever NativeWind
// derived from the class, so every `font-mono` call site (Day View's task
// times, the Month sheet) rendered in Geist Sans.
// Registered in `app/_layout.tsx`'s `useFonts`.
const MONO_FONT_FAMILY = "GeistMono";
const MONO_MEDIUM_FONT_FAMILY = "GeistMono-Medium";

const TextClassContext = React.createContext<string | undefined>(undefined);

// Resolves a Tailwind font-weight utility (e.g. "font-medium") to the actual
// Geist font file name, since native has no synthetic font-weight — every
// weight needs its own loaded font family. Exported so components that can't
// render through `Text` itself (e.g. `Animated.Text` from
// react-native-reanimated, which needs the raw RN component to accept
// animated styles) can still apply the correct Geist weight.
function resolveGeistFontFamily(className?: string) {
  if (!className) return "Geist";
  const classes = className.split(/\s+/);
  const fontWeightClass = classes.find((c) => c.match(FONT_WEIGHT_REGEX));
  if (classes.includes("font-mono")) {
    // Only two mono weights are loaded; anything at medium or above rounds to
    // the medium cut rather than falling back to a synthetic (i.e. ignored)
    // weight.
    return fontWeightClass && fontWeightClass !== "font-regular"
      ? MONO_MEDIUM_FONT_FAMILY
      : MONO_FONT_FAMILY;
  }
  if (!fontWeightClass) return "Geist";
  const fontWeight = fontWeightClass.split("-")[1];
  let weight = "Geist";
  if (fontWeight === "medium") weight += "-Medium";
  if (fontWeight === "semibold") weight += "-SemiBold";
  if (fontWeight === "bold") weight += "-Bold";
  if (fontWeight === "extrabold") weight += "-ExtraBold";

  return weight;
}

// Companion to resolveGeistFontFamily: strips the font-weight utility so it
// isn't left for NativeWind to also turn into a (wrong, synthetic) fontWeight.
function stripFontWeightClass(className?: string) {
  return className
    ?.split(/\s+/)
    .filter((c) => !c.match(FONT_WEIGHT_REGEX))
    .join(" ");
}

const Text = React.forwardRef<TextRef, SlottableTextProps>(
  ({ className, asChild = false, style, ...props }, ref) => {
    const textClass = React.useContext(TextClassContext);
    const Component = asChild ? Slot.Text : RNText;

    const classNameFont = React.useMemo(
      () => resolveGeistFontFamily(className),
      [className],
    );

    const classNameWithoutFontWeight = React.useMemo(
      () => stripFontWeightClass(className),
      [className],
    );

    return (
      <Component
        className={cn(
          "text-base text-foreground web:select-text",
          textClass,
          classNameWithoutFontWeight,
        )}
        style={[{ fontFamily: classNameFont }, style]}
        ref={ref}
        {...props}
      />
    );
  },
);
Text.displayName = "Text";

export { resolveGeistFontFamily, stripFontWeightClass, Text, TextClassContext };
