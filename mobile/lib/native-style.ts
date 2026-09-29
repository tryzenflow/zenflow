import type { TextStyle, ViewStyle } from "react-native";

/**
 * A handful of `ViewStyle`/`TextStyle` fields are widened to loose web-only
 * unions/`string` by Expo's own `react-native-web` ambient type augmentation
 * (`expo/types/react-native-web.d.ts`), which `declare module
 * "react-native"`-merges into the *public* `ViewStyle`/`TextStyle`
 * interfaces unconditionally, regardless of which platform a given file
 * actually targets. `position` is the common one (adds `"fixed"`/
 * `"sticky"`); `boxSizing` and `userSelect` are widened from restrictive
 * literal unions to plain `string`.
 *
 * React Native's own internal, native-only style prop types (the
 * `____ViewStyleProp_Internal`/`____TextStyleProp_Internal` family used by
 * `View`, `Pressable`, `Text`, `@gorhom/bottom-sheet`, etc. under the hood)
 * were never widened, so a value declared as the public `ViewStyle`/
 * `TextStyle` — even one that, at runtime, only ever sets native-safe values
 * for these fields — no longer structurally satisfies them (RN 0.88 + this
 * repo's TS 6 bump surfaced this; see `mobile/README.md`'s pitfalls
 * section).
 *
 * Use these narrowed aliases in place of `ViewStyle`/`TextStyle` for any
 * local style object/prop that's only ever native-safe. For the rare spot
 * that legitimately needs a web-only value (e.g. `position: "fixed"` in
 * `components/ui/bottom-sheet.tsx`, the web-only sheet shim), cast through
 * `unknown` instead of using these.
 */
type NativeOnlyFields = {
  position?: "absolute" | "relative" | "static";
  boxSizing?: "border-box" | "content-box";
  userSelect?: "auto" | "text" | "none" | "contain" | "all";
};

export type NativeViewStyle = Omit<ViewStyle, keyof NativeOnlyFields> &
  NativeOnlyFields;

export type NativeTextStyle = Omit<TextStyle, keyof NativeOnlyFields> &
  NativeOnlyFields;
