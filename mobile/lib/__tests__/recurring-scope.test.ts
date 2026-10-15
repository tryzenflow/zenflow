import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveUndoable, offerApplyToAll, resolveMoveScope } from "../recurring-scope";
import { UNDO_WINDOW_MS } from "../undo";

const recurring = { seriesId: "ser1", rrule: "FREQ=WEEKLY", timetableGroupId: null };
const sitting = { seriesId: "ser1", rrule: null, timetableGroupId: null };
const oneOff = { seriesId: null, rrule: null, timetableGroupId: null };
const pending = { scheduledStartTime: "2026-10-15T03:00:00.000Z", durationMinutes: 60 };

/** The toast mock's action labelled `label`, from the last call. */
function action(toast: ReturnType<typeof vi.fn>, label: string) {
  const actions = toast.mock.calls.at(-1)?.[0].actions as
    | { label: string; onPress: () => void }[]
    | undefined;
  const found = actions?.find((a) => a.label === label);
  if (!found) throw new Error(`no action ${label}`);
  return found;
}

const asSession = (fields: object) => ({ id: "x", title: "x", ...fields }) as never;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("offerApplyToAll", () => {
  it("sends this occurrence once the undo window closes", () => {
    const toast = vi.fn();
    const send = vi.fn();
    offerApplyToAll(toast as never, send);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(send).toHaveBeenCalledWith("occurrence");
  });

  it("Undo cancels the send and calls onUndo", () => {
    const toast = vi.fn();
    const send = vi.fn();
    const onUndo = vi.fn();
    offerApplyToAll(toast as never, send, onUndo);
    action(toast, "Undo").onPress();
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(send).not.toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("Apply to all sends the whole series now and cancels this occurrence", () => {
    const toast = vi.fn();
    const send = vi.fn();
    offerApplyToAll(toast as never, send);
    action(toast, "Apply to all").onPress();
    expect(send).toHaveBeenCalledWith("series");
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("resolveMoveScope", () => {
  it("resolves a one-off straight to this occurrence, with no toast or sheet", () => {
    const toast = vi.fn();
    const onResolve = vi.fn();
    const openTaskSheet = vi.fn();
    resolveMoveScope(toast as never, asSession(oneOff), pending, onResolve, openTaskSheet);
    expect(onResolve).toHaveBeenCalledWith({ scope: "occurrence", skipConflicting: false });
    expect(toast).not.toHaveBeenCalled();
    expect(openTaskSheet).not.toHaveBeenCalled();
  });

  it("moves one sitting of a multi-sitting task alone, with no sheet", () => {
    const toast = vi.fn();
    const onResolve = vi.fn();
    const openTaskSheet = vi.fn();
    resolveMoveScope(toast as never, asSession(sitting), pending, onResolve, openTaskSheet);
    expect(onResolve).toHaveBeenCalledWith({ scope: "occurrence", skipConflicting: false });
    expect(openTaskSheet).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("holds a recurring move and offers apply to all, with no sheet", () => {
    const toast = vi.fn();
    const onResolve = vi.fn();
    const openTaskSheet = vi.fn();
    resolveMoveScope(toast as never, asSession(recurring), pending, onResolve, openTaskSheet);
    expect(onResolve).not.toHaveBeenCalled();
    expect(openTaskSheet).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][0].title).toBe("Moved this occurrence");
  });

  it("resolves a recurring move to the whole series on Apply to all", () => {
    const toast = vi.fn();
    const onResolve = vi.fn();
    resolveMoveScope(toast as never, asSession(recurring), pending, onResolve, vi.fn());
    action(toast, "Apply to all").onPress();
    expect(onResolve).toHaveBeenCalledWith({ scope: "series", skipConflicting: false });
  });

  it("resolves a recurring move to null on Undo", () => {
    const toast = vi.fn();
    const onResolve = vi.fn();
    resolveMoveScope(toast as never, asSession(recurring), pending, onResolve, vi.fn());
    action(toast, "Undo").onPress();
    expect(onResolve).toHaveBeenCalledWith(null);
  });

  it("commits this occurrence when the window closes without a tap", () => {
    const toast = vi.fn();
    const onResolve = vi.fn();
    resolveMoveScope(toast as never, asSession(recurring), pending, onResolve, vi.fn());
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(onResolve).toHaveBeenCalledWith({ scope: "occurrence", skipConflicting: false });
  });
});

describe("moveUndoable", () => {
  it("is false only for a recurring occurrence moved on its own", () => {
    expect(moveUndoable(recurring, "occurrence")).toBe(false);
    expect(moveUndoable(recurring, "series")).toBe(true);
    expect(moveUndoable(sitting, "occurrence")).toBe(true);
    expect(moveUndoable(oneOff, undefined)).toBe(true);
  });
});
