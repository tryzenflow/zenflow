import * as React from "react";
import { View } from "react-native";

export const FullWindowOverlay = ({ children }: { children?: React.ReactNode }) => (
  <View>{children}</View>
);
