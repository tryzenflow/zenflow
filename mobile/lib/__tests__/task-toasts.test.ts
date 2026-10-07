import { describe, expect, it, vi } from "vitest";
import {
  getSlotTakenError,
  shouldSurfaceRescheduleHint,
  showBulkPickToast,
  showErrorToast,
  showSeriesAlternativesPrompt,
  showSlotTakenToast,
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

describe("getSlotTakenError", () => {
  const axiosErr = (status: number, data: unknown) => ({
    isAxiosError: true,
    response: { status, data },
  });

  it("returns the body on a 409 SLOT_TAKEN", () => {
    const body = {
      success: false,
      statusCode: 409,
      message: "That alternative time now overlaps another sitting of this task.",
      code: "SLOT_TAKEN",
    };
    expect(getSlotTakenError(axiosErr(409, body))).toEqual(body);
  });

  it("ignores a 409 carrying a different code, e.g. SCHEDULE_INFEASIBLE", () => {
    expect(
      getSlotTakenError(axiosErr(409, { code: "SCHEDULE_INFEASIBLE" })),
    ).toBeNull();
  });

  it("ignores a non-409 even with the right code", () => {
    expect(getSlotTakenError(axiosErr(500, { code: "SLOT_TAKEN" }))).toBeNull();
  });

  it("ignores a non-axios error", () => {
    expect(getSlotTakenError(new Error("boom"))).toBeNull();
  });
});

describe("showSeriesAlternativesPrompt", () => {
  it("is a persistent tip toast carrying a View action", () => {
    const toast = vi.fn();
    const onView = vi.fn();
    showSeriesAlternativesPrompt(toast, 3, 5, onView);
    const { title, variant, persistent, position, action, description } =
      toast.mock.calls[0][0];
    expect(title).toBe("3 sittings have an alternative");
    expect(variant).toBe("tip");
    // Every other toast fades once its time in front is up.
    expect(persistent).toBe(true);
    expect(position).toBe("bottom");
    expect(action.label).toBe("View");
    action.onPress();
    expect(onView).toHaveBeenCalled();
    expect(description).toContain("All 5 are already scheduled");
  });

  it("uses singular copy for a single divergent sitting", () => {
    const toast = vi.fn();
    showSeriesAlternativesPrompt(toast, 1, 1, vi.fn());
    expect(toast.mock.calls[0][0].title).toBe("1 sitting has an alternative");
    expect(toast.mock.calls[0][0].description).toContain("All 1 are");
  });
});

describe("showSlotTakenToast", () => {
  it("is destructive and states that nothing moved", () => {
    const toast = vi.fn();
    showSlotTakenToast(toast);
    const { title, variant, description } = toast.mock.calls[0][0];
    expect(title).toBe("That time was just taken");
    expect(variant).toBe("destructive");
    expect(description).toContain("Nothing moved");
  });
});

describe("showBulkPickToast", () => {
  it("is a plain success when nothing failed", () => {
    const toast = vi.fn();
    showBulkPickToast(toast, 3, 0);
    const { title, variant } = toast.mock.calls[0][0];
    expect(title).toBe("Updated 3 sittings");
    expect(variant).toBe("success");
  });

  it("warns and names the failure count on a partial pass", () => {
    const toast = vi.fn();
    showBulkPickToast(toast, 2, 1);
    const { title, variant, description } = toast.mock.calls[0][0];
    expect(title).toBe("Updated 2, skipped 1");
    expect(variant).toBe("warning");
    expect(description).toContain("stayed put");
  });
});