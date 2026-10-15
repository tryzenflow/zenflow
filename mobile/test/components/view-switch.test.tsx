import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewSwitch } from "@/components/calendar/view-switch";
import { renderScreen } from "@/test/utils/render";

describe("ViewSwitch", () => {
  it("offers Day, Week and Month, with the current view selected", () => {
    renderScreen(<ViewSwitch value="week" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Day" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Week" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Month" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("tab", { name: "List" })).toBeNull();
  });

  it("reports the tapped view", () => {
    const onChange = vi.fn();
    renderScreen(<ViewSwitch value="day" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });

  it("does not report the view that is already selected", () => {
    const onChange = vi.fn();
    renderScreen(<ViewSwitch value="day" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Day" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
