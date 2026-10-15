import {
  briefCounts,
  dndCoversDay,
  expandDayItems,
  pendingCheckIn,
  type DayItem,
  type DayRow,
  type OccurrenceStates,
  occurrenceStateKey,
} from "./day";
import { zonedToUtc } from "./time";

const HCM = "Asia/Ho_Chi_Minh";
const dayStart = zonedToUtc("2026-10-14", "00:00", HCM);
const dayEnd = zonedToUtc("2026-10-15", "00:00", HCM);
const at = (hhmm: string) => zonedToUtc("2026-10-14", hhmm, HCM);

function row(over: Partial<DayRow>): DayRow {
  return {
    id: "s1",
    title: "Databases",
    type: "LECTURE",
    scheduledStartTime: at("08:00"),
    durationMinutes: 90,
    completedAt: null,
    skipped: false,
    seriesId: null,
    series: null,
    ...over,
  };
}

const item = (over: Partial<DayItem>): DayItem => ({
  id: "x",
  title: "x",
  type: "TASK",
  start: at("09:00"),
  durationMinutes: 60,
  done: false,
  skipped: false,
  ...over,
});

describe("expandDayItems", () => {
  it("keeps plain rows that start inside the range, sorted by start", () => {
    const items = expandDayItems(
      [
        row({ id: "late", scheduledStartTime: at("14:00") }),
        row({ id: "early", scheduledStartTime: at("08:00") }),
        row({
          id: "tomorrow",
          scheduledStartTime: zonedToUtc("2026-10-15", "08:00", HCM),
        }),
      ],
      new Map(),
      dayStart,
      dayEnd,
      HCM,
    );
    expect(items.map((i) => i.id)).toEqual(["early", "late"]);
  });

  it("expands a recurring series into its occurrences and applies their state", () => {
    const series = row({
      id: "rep",
      seriesId: "ser",
      scheduledStartTime: at("08:00"),
      series: { rrule: "FREQ=DAILY", exdates: [] },
    });
    const states: OccurrenceStates = new Map([
      [
        occurrenceStateKey("ser", at("08:00")),
        { completedAt: new Date(), skipped: false },
      ],
    ]);
    const items = expandDayItems([series], states, dayStart, dayEnd, HCM);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(`ser::${at("08:00").toISOString()}`);
    expect(items[0].done).toBe(true);
    expect(items[0].skipped).toBe(false);
  });

  it("drops an excluded occurrence", () => {
    const series = row({
      id: "rep",
      seriesId: "ser",
      scheduledStartTime: at("08:00"),
      series: { rrule: "FREQ=DAILY", exdates: [at("08:00").toISOString()] },
    });
    expect(expandDayItems([series], new Map(), dayStart, dayEnd, HCM)).toEqual(
      [],
    );
  });
});

describe("briefCounts", () => {
  it("counts classes and study blocks, ignoring skipped items", () => {
    const counts = briefCounts([
      item({ type: "LECTURE", start: at("08:00") }),
      item({ type: "EXAM", start: at("10:00") }),
      item({ type: "TASK", start: at("13:00") }),
      item({ type: "ASSIGNMENT", start: at("15:00") }),
      item({ type: "TASK", start: at("16:00"), skipped: true }),
    ]);
    expect(counts.classes).toBe(2);
    expect(counts.blocks).toBe(2);
    expect(counts.first?.start).toEqual(at("08:00"));
  });

  it("has no first item for an empty day", () => {
    expect(briefCounts([])).toEqual({ classes: 0, blocks: 0, first: null });
  });
});

describe("pendingCheckIn", () => {
  it("leaves out items already done or missed", () => {
    const pending = pendingCheckIn([
      item({ id: "open" }),
      item({ id: "done", done: true }),
      item({ id: "missed", skipped: true }),
    ]);
    expect(pending.map((i) => i.id)).toEqual(["open"]);
  });
});

describe("dndCoversDay", () => {
  it("is true when a DND block overlaps the day", () => {
    const dnd = [
      item({
        start: zonedToUtc("2026-10-13", "23:00", HCM),
        durationMinutes: 120,
      }),
    ];
    expect(dndCoversDay(dnd, dayStart, dayEnd)).toBe(true);
  });

  it("is false for a block that ends exactly at midnight", () => {
    const dnd = [
      item({
        start: zonedToUtc("2026-10-13", "22:00", HCM),
        durationMinutes: 120,
      }),
    ];
    expect(dndCoversDay(dnd, dayStart, dayEnd)).toBe(false);
  });

  it("is false for a block on another day", () => {
    const dnd = [item({ start: zonedToUtc("2026-10-15", "09:00", HCM) })];
    expect(dndCoversDay(dnd, dayStart, dayEnd)).toBe(false);
  });
});
