import { describe, expect, it, vi } from "vitest";
import {
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
  it("calls toast with the split title/description and default positional args", () => {
    const toast = vi.fn();
    showSplitToast(toast, "Can't fit 3 sessions\nLoosen the deadline.");
    expect(toast).toHaveBeenCalledWith(
      "Can't fit 3 sessions",
      "destructive",
      undefined,
      undefined,
      undefined,
      undefined,
      { description: "Loosen the deadline." },
    );
  });

  it("defaults to the destructive variant, honors an explicit one", () => {
    const toast = vi.fn();
    showSplitToast(toast, "Scheduled for Mon 9am", "success");
    expect(toast.mock.calls[0][1]).toBe("success");
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
    expect(toast.mock.calls[0][0]).toBe("Can't fit 3 sessions");
    expect(toast.mock.calls[0][6]).toEqual({
      description: "Loosen the deadline.",
    });
  });

  it("falls back for a non-axios error", () => {
    const toast = vi.fn();
    showErrorToast(toast, new Error("boom"), "Something went wrong");
    expect(toast.mock.calls[0][0]).toBe("Something went wrong");
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
