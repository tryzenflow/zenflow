import {
  NO_SERIES_SITTING_PROPOSAL,
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
