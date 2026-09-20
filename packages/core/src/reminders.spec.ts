import { describe, it, expect } from "@jest/globals";
import {
  reminderError,
  reminderLabel,
  reminderLeadLabel,
  upsertReminder,
} from "./reminders";

describe("reminder labels", () => {
  it("labels 'at start', minutes, hours, days, weeks", () => {
    expect(reminderLabel(0)).toBe("At start time");
    expect(reminderLeadLabel(15)).toBe("15 min");
    expect(reminderLabel(60)).toBe("1 hour before");
    expect(reminderLeadLabel(2880)).toBe("2 days");
    expect(reminderLeadLabel(10080)).toBe("1 week");
  });
});

describe("reminderError", () => {
  it("accepts 0 and rejects negatives / over 7 days / duplicates", () => {
    expect(reminderError(0, [])).toBeNull();
    expect(reminderError(-1, [])).not.toBeNull();
    expect(reminderError(10081, [])).not.toBeNull();
    expect(reminderError(60, [60])).not.toBeNull();
    expect(reminderError(60, [1440])).toBeNull();
  });
});

describe("upsertReminder", () => {
  it("adds sorted longest-lead first", () => {
    expect(upsertReminder([60], 1440)).toEqual([1440, 60]);
    expect(upsertReminder([60], 0)).toEqual([60, 0]);
  });
  it("edits in place, keeping order", () => {
    expect(upsertReminder([1440, 60], 30, 1440)).toEqual([60, 30]);
  });
  it("never duplicates and respects the cap", () => {
    expect(upsertReminder([1440, 60], 60, 1440)).toEqual([1440, 60]);
    expect(upsertReminder([1440, 60], 15)).toEqual([1440, 60]);
  });
});
