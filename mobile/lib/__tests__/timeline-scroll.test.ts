import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTimelineScrollFraction,
  resetTimelineScroll,
  setTimelineScrollFraction,
  subscribeTimelineScroll,
} from "../timeline-scroll";

beforeEach(() => {
  resetTimelineScroll();
});

describe("timeline-scroll store", () => {
  it("starts empty", () => {
    expect(getTimelineScrollFraction()).toBeNull();
  });

  it("records a fraction", () => {
    setTimelineScrollFraction(0.42);
    expect(getTimelineScrollFraction()).toBeCloseTo(0.42);
  });

  it("clamps to [0, 1]", () => {
    setTimelineScrollFraction(-3);
    expect(getTimelineScrollFraction()).toBe(0);
    setTimelineScrollFraction(9);
    expect(getTimelineScrollFraction()).toBe(1);
  });

  it("notifies subscribers on a real change", () => {
    const spy = vi.fn();
    subscribeTimelineScroll(spy);
    setTimelineScrollFraction(0.5);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignores sub-epsilon churn (no notify, no loop)", () => {
    setTimelineScrollFraction(0.5);
    const spy = vi.fn();
    subscribeTimelineScroll(spy);
    setTimelineScrollFraction(0.5001);
    expect(spy).not.toHaveBeenCalled();
    expect(getTimelineScrollFraction()).toBeCloseTo(0.5);
  });

  it("can seed without notifying (cold-open path)", () => {
    const spy = vi.fn();
    subscribeTimelineScroll(spy);
    setTimelineScrollFraction(0.3, false);
    expect(spy).not.toHaveBeenCalled();
    expect(getTimelineScrollFraction()).toBeCloseTo(0.3);
  });

  it("stops notifying after unsubscribe", () => {
    const spy = vi.fn();
    const unsub = subscribeTimelineScroll(spy);
    unsub();
    setTimelineScrollFraction(0.7);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reset clears the value", () => {
    setTimelineScrollFraction(0.6);
    resetTimelineScroll();
    expect(getTimelineScrollFraction()).toBeNull();
  });
});
