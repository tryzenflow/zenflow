import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUndoQueue } from "../undo-queue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("undo queue", () => {
  it("commits after the delay", () => {
    const commit = vi.fn();
    const q = createUndoQueue<string>({ delayMs: 5000, commit });
    q.schedule("a", "item-a");
    vi.advanceTimersByTime(4999);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledWith("a", "item-a");
    expect(q.size()).toBe(0);
  });
  it("undo cancels the commit and returns the item", () => {
    const commit = vi.fn();
    const q = createUndoQueue<string>({ delayMs: 5000, commit });
    q.schedule("a", "item-a");
    expect(q.undo("a")).toBe("item-a");
    vi.advanceTimersByTime(10000);
    expect(commit).not.toHaveBeenCalled();
  });
  it("undo after the commit has nothing to give back", () => {
    const q = createUndoQueue<string>({ delayMs: 10, commit: () => {} });
    q.schedule("a", "item-a");
    vi.advanceTimersByTime(10);
    expect(q.undo("a")).toBeUndefined();
  });
  it("flush commits everything pending immediately, once", () => {
    const commit = vi.fn();
    const q = createUndoQueue<string>({ delayMs: 5000, commit });
    q.schedule("a", "1");
    q.schedule("b", "2");
    q.flush();
    expect(commit).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10000);
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
