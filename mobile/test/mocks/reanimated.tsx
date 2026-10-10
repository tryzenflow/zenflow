import * as React from "react";
import { Text, View } from "react-native";

const passthrough = () => ({ build: () => passthrough(), duration: passthrough, delay: passthrough, springify: passthrough });
const Animated = {
  View,
  Text,
  ScrollView: View,
  createAnimatedComponent: <T,>(c: T) => c,
};
export default Animated;
export const FadeIn = passthrough();
export const FadeOut = passthrough();
export const FadeInDown = passthrough();
export const FadeOutUp = passthrough();
export const Layout = passthrough();
export const LinearTransition = passthrough();
export const Easing = { out: (f: unknown) => f, in: (f: unknown) => f, inOut: (f: unknown) => f, ease: () => 0, quad: () => 0, cubic: () => 0, bezier: () => () => 0 };
export const useSharedValue = <T,>(v: T) => React.useRef({ value: v }).current;
export const useAnimatedStyle = (fn: () => object) => fn();
export const useDerivedValue = <T,>(fn: () => T) => ({ value: fn() });
export const withTiming = <T,>(v: T) => v;
export const withSpring = <T,>(v: T) => v;
export const withDelay = <T,>(_d: number, v: T) => v;
export const runOnJS = <T extends (...a: never[]) => unknown>(f: T) => f;
export const runOnUI = <T extends (...a: never[]) => unknown>(f: T) => f;
export const interpolate = (v: number) => v;
export const cancelAnimation = () => {};
export const useReducedMotion = () => true;
export const useAnimatedProps = (fn: () => object) => fn();
export const useAnimatedReaction = () => {};
export const withRepeat = <T,>(v: T) => v;
export const withSequence = <T,>(...v: T[]) => v[0];
export const useAnimatedScrollHandler = () => () => {};
export const useAnimatedRef = () => React.useRef(null);
export const scrollTo = () => {};
export const measure = () => null;
export const Extrapolation = { CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity" };
export const ReduceMotion = { System: "system", Always: "always", Never: "never" };
export const interpolateColor = (_v: number, _input: number[], output: string[]) => output[0];
