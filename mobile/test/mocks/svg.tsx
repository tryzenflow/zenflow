import * as React from "react";

// Render SVG primitives as plain DOM svg elements.
const el = (tag: string) => {
  const C = ({ children, testID, ...rest }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement(tag, { "data-testid": testID, ...pick(rest) }, children);
  return C;
};
const pick = (p: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(p).filter(([k]) => /^(d|cx|cy|r|x|y|x1|x2|y1|y2|width|height|viewBox|fill|stroke|points|transform)$/.test(k)));

const Svg = el("svg");
export default Svg;
export const Path = el("path");
export const Circle = el("circle");
export const Rect = el("rect");
export const G = el("g");
export const Line = el("line");
export const Polyline = el("polyline");
export const Polygon = el("polygon");
export const Ellipse = el("ellipse");
export const Defs = el("defs");
export const LinearGradient = el("linearGradient");
export const RadialGradient = el("radialGradient");
export const Stop = el("stop");
export const ClipPath = el("clipPath");
export const Mask = el("mask");
export const Text = el("text");
