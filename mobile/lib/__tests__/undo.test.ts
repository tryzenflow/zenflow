import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferCommit, UNDO_WINDOW_MS } from "../undo";

describe("deferCommit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the commit once the undo window closes", () => {
    const commit = vi.fn();
    deferCommit(commit);
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("never runs the commit when cancelled inside the window", () => {
    const commit = vi.fn();
    const cancel = deferCommit(commit);
    vi.advanceTimersByTime(UNDO_WINDOW_MS / 2);
    cancel();
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(commit).not.toHaveBeenCalled();
  });

  it("ignores a cancel that arrives after the commit ran", () => {
    const commit = vi.fn();
    const cancel = deferCommit(commit);
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(() => cancel()).not.toThrow();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("uses the undo window by default and accepts its own", () => {
    expect(UNDO_WINDOW_MS).toBe(5000);
    const commit = vi.fn();
    deferCommit(commit, 100);
    vi.advanceTimersByTime(100);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
