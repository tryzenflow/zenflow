import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CheckOffButton } from "@/components/calendar/check-off-button";
import { renderScreen } from "@/test/utils/render";

describe("CheckOffButton", () => {
  it("asks for done when the session is open", () => {
    const onToggle = vi.fn(() => true);
    renderScreen(<CheckOffButton state="open" title="Calculus" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Calculus done" }));
    expect(onToggle).toHaveBeenCalledWith("done");
  });

  it("asks for open when the session is already done", () => {
    const onToggle = vi.fn(() => true);
    renderScreen(<CheckOffButton state="done" title="Calculus" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Calculus not done" }));
    expect(onToggle).toHaveBeenCalledWith("open");
  });

  it("shows the tap at once and snaps back when the server rejects it", async () => {
    let reject!: (ok: boolean) => void;
    const onToggle = vi.fn(
      () => new Promise<boolean>((resolve) => (reject = resolve)),
    );
    renderScreen(<CheckOffButton state="open" title="Calculus" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Calculus done" }));
    // The pending state already reads as done, before the server answers.
    expect(screen.getByRole("checkbox", { name: "Mark Calculus not done" })).toBeTruthy();
    reject(false);
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Mark Calculus done" })).toBeTruthy(),
    );
  });
});
