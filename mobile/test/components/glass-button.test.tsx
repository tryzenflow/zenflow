import { fireEvent, render, screen } from "@testing-library/react";
import { Bell } from "@/components/Icons";
import {
  GLASS_HIT_SIZE,
  GLASS_SIZE,
  GlassButton,
  GlassSegmented,
} from "@/components/ui/glass-button";
import { describe, expect, it, vi } from "vitest";

describe("GlassButton", () => {
  it("has a 44pt hit area around a 40px glass circle", () => {
    expect(GLASS_SIZE).toBe(40);
    expect(GLASS_HIT_SIZE).toBeGreaterThanOrEqual(44);
  });

  it("is labelled by its accessibilityLabel and presses through", () => {
    const onPress = vi.fn();
    render(<GlassButton icon={Bell} accessibilityLabel="Notifications" onPress={onPress} />);
    const button = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("keeps the touch target at least 44px tall and wide", () => {
    render(<GlassButton icon={Bell} accessibilityLabel="Notifications" onPress={() => {}} />);
    const style = getComputedStyle(screen.getByRole("button", { name: "Notifications" }));
    expect(parseFloat(style.minWidth)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it("does not fire when disabled", () => {
    const onPress = vi.fn();
    render(
      <GlassButton icon={Bell} accessibilityLabel="Notifications" onPress={onPress} disabled />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("renders the label as the visible text of an icon and label button", () => {
    render(
      <GlassButton icon={Bell} accessibilityLabel="Jump to today" onPress={() => {}}>
        Today
      </GlassButton>,
    );
    expect(screen.getByRole("button", { name: "Jump to today" }).textContent).toContain("Today");
  });
});

describe("GlassSegmented", () => {
  const segments = [
    { value: "view" as const, accessibilityLabel: "View", icon: Bell, testID: "seg.view" },
    { value: "edit" as const, accessibilityLabel: "Edit", icon: Bell, testID: "seg.edit" },
  ];

  it("exposes each segment as a tab and reports the tapped one", () => {
    const onValueChange = vi.fn();
    render(
      <GlassSegmented segments={segments} value="view" onValueChange={onValueChange} />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(onValueChange).toHaveBeenCalledWith("edit");
  });
});
