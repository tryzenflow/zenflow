import {
  NO_SERIES_SITTING_PROPOSAL,
  courseKeyOf,
  placementReasonOf,
  toSeriesSessionDto,
} from "./session-mapper";
import type { SessionRow } from "./types/session-row";

const START = new Date("2026-06-11T08:00:00.000Z");
const ALT = new Date("2026-06-11T10:00:00.000Z");

const row = (over: Partial<SessionRow> = {}): SessionRow =>
  ({
    id: "s1",
    title: "Essay",
    note: null,
    location: null,
    durationMinutes: 60,
    deadline: new Date("2026-06-20T00:00:00.000Z"),
    type: "TASK",
    source: "USER",
    tags: [],
    scheduledStartTime: START,
    seriesId: "series-1",
    series: null,
    scheduleStudyUnitId: null,
    sessionIndex: 1,
    sessionTotal: 3,
    reminders: [],
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...over,
  }) as unknown as SessionRow;

describe("placementReasonOf (#254)", () => {
  it("returns the reason while the start is the one it was made for", () => {
    expect(
      placementReasonOf({
        placementReason: "PREFERRED_HOUR",
        placementReasonStartAt: START,
        scheduledStartTime: START,
      }),
    ).toBe("PREFERRED_HOUR");
  });

  it("hides the reason once the start has moved", () => {
    expect(
      placementReasonOf({
        placementReason: "PREFERRED_HOUR",
        placementReasonStartAt: START,
        scheduledStartTime: ALT,
      }),
    ).toBeNull();
  });

  it("is null without a reason or a start", () => {
    expect(
      placementReasonOf({
        placementReason: null,
        placementReasonStartAt: null,
        scheduledStartTime: START,
      }),
    ).toBeNull();
    expect(
      placementReasonOf({
        placementReason: "NEAR_CLASS",
        placementReasonStartAt: START,
        scheduledStartTime: null,
      }),
    ).toBeNull();
  });
});

describe("toSeriesSessionDto (#58)", () => {
  it("a shown divergent sitting carries its proposal id, primary and alternative", () => {
    const dto = toSeriesSessionDto(row(), {
      id: "s1",
      scheduledStartTime: START,
      slotProposalId: "sp-1",
      alternativeSlot: ALT,
      divergent: true,
    });
    expect(dto).toMatchObject({
      id: "s1",
      scheduledStartTime: START.toISOString(),
      slotProposalId: "sp-1",
      primarySlot: START.toISOString(),
      alternativeSlot: ALT.toISOString(),
      divergent: true,
    });
  });

  it("a non-shown sitting keeps its proposal id but no alternative", () => {
    const dto = toSeriesSessionDto(row(), {
      id: "s1",
      scheduledStartTime: START,
      slotProposalId: "sp-2",
      alternativeSlot: null,
      divergent: false,
    });
    expect(dto).toMatchObject({
      slotProposalId: "sp-2",
      primarySlot: START.toISOString(),
      alternativeSlot: null,
      divergent: false,
    });
  });

  it("never reports divergent without an alternative", () => {
    const dto = toSeriesSessionDto(row(), {
      id: "s1",
      scheduledStartTime: START,
      slotProposalId: null,
      divergent: true,
    });
    expect(dto).toMatchObject({
      slotProposalId: null,
      alternativeSlot: null,
      divergent: false,
    });
  });

  it("without a placement (not re-placed) the fields are empty", () => {
    expect(toSeriesSessionDto(row())).toMatchObject(NO_SERIES_SITTING_PROPOSAL);
    expect(NO_SERIES_SITTING_PROPOSAL).toEqual({
      slotProposalId: null,
      primarySlot: null,
      alternativeSlot: null,
      divergent: false,
    });
  });
});

describe("courseKeyOf", () => {
  it("keys an LMS item by its Moodle course id", () => {
    expect(courseKeyOf({ lmsCourseId: 90001, scheduleStudyUnitId: null })).toBe(
      "lms:90001",
    );
  });

  it("keys a portal item by its section id", () => {
    expect(
      courseKeyOf({ lmsCourseId: null, scheduleStudyUnitId: "99910AB100101" }),
    ).toBe("portal:99910AB100101");
  });

  it("is null for a user-created session", () => {
    expect(
      courseKeyOf({ lmsCourseId: null, scheduleStudyUnitId: null }),
    ).toBeNull();
  });
});
