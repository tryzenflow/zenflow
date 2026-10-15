import { describe, expect, it, vi } from "vitest";
import type { Session } from "@zenflow/shared";
import { showMovedToast } from "../move-toast";
import {
  placementToastMessage,
  shouldSurfaceRescheduleHint,
  showErrorToast,
  showSplitToast,
  splitToastMessage,
} from "../task-toasts";

describe("splitToastMessage", () => {
  it("splits on the first \\n into a title and description", () => {
    expect(splitToastMessage("Won't fit before the deadline\nPick a later deadline.")).toEqual({
      title: "Won't fit before the deadline",
      description: "Pick a later deadline.",
    });
  });

  it("returns a title only, no description, for a plain one-line message", () => {
    expect(splitToastMessage("Session updated")).toEqual({
      title: "Session updated",
    });
  });

  it("splits only on the FIRST \\n, keeping the rest in the description", () => {
    expect(splitToastMessage("Title\nLine one\nLine two")).toEqual({
      title: "Title",
      description: "Line one\nLine two",
    });
  });
});

describe("showSplitToast", () => {
  it("calls toast with the split title/description", () => {
    const toast = vi.fn();
    showSplitToast(toast, "Can't fit 3 sessions\nLoosen the deadline.");
    expect(toast).toHaveBeenCalledWith({
      title: "Can't fit 3 sessions",
      variant: "destructive",
      description: "Loosen the deadline.",
    });
  });

  it("defaults to the destructive variant, honors an explicit one", () => {
    const toast = vi.fn();
    showSplitToast(toast, "Scheduled for Mon 9am", "success");
    expect(toast.mock.calls[0][0].variant).toBe("success");
  });
});

describe("showErrorToast", () => {
  it("shows the axios response's message when present", () => {
    const toast = vi.fn();
    const error = {
      isAxiosError: true,
      response: { data: { message: "Can't fit 3 sessions\nLoosen the deadline." } },
    };
    showErrorToast(toast, error, "fallback");
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: "Can't fit 3 sessions",
      description: "Loosen the deadline.",
    });
  });

  it("falls back for a non-axios error", () => {
    const toast = vi.fn();
    showErrorToast(toast, new Error("boom"), "Something went wrong");
    expect(toast.mock.calls[0][0].title).toBe("Something went wrong");
  });
});

describe("placementToastMessage", () => {
  const user = { timezone: "UTC" };

  it("never puts the user's own title in the toast", () => {
    const { message } = placementToastMessage(
      { title: "A very long assignment title", scheduledStartTime: null } as Session,
      user,
    );
    expect(message).not.toContain("A very long assignment title");
    expect(splitToastMessage(message)).toEqual({
      title: "Task created",
      description: "No time found before its deadline.",
    });
  });

  it("puts the date and the time together in one title", () => {
    const { message } = placementToastMessage(
      {
        title: "x",
        scheduledStartTime: "2026-10-12T09:00:00.000Z",
        deadline: "2026-10-20T09:00:00.000Z",
      } as Session,
      user,
    );
    const { title, description } = splitToastMessage(message);
    expect(title).toBe("Scheduled for Mon, Oct 12, 9:00 AM");
    expect(description).toBeUndefined();
  });
});

describe("showMovedToast", () => {
  it("puts the date and the time together in the title", () => {
    const toast = vi.fn();
    showMovedToast(toast, {
      to: new Date(2026, 9, 12, 9, 0),
      withTime: true,
    });
    const arg = toast.mock.calls[0][0];
    expect(arg.title).toBe("Moved to Mon, Oct 12, 9:00 AM");
    expect(arg.description).toBeUndefined();
  });

  it("puts the date in the title when there is no time", () => {
    const toast = vi.fn();
    showMovedToast(toast, {
      to: new Date(2026, 9, 12),
      withTime: false,
    });
    const arg = toast.mock.calls[0][0];
    expect(arg.title).toBe("Moved to Mon, Oct 12");
    expect(arg.description).toBeUndefined();
  });
});

describe("shouldSurfaceRescheduleHint", () => {
  it("fires on the first save, then every 5th", () => {
    // 1st: yes. 2nd–4th: no. 5th: yes. 6th–9th: no. 10th: yes.
    const results = Array.from({ length: 12 }, () =>
      shouldSurfaceRescheduleHint(),
    );
    expect(results).toEqual([
      true, // 1
      false, // 2
      false, // 3
      false, // 4
      true, // 5
      false, // 6
      false, // 7
      false, // 8
      false, // 9
      true, // 10
      false, // 11
      false, // 12
    ]);
  });
});
