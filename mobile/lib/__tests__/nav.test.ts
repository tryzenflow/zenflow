import { describe, expect, it, vi } from "vitest";
import { goToCalendar, navigateOnce, resetNavLock, safeBack } from "../nav";

const fakeRouter = (canGoBack: boolean) =>
  ({
    canGoBack: vi.fn(() => canGoBack),
    back: vi.fn(),
    replace: vi.fn(),
    dismissTo: vi.fn(),
  }) as never as Parameters<typeof safeBack>[0] & {
    back: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
    dismissTo: ReturnType<typeof vi.fn>;
  };

describe("safeBack", () => {
  it("goes back when there is a screen to pop", () => {
    const r = fakeRouter(true);
    safeBack(r);
    expect(r.back).toHaveBeenCalledTimes(1);
    expect(r.replace).not.toHaveBeenCalled();
  });

  it("falls back to the calendar instead of an unhandled GO_BACK", () => {
    const r = fakeRouter(false);
    safeBack(r);
    expect(r.back).not.toHaveBeenCalled();
    expect(r.replace).toHaveBeenCalledWith("/");
  });
});

describe("goToCalendar", () => {
  it("pops to the existing calendar rather than replacing the modal", () => {
    const r = fakeRouter(true);
    goToCalendar(r, { date: "2026-10-15", flash: "s1" });
    expect(r.dismissTo).toHaveBeenCalledWith({
      pathname: "/",
      params: { date: "2026-10-15", flash: "s1" },
    });
    expect(r.replace).not.toHaveBeenCalled();
  });
});

describe("navigateOnce", () => {
  it("swallows a second navigation inside the lock window", () => {
    resetNavLock();
    const go = vi.fn();
    expect(navigateOnce(go)).toBe(true);
    expect(navigateOnce(go)).toBe(false);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("allows navigation again after the window", () => {
    vi.useFakeTimers();
    resetNavLock();
    const go = vi.fn();
    navigateOnce(go);
    vi.advanceTimersByTime(700);
    expect(navigateOnce(go)).toBe(true);
    vi.useRealTimers();
  });
});
