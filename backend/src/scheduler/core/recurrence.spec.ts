import {
  expandRrule,
  firstOccurrence,
  occurrenceId,
  parseOccurrenceId,
  rruleWithUntil,
} from "./recurrence";

const iso = (d: Date) => d.toISOString();

describe("expandRrule", () => {
  it("expands a daily rule, clipped to the window", () => {
    const dtstart = new Date("2026-06-01T09:00:00.000Z");
    const out = expandRrule(
      "FREQ=DAILY",
      dtstart,
      new Date("2026-06-03T00:00:00.000Z"),
      new Date("2026-06-06T00:00:00.000Z"),
      "UTC",
    );
    expect(out.map(iso)).toEqual([
      "2026-06-03T09:00:00.000Z",
      "2026-06-04T09:00:00.000Z",
      "2026-06-05T09:00:00.000Z",
    ]);
  });

  it("honours INTERVAL", () => {
    const dtstart = new Date("2026-06-01T09:00:00.000Z");
    const out = expandRrule(
      "FREQ=DAILY;INTERVAL=2",
      dtstart,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-08T00:00:00.000Z"),
      "UTC",
    );
    expect(out.map(iso)).toEqual([
      "2026-06-01T09:00:00.000Z",
      "2026-06-03T09:00:00.000Z",
      "2026-06-05T09:00:00.000Z",
      "2026-06-07T09:00:00.000Z",
    ]);
  });

  it("honours BYDAY on a weekly rule", () => {
    // 2026-06-01 is a Monday.
    const dtstart = new Date("2026-06-01T18:00:00.000Z");
    const out = expandRrule(
      "FREQ=WEEKLY;BYDAY=MO,WE",
      dtstart,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-11T00:00:00.000Z"),
      "UTC",
    );
    expect(out.map(iso)).toEqual([
      "2026-06-01T18:00:00.000Z",
      "2026-06-03T18:00:00.000Z",
      "2026-06-08T18:00:00.000Z",
      "2026-06-10T18:00:00.000Z",
    ]);
  });

  it("honours UNTIL", () => {
    const dtstart = new Date("2026-06-01T09:00:00.000Z");
    const out = expandRrule(
      "FREQ=DAILY;UNTIL=20260603T090000Z",
      dtstart,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-30T00:00:00.000Z"),
      "UTC",
    );
    expect(out.map(iso)).toEqual([
      "2026-06-01T09:00:00.000Z",
      "2026-06-02T09:00:00.000Z",
      "2026-06-03T09:00:00.000Z",
    ]);
  });

  it("drops occurrences listed in exdates", () => {
    const dtstart = new Date("2026-06-01T09:00:00.000Z");
    const out = expandRrule(
      "FREQ=DAILY",
      dtstart,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-05T00:00:00.000Z"),
      "UTC",
      ["2026-06-02T09:00:00.000Z", "2026-06-04T09:00:00.000Z"],
    );
    expect(out.map(iso)).toEqual([
      "2026-06-01T09:00:00.000Z",
      "2026-06-03T09:00:00.000Z",
    ]);
  });

  it("can exclude the very first (anchor) occurrence via exdates", () => {
    const dtstart = new Date("2026-06-01T09:00:00.000Z");
    const out = expandRrule(
      "FREQ=DAILY",
      dtstart,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-04T00:00:00.000Z"),
      "UTC",
      ["2026-06-01T09:00:00.000Z"],
    );
    expect(out.map(iso)).toEqual([
      "2026-06-02T09:00:00.000Z",
      "2026-06-03T09:00:00.000Z",
    ]);
  });

  it("returns nothing when dtstart is after the window", () => {
    const dtstart = new Date("2026-07-01T09:00:00.000Z");
    const out = expandRrule(
      "FREQ=DAILY",
      dtstart,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-10T00:00:00.000Z"),
      "UTC",
    );
    expect(out).toEqual([]);
  });

  it("keeps a fixed wall-clock time across a DST change", () => {
    // Europe/London: BST→GMT on 2026-10-25. A weekly 09:00 local block must
    // stay at 09:00 local — i.e. the UTC instant shifts by an hour.
    const dtstart = new Date("2026-10-19T08:00:00.000Z"); // 09:00 BST, a Monday
    const out = expandRrule(
      "FREQ=WEEKLY;BYDAY=MO",
      dtstart,
      new Date("2026-10-19T00:00:00.000Z"),
      new Date("2026-11-03T00:00:00.000Z"),
      "Europe/London",
    );
    const asLondonHour = out.map((d) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        hour12: false,
      }).format(d),
    );
    expect(asLondonHour.every((h) => h === "09")).toBe(true);
    // The last occurrence (after the clocks went back) is 09:00 GMT.
    expect(iso(out[out.length - 1])).toBe("2026-11-02T09:00:00.000Z");
  });
});

