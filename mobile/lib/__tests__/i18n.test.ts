import { afterEach, describe, expect, it, vi } from "vitest";
import {
  format,
  formatTitle,
  getLanguage,
  locale,
  localizedDeadlineShort,
  setLanguage,
  subscribeLanguage,
  t,
} from "../i18n";

afterEach(() => setLanguage("en"));
describe("mobile language", () => {
  it("defaults to Vietnamese", async () => {
    vi.resetModules();
    const fresh = await import("../i18n");
    expect(fresh.getLanguage()).toBe("vi");
  });
  it("translates explicit copy and preserves arbitrary user content", () => {
    setLanguage("vi");
    expect(t("Settings")).toBe("Cài đặt");
    expect(t("Move {title}", { title: "Settings" })).toBe("Chuyển Settings");
    expect(t("My original note")).toBe("My original note");
    expect(locale()).toBe("vi-VN");
    setLanguage("en");
    expect(t("Settings")).toBe("Settings");
  });
  it("capitalizes standalone Vietnamese date labels", () => {
    setLanguage("vi");
    const d = new Date(2026, 9, 6);
    expect(format(d, "MMMM yyyy")).toBe("tháng 10 2026");
    expect(formatTitle(d, "MMMM yyyy")).toBe("Tháng 10 2026");
    setLanguage("en");
    expect(formatTitle(d, "MMMM yyyy")).toBe("October 2026");
  });
  it("notifies mounted display subscribers without duplicate events", () => {
    let calls = 0;
    const stop = subscribeLanguage(() => calls++);
    setLanguage("vi");
    setLanguage("vi");
    expect(calls).toBe(1);
    expect(getLanguage()).toBe("vi");
    stop();
    setLanguage("en");
    expect(calls).toBe(1);
  });
  it("formats display dates in Vietnamese and keeps API dates numeric", () => {
    setLanguage("vi");
    const day = new Date(2026, 9, 6, 17, 30);
    expect(format(day, "MMMM yyyy")).toContain("tháng 10");
    expect(format(day, "h:mm a")).toBe("17:30");
    expect(format(day, "yyyy-MM-dd")).toBe("2026-10-06");
    expect(
      localizedDeadlineShort(
        "2026-10-07T10:30:00Z",
        "Asia/Ho_Chi_Minh",
        new Date("2026-10-06T10:30:00Z"),
      ),
    ).toBe("ngày mai");
  });
  it("translates shared validation details while keeping dynamic counts", () => {
    setLanguage("vi");
    expect(
      t(
        "Not enough time for 5 sessions before this deadline\nChoose a later deadline or fewer sessions.",
      ),
    ).toContain("5 buổi");
    expect(t("Session name is required")).toBe("Vui lòng nhập tiêu đề");
  });
});
