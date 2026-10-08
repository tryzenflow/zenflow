import { describe, expect, it } from "vitest";
import { TYPE_SCALE, scaleType } from "../type-scale";

describe("scaleType", () => {
  it("scales arbitrary px sizes to the nearest half point", () => {
    expect(TYPE_SCALE).toBeGreaterThan(1);
    expect(scaleType("text-[13px]")).toEqual({ fontSize: 14 });
    expect(scaleType("text-[10.5px]")).toEqual({ fontSize: 11.5 });
    expect(scaleType("text-[11px]")).toEqual({ fontSize: 12 });
  });

  it("scales named sizes with their tailwind line height", () => {
    expect(scaleType("text-sm")).toEqual({ fontSize: 15, lineHeight: 21.5 });
    expect(scaleType("text-base")).toEqual({ fontSize: 17.5, lineHeight: 26 });
  });

  it("lets later classes win and drops the named line height", () => {
    expect(scaleType("text-base text-[13px] font-medium")).toEqual({
      fontSize: 14,
    });
  });

  it("scales explicit leading, in px and as a multiplier", () => {
    expect(scaleType("text-[11px] leading-[13px]")).toEqual({
      fontSize: 12,
      lineHeight: 14,
    });
    expect(scaleType("text-[14px] leading-normal")).toEqual({
      fontSize: 15,
      lineHeight: 22.5,
    });
  });

  it("ignores prefixed variants other than native:", () => {
    expect(scaleType("text-base lg:text-sm web:text-xs")).toEqual({
      fontSize: 17.5,
      lineHeight: 26,
    });
    expect(scaleType("text-base native:text-lg").fontSize).toBe(19.5);
  });

  it("returns nothing when no size is set", () => {
    expect(scaleType("font-bold text-foreground")).toEqual({});
    expect(scaleType(undefined)).toEqual({});
  });
});
