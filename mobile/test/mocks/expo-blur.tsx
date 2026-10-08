import * as React from "react";
import { View } from "react-native";

export const BlurView = ({ children, ...rest }: { children?: React.ReactNode }) => (
  <View {...rest}>{children}</View>
);
