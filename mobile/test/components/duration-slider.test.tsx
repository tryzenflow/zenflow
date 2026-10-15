import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DurationSlider } from "@/components/ui/duration-slider";
import { renderScreen } from "@/test/utils/render";

describe("DurationSlider", () => {
  it("shows the readout for the value", () => {
    renderScreen(
      <DurationSlider value={90} onChange={() => {}} label="Duration" testID="dur" />,
    );
    expect(screen.getByTestId("dur.value").textContent).toBe("1 h 30 min");
  });

  it("steps by one slot with the plus and minus buttons", () => {
    const onChange = vi.fn();
    renderScreen(<DurationSlider value={60} onChange={onChange} label="Duration" testID="dur" />);
    fireEvent.click(screen.getByTestId("dur.plus"));
    expect(onChange).toHaveBeenLastCalledWith(75);
    fireEvent.click(screen.getByTestId("dur.minus"));
    expect(onChange).toHaveBeenLastCalledWith(45);
  });

  it("never goes below the minimum or above the maximum", () => {
    const onChange = vi.fn();
    renderScreen(
      <DurationSlider value={15} min={15} max={30} onChange={onChange} label="Duration" testID="dur" />,
    );
    expect(screen.getByTestId("dur.minus").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByTestId("dur.plus"));
    expect(onChange).toHaveBeenLastCalledWith(30);
  });

  it("disables both steps when disabled", () => {
    renderScreen(
      <DurationSlider value={60} disabled onChange={() => {}} label="Duration" testID="dur" />,
    );
    expect(screen.getByTestId("dur.plus").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("dur.minus").getAttribute("aria-disabled")).toBe("true");
  });
});
