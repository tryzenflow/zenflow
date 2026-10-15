import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChipGroup } from "@/components/ui/chip-group";
import { FieldCard } from "@/components/ui/field-card";
import { renderScreen } from "@/test/utils/render";

const OPTIONS = [
  { value: "a", label: "Today" },
  { value: "b", label: "Tomorrow" },
  { value: "c", label: "Next week" },
] as const;

describe("ChipGroup", () => {
  it("renders each option and a Custom chip", () => {
    renderScreen(
      <ChipGroup options={[...OPTIONS]} value="a" onChange={() => {}} onCustom={() => {}} />,
    );
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(screen.getByText("Next week")).toBeTruthy();
    expect(screen.getByText("Custom")).toBeTruthy();
  });

  it("marks the chosen option as selected and reports taps", () => {
    const onChange = vi.fn();
    renderScreen(<ChipGroup options={[...OPTIONS]} value="a" onChange={onChange} testID="when" />);
    expect(screen.getByTestId("when.a").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("when.b").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByTestId("when.c"));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("clears the option highlight while Custom is active", () => {
    const onCustom = vi.fn();
    renderScreen(
      <ChipGroup
        options={[...OPTIONS]}
        value="a"
        customActive
        onChange={() => {}}
        onCustom={onCustom}
        testID="when"
      />,
    );
    fireEvent.click(screen.getByTestId("when.custom"));
    expect(onCustom).toHaveBeenCalled();
    expect(screen.getByTestId("when.a").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("when.custom").getAttribute("aria-checked")).toBe("true");
  });

  it("does not fire taps when disabled", () => {
    const onChange = vi.fn();
    renderScreen(
      <ChipGroup options={[...OPTIONS]} value={null} disabled onChange={onChange} testID="when" />,
    );
    fireEvent.click(screen.getByTestId("when.a"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FieldCard", () => {
  it("shows its label, hint and the child control", () => {
    renderScreen(
      <FieldCard label="Location" hint="Room or link">
        <span>child control</span>
      </FieldCard>,
    );
    expect(screen.getByText("Location")).toBeTruthy();
    expect(screen.getByText("Room or link")).toBeTruthy();
    expect(screen.getByText("child control")).toBeTruthy();
  });

  it("replaces the hint with a calm error line", () => {
    renderScreen(
      <FieldCard label="Deadline" hint="Pick a day" error="Pick a deadline first.">
        <span />
      </FieldCard>,
    );
    expect(screen.getByText("Pick a deadline first.")).toBeTruthy();
    expect(screen.queryByText("Pick a day")).toBeNull();
  });
});
