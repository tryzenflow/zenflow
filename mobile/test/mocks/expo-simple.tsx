import * as React from "react";
import { View } from "react-native";

export const LinearGradient = ({ children, ...rest }: { children?: React.ReactNode }) => (
  <View {...rest}>{children}</View>
);
const noop = async () => {};
export const impactAsync = noop;
export const notificationAsync = noop;
export const selectionAsync = noop;
export const ImpactFeedbackStyle = { Light: "light", Medium: "medium", Heavy: "heavy" };
export const NotificationFeedbackType = { Success: "success", Warning: "warning", Error: "error" };
export default {};
