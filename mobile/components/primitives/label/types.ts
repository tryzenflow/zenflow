import type { NativeViewStyle } from "@/lib/native-style";

interface LabelRootProps {
  children: React.ReactNode;
  style?: NativeViewStyle;
}

interface LabelTextProps {
  /**
   * Equivalent to `id` so that the same value can be passed as `aria-labelledby` to the input element.
   */
  nativeID: string;
}

export type { LabelRootProps, LabelTextProps };
