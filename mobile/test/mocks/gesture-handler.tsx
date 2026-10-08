import * as React from "react";
import { View } from "react-native";

const chain: object = new Proxy(() => chain, { get: () => chain, apply: () => chain });
export const Gesture = chain;
export const GestureDetector = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const GestureHandlerRootView = ({ children, ...rest }: { children?: React.ReactNode }) => (
  <View {...rest}>{children}</View>
);
export const ScrollView = View;
export const FlatList = View;
export const Directions = {};
export const State = {};
