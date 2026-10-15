import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineTimePicker } from "@/components/ui/timeline-time-picker";
import { renderScreen } from "@/test/utils/render";

describe("TimelineTimePicker", () => {
  it("shows the start time as HH:mm", () => {
    renderScreen(
      <TimelineTimePicker value={9 * 60 + 15} onChange={() => {}} label="Start time" testID="start" />,
    );
    expect(screen.getByTestId("start.value").textContent).toBe("09:15");
  });

  it("moves in 15 minute steps", () => {
    const onChange = vi.fn();
    renderScreen(
      <TimelineTimePicker value={9 * 60} onChange={onChange} label="Start time" testID="start" />,
    );
    fireEvent.click(screen.getByTestId("start.later"));
    expect(onChange).toHaveBeenLastCalledWith(9 * 60 + 15);
    fireEvent.click(screen.getByTestId("start.earlier"));
    expect(onChange).toHaveBeenLastCalledWith(9 * 60 - 15);
  });

  it("stops at the upper bound", () => {
    renderScreen(
      <TimelineTimePicker
        value={23 * 60 + 45}
        onChange={() => {}}
        label="Start time"
        testID="start"
      />,
    );
    expect(screen.getByTestId("start.later").getAttribute("aria-disabled")).toBe("true");
  });
});
