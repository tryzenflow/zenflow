import {
  buildReminderText,
  formatLeadTime,
  normalizeReminderMinutes,
  pickReminderStart,
  planReminder,
} from "./reminder";

const now = new Date("2026-09-20T10:00:00.000Z");
const at = (mins: number) => new Date(now.getTime() + mins * 60_000);

describe("planReminder", () => {
  it("fires N minutes before start", () => {
    const p = planReminder(at(180), 60, now);
    expect(p?.fireAt).toEqual(at(120));
  });
  it("fires now when the nominal time is past but the session has not started", () => {
    const p = planReminder(at(20), 60, now);
    expect(p?.fireAt).toEqual(now);
  });
  it("skips a session that already started or starts exactly now", () => {
    expect(planReminder(at(-5), 60, now)).toBeNull();
    expect(planReminder(now, 60, now)).toBeNull();
  });
});

describe("pickReminderStart", () => {
  it("picks the earliest future candidate", () => {
    expect(pickReminderStart([at(500), at(-10), at(50)], null, now)).toEqual(
      at(50),
    );
  });
  it("skips the occurrence already fired for", () => {
    expect(pickReminderStart([at(50), at(500)], at(50), now)).toEqual(at(500));
  });
  it("returns null when nothing is upcoming", () => {
    expect(pickReminderStart([at(-1)], null, now)).toBeNull();
    expect(pickReminderStart([at(50)], at(50), now)).toBeNull();
  });
});

describe("normalizeReminderMinutes", () => {
  it("dedupes and sorts descending", () => {
    expect(normalizeReminderMinutes([15, 60, 15])).toEqual([60, 15]);
  });
});

describe("formatLeadTime", () => {
  it.each([
    [1, "1 minute"],
    [30, "30 minutes"],
    [60, "1 hour"],
    [90, "1 hour 30 minutes"],
    [120, "2 hours"],
    [1440, "1 day"],
    [2880, "2 days"],
    [1500, "1 day 1 hour"],
  ])("%i -> %s", (m, s) => expect(formatLeadTime(m)).toBe(s));
});
