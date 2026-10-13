import React from "react";
import { vi } from "vitest";

export const requestWidgetUpdate = vi.fn(async () => {});
export const registerWidgetTaskHandler = vi.fn();
export const FlexWidget = (props: any) => <div {...props} />;
export const TextWidget = (props: any) => <span {...props} />;
export const IconWidget = (props: any) => <span {...props} />;
export const ImageWidget = (props: any) => <img {...props} />;