describe("occurrenceId / parseOccurrenceId", () => {
  it("round-trips a series id + instant", () => {
    const start = new Date("2026-09-03T09:00:00.000Z");
    const id = occurrenceId("abc-123", start);
    expect(id).toBe("abc-123::2026-09-03T09:00:00.000Z");
    expect(parseOccurrenceId(id)).toEqual({
      seriesId: "abc-123",
      startISO: "2026-09-03T09:00:00.000Z",
    });
  });

  it("returns null for a plain uuid (no separator)", () => {
    expect(
      parseOccurrenceId("9f8b1c2d-0000-4444-8888-000000000000"),
    ).toBeNull();
  });

  it("returns null when the instant isn't a strict ISO string", () => {
    expect(parseOccurrenceId("abc-123::not-a-date")).toBeNull();
    expect(parseOccurrenceId("abc-123::2026-09-03")).toBeNull();
  });
});

describe("rruleWithUntil", () => {
  it("appends UNTIL in RFC UTC form", () => {
    expect(
      rruleWithUntil(
        "FREQ=WEEKLY;BYDAY=MO",
        new Date("2026-10-05T08:59:59.000Z"),
      ),
    ).toBe("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261005T085959Z");
  });

  it("replaces an existing UNTIL / COUNT bound", () => {
    expect(
      rruleWithUntil(
        "FREQ=DAILY;UNTIL=20270101T000000Z",
        new Date("2026-06-10T09:00:00.000Z"),
      ),
    ).toBe("FREQ=DAILY;UNTIL=20260610T090000Z");
    expect(
      rruleWithUntil(
        "FREQ=DAILY;COUNT=20",
        new Date("2026-06-10T09:00:00.000Z"),
      ),
    ).toBe("FREQ=DAILY;UNTIL=20260610T090000Z");
  });

  it("the truncated rule stops expanding at UNTIL", () => {
    const dtstart = new Date("2026-06-01T09:00:00.000Z");
    const truncated = rruleWithUntil(
      "FREQ=DAILY",
      new Date("2026-06-03T08:59:59.000Z"),
    );
    const out = expandRrule(
      truncated,
      dtstart,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-30T00:00:00.000Z"),
      "UTC",
    );
    expect(out.map(iso)).toEqual([
      "2026-06-01T09:00:00.000Z",
      "2026-06-02T09:00:00.000Z",
    ]);
  });
});

describe("firstOccurrence", () => {
  it("returns the anchor itself when it lands on the rule", () => {
    const anchor = new Date("2026-06-01T09:00:00.000Z"); // Monday
    expect(iso(firstOccurrence("FREQ=WEEKLY;BYDAY=MO", anchor, "UTC"))).toBe(
      "2026-06-01T09:00:00.000Z",
    );
  });

  it("rolls forward to the next matching day", () => {
    const anchor = new Date("2026-06-02T09:00:00.000Z"); // Tuesday
    expect(iso(firstOccurrence("FREQ=WEEKLY;BYDAY=MO", anchor, "UTC"))).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });
});
