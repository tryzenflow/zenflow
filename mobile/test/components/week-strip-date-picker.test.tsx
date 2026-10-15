import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeekStripDatePicker } from "@/components/ui/week-strip-date-picker";
import { renderScreen } from "@/test/utils/render";

// 2026-10-15 is a Thursday; the Monday-first week is 2026-10-12 to 2026-10-18.
describe("WeekStripDatePicker", () => {
  it("shows seven days of the week, Monday first", () => {
    renderScreen(<WeekStripDatePicker value="2026-10-15" onChange={() => {}} testID="date" />);
    for (const d of [12, 13, 14, 15, 16, 17, 18]) {
      expect(screen.getByTestId(`date.2026-10-${d}`)).toBeTruthy();
    }
  });

  it("reports the tapped day", () => {
    const onChange = vi.fn();
    renderScreen(<WeekStripDatePicker value="2026-10-15" onChange={onChange} testID="date" />);
    fireEvent.click(screen.getByTestId("date.2026-10-17"));
    expect(onChange).toHaveBeenCalledWith("2026-10-17");
  });

  it("moves the selected day by a week with the chevrons", () => {
    const onChange = vi.fn();
    renderScreen(<WeekStripDatePicker value="2026-10-15" onChange={onChange} testID="date" />);
    fireEvent.click(screen.getByTestId("date.next"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-22");
    fireEvent.click(screen.getByTestId("date.prev"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-08");
  });

  it("disables days before the minimum date", () => {
    renderScreen(
      <WeekStripDatePicker value="2026-10-15" minDate="2026-10-14" onChange={() => {}} testID="date" />,
    );
    expect(screen.getByTestId("date.2026-10-13").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("date.2026-10-14").getAttribute("aria-disabled")).not.toBe("true");
  });
});
