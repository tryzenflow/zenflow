import * as React from "react";
import { View } from "react-native";

/**
 * Minimal gesture-handler stand-in. Gestures are inert builders, except `Tap`:
 * its `.onEnd` callback is fired when the detector's child is clicked, so tests
 * can press blocks that are gesture-driven (`fireEvent.click(...)`). Pan and
 * long-press are not simulated.
 */
type Gesture = {
  _kind: string;
  _enabled: boolean;
  _handlers: Record<string, (...args: unknown[]) => void>;
  _children: Gesture[];
};

function builder(kind: string, children: Gesture[] = []) {
  const g: Gesture = { _kind: kind, _enabled: true, _handlers: {}, _children: children };
  const proxy: object = new Proxy(g, {
    get(target, prop: string) {
      if (prop in target) return (target as never)[prop];
      return (...args: unknown[]) => {
        if (prop === "enabled") target._enabled = args[0] !== false;
        else if (typeof args[0] === "function") {
          target._handlers[prop] = args[0] as (...a: unknown[]) => void;
        }
        return proxy;
      };
    },
  });
  return proxy;
}

const kinds = ["Pan", "Tap", "LongPress", "Native", "Fling", "Pinch", "Rotation", "Hover", "Manual"];
export const Gesture: Record<string, (...args: Gesture[]) => object> = {
  Simultaneous: (...gs) => builder("composite", gs),
  Exclusive: (...gs) => builder("composite", gs),
  Race: (...gs) => builder("composite", gs),
};
for (const kind of kinds) Gesture[kind] = () => builder(kind);

function taps(g: Gesture): Gesture[] {
  if (g._kind === "Tap") return g._enabled ? [g] : [];
  return g._children.flatMap(taps);
}

export const GestureDetector = ({
  gesture,
  children,
}: {
  gesture?: object;
  children?: React.ReactNode;
}) => {
  const onClick = () => {
    if (!gesture) return;
    for (const tap of taps(gesture as Gesture)) tap._handlers.onEnd?.({}, true);
  };
  return (
    <div style={{ display: "contents" }} onClick={onClick}>
      {children}
    </div>
  );
};
export const GestureHandlerRootView = ({ children, ...rest }: { children?: React.ReactNode }) => (
  <View {...rest}>{children}</View>
);
export const ScrollView = View;
export const FlatList = View;
export const Directions = {};
export const State = {};
