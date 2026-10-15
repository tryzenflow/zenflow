import {
  addDays,
  dayBounds,
  duePushes,
  isHhmm,
  localDateKey,
  localTimeKey,
  zonedToUtc,
} from "./time";

const HCM = "Asia/Ho_Chi_Minh";
const NY = "America/New_York";

describe("isHhmm", () => {
  it("accepts 24-hour HH:mm", () => {
    expect(isHhmm("07:00")).toBe(true);
    expect(isHhmm("23:59")).toBe(true);
    expect(isHhmm("00:00")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isHhmm("24:00")).toBe(false);
    expect(isHhmm("7:00")).toBe(false);
    expect(isHhmm("07:60")).toBe(false);
    expect(isHhmm("07:00:00")).toBe(false);
  });
});

describe("date arithmetic", () => {
  it("shifts across month and year boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("reads the local calendar day of an instant", () => {
    // 18:00 UTC is 01:00 the next day in Vietnam (UTC+7).
    expect(localDateKey(new Date("2026-10-13T18:00:00Z"), HCM)).toBe(
      "2026-10-14",
    );
  });

  it("reads the local wall-clock time of an instant", () => {
    expect(localTimeKey(new Date("2026-10-14T00:00:00Z"), HCM)).toBe("07:00");
  });
});

describe("zonedToUtc", () => {
  it("converts a fixed-offset zone", () => {
    expect(zonedToUtc("2026-10-14", "07:00", HCM).toISOString()).toBe(
      "2026-10-14T00:00:00.000Z",
    );
  });

  it("keeps the wall clock across the spring-forward change", () => {
    // DST starts 2026-03-08 in New York: 08:00 is EST before, EDT after.
    expect(zonedToUtc("2026-03-07", "08:00", NY).toISOString()).toBe(
      "2026-03-07T13:00:00.000Z",
    );
    expect(zonedToUtc("2026-03-08", "08:00", NY).toISOString()).toBe(
      "2026-03-08T12:00:00.000Z",
    );
  });

  it("keeps the wall clock across the fall-back change", () => {
    // DST ends 2026-11-01 in New York.
    expect(zonedToUtc("2026-10-31", "08:00", NY).toISOString()).toBe(
      "2026-10-31T12:00:00.000Z",
    );
    expect(zonedToUtc("2026-11-01", "08:00", NY).toISOString()).toBe(
      "2026-11-01T13:00:00.000Z",
    );
  });

  it("resolves a time in the spring-forward gap to the first instant after it", () => {
    // 02:30 does not exist on 2026-03-08 in New York.
    expect(zonedToUtc("2026-03-08", "02:30", NY).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });
});

describe("dayBounds", () => {
  it("is 24 hours on a normal day", () => {
    const { start, end } = dayBounds("2026-10-14", HCM);
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000);
  });

  it("is 23 hours on the spring-forward day", () => {
    const { start, end } = dayBounds("2026-03-08", NY);
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });
});

describe("duePushes", () => {
  const settings = { morningBriefTime: "07:00", eveningCheckinTime: null };

  it("is due for the minutes after the fire time", () => {
    const now = zonedToUtc("2026-10-14", "07:30", HCM);
    expect(duePushes(now, HCM, settings)).toEqual([
      {
        kind: "morning",
        localDate: "2026-10-14",
        fireAt: zonedToUtc("2026-10-14", "07:00", HCM),
      },
    ]);
  });

  it("is not due before the fire time", () => {
    const now = zonedToUtc("2026-10-14", "06:59", HCM);
    expect(duePushes(now, HCM, settings)).toEqual([]);
  });

  it("stops being due after the 60-minute window", () => {
    const now = zonedToUtc("2026-10-14", "08:00", HCM);
    expect(duePushes(now, HCM, settings)).toEqual([]);
  });

  it("sends nothing for a push that is off", () => {
    const now = zonedToUtc("2026-10-14", "07:30", HCM);
    expect(
      duePushes(now, HCM, { morningBriefTime: null, eveningCheckinTime: null }),
    ).toEqual([]);
  });

  it("catches an evening push that fired just before local midnight", () => {
    const now = zonedToUtc("2026-10-15", "00:10", HCM);
    const due = duePushes(now, HCM, {
      morningBriefTime: null,
      eveningCheckinTime: "23:30",
    });
    expect(due.map((d) => [d.kind, d.localDate])).toEqual([
      ["evening", "2026-10-14"],
    ]);
  });

  it("uses each zone's own clock for the same instant", () => {
    const now = new Date("2026-10-14T00:30:00Z");
    // 07:30 in Vietnam, 20:30 the previous evening in New York (EDT).
    expect(
      duePushes(now, HCM, {
        morningBriefTime: "07:00",
        eveningCheckinTime: null,
      }).map((d) => d.localDate),
    ).toEqual(["2026-10-14"]);
    expect(
      duePushes(now, NY, {
        morningBriefTime: null,
        eveningCheckinTime: "20:00",
      }).map((d) => d.localDate),
    ).toEqual(["2026-10-13"]);
  });
});
