import { describe, expect, it } from "vitest";
import { addDaysIso, fold, parseTask } from "../task-parser";

// 2026-10-15 is a Thursday.
const ctx = { today: "2026-10-15", courses: ["Giải tích", "OOP"] };

describe("fold", () => {
  it("strips diacritics and lowercases, one character per character", () => {
    expect(fold("Giải tích")).toBe("giai tich");
    expect(fold("Đề thi")).toBe("de thi");
    expect(fold("Chủ nhật")).toHaveLength("Chủ nhật".length);
  });
});

describe("parseTask, Vietnamese", () => {
  it("parses a course, a weekday deadline and a duration", () => {
    const r = parseTask("ôn giải tích thứ 6 2h", ctx);
    expect(r.course).toBe("Giải tích");
    expect(r.deadline).toEqual({ date: "2026-10-16", source: "weekday" });
    expect(r.durationMinutes).toBe(120);
    expect(r.title).toBe("ôn giải tích");
    expect(r.kind).toBe("TASK");
  });

  it("reads a Vietnamese weekday name and a long duration", () => {
    const r = parseTask("Làm bài chủ nhật 2 tiếng", ctx);
    expect(r.deadline).toEqual({ date: "2026-10-18", source: "weekday" });
    expect(r.durationMinutes).toBe(120);
    expect(r.title).toBe("Làm bài");
  });

  it("reads thứ 2 as Monday and skips the connector", () => {
    const r = parseTask("nộp báo cáo hạn thứ 2 1h30", ctx);
    expect(r.deadline).toEqual({ date: "2026-10-19", source: "weekday" });
    expect(r.durationMinutes).toBe(90);
    expect(r.title).toBe("nộp báo cáo");
    expect(r.sessionType).toBe("ASSIGNMENT");
  });

  it("reads hôm nay and mai as the relative days", () => {
    expect(parseTask("học hôm nay 1h", ctx).deadline).toEqual({
      date: "2026-10-15",
      source: "today",
    });
    expect(parseTask("học mai 1h", ctx).deadline).toEqual({
      date: "2026-10-16",
      source: "tomorrow",
    });
  });

  it("reads minutes in Vietnamese and snaps to 15", () => {
    expect(parseTask("ôn 50 phút", ctx).durationMinutes).toBe(45);
    expect(parseTask("ôn 90p", ctx).durationMinutes).toBe(90);
  });

  it("reads a Vietnamese exam and a lecture at a time", () => {
    const exam = parseTask("ôn thi giải tích thứ 6 2h", ctx);
    expect(exam.sessionType).toBe("EXAM");
    const lecture = parseTask("lớp OOP lúc 9h", ctx);
    expect(lecture.kind).toBe("EVENT");
    expect(lecture.startTime).toBe("09:00");
    expect(lecture.sessionType).toBe("LECTURE");
  });
});

describe("parseTask, English", () => {
  it("parses a course, a weekday deadline and a duration", () => {
    const r = parseTask("OOP essay due fri 3h", ctx);
    expect(r.course).toBe("OOP");
    expect(r.deadline).toEqual({ date: "2026-10-16", source: "weekday" });
    expect(r.durationMinutes).toBe(180);
    expect(r.title).toBe("OOP essay");
    expect(r.sessionType).toBe("ASSIGNMENT");
  });

  it("reads a full weekday name and minutes", () => {
    const r = parseTask("Exam review tuesday 45 minutes", ctx);
    expect(r.deadline).toEqual({ date: "2026-10-20", source: "weekday" });
    expect(r.durationMinutes).toBe(45);
    expect(r.sessionType).toBe("EXAM");
    expect(r.title).toBe("Exam review");
  });

  it("reads hours and a half-hour fraction", () => {
    expect(parseTask("Read 1.5 hours", ctx).durationMinutes).toBe(90);
    expect(parseTask("Read 2 hours by tomorrow", ctx).deadline?.source).toBe(
      "tomorrow",
    );
  });

  it("reads a time of day as an event", () => {
    const r = parseTask("Lecture at 9am", ctx);
    expect(r.kind).toBe("EVENT");
    expect(r.startTime).toBe("09:00");
    expect(r.sessionType).toBe("LECTURE");
  });

  it("reads 1h30 as a duration, not a time", () => {
    const r = parseTask("Study 1h30", ctx);
    expect(r.startTime).toBeUndefined();
    expect(r.durationMinutes).toBe(90);
  });
});

describe("parseTask, no chips", () => {
  it("leaves the text as the title when nothing matches", () => {
    const r = parseTask("Call mom", ctx);
    expect(r.title).toBe("Call mom");
    expect(r.deadline).toBeUndefined();
    expect(r.durationMinutes).toBeUndefined();
    expect(r.course).toBeUndefined();
    expect(r.kind).toBe("TASK");
    expect(r.sessionType).toBe("TASK");
  });

  it("does not match a course name that only appears inside a word", () => {
    expect(parseTask("OOPS typo", ctx).course).toBeUndefined();
  });
});

describe("addDaysIso", () => {
  it("crosses month boundaries", () => {
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
  });
});
