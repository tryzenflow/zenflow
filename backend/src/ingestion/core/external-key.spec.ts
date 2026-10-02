import {
  isLegacyPortalMeetingKey,
  legacyPortalMeetingKey,
  lmsAssignKey,
  lmsQuizKey,
  portalExamKey,
  portalLectureKey,
  unkeyablePortalLectureRef,
} from "./external-key";

// Every id here is deliberately fictional — never real DLU data.
const SECTION = "99910AB100101";

describe("portalLectureKey", () => {
  it("is the section, the DLU-local day and the starting period", () => {
    expect(
      portalLectureKey({
        scheduleStudyUnitId: SECTION,
        meetingDate: "2026-10-26",
        periodId: 1,
      }),
    ).toBe("portal:lecture:99910AB100101:2026-10-26:1");
  });

  it("keeps a two-digit period intact (periods run to 14)", () => {
    expect(
      portalLectureKey({
        scheduleStudyUnitId: SECTION,
        meetingDate: "2026-10-26",
        periodId: 11,
      }),
    ).toBe("portal:lecture:99910AB100101:2026-10-26:11");
  });

  it("is identical for two students in the same meeting", () => {
    // The whole point of the #56 re-key: nothing in the key comes from the
    // student, so a cached occurrence can mint it for anyone confirmed in the
    // section. Before #56 this key carried the per-student WeekScheduleID.
    const parts = {
      scheduleStudyUnitId: SECTION,
      meetingDate: "2026-10-26",
      periodId: 7,
    };
    expect(portalLectureKey(parts)).toBe(portalLectureKey({ ...parts }));
  });

  it("separates two meetings of one section on the same day", () => {
    // A lecture plus its lab. Keying on the date alone would collide here and
    // reconcileDeleted would retire whichever row lost.
    const morning = portalLectureKey({
      scheduleStudyUnitId: SECTION,
      meetingDate: "2026-10-26",
      periodId: 1,
    });
    const afternoon = portalLectureKey({
      scheduleStudyUnitId: SECTION,
      meetingDate: "2026-10-26",
      periodId: 7,
    });
    expect(morning).not.toBe(afternoon);
  });

  it("separates the same period on two days", () => {
    expect(
      portalLectureKey({
        scheduleStudyUnitId: SECTION,
        meetingDate: "2026-10-26",
        periodId: 1,
      }),
    ).not.toBe(
      portalLectureKey({
        scheduleStudyUnitId: SECTION,
        meetingDate: "2026-11-02",
        periodId: 1,
      }),
    );
  });

  it("takes the meeting date verbatim, with no Date round-trip", () => {
    // meetingDate is the row's own DLU-local day. Parsing it into a Date and
    // formatting it back would shift it for any server not in Asia/Ho_Chi_Minh.
    const key = portalLectureKey({
      scheduleStudyUnitId: SECTION,
      meetingDate: "2027-01-01",
      periodId: 1,
    });
    expect(key.endsWith(":2027-01-01:1")).toBe(true);
  });
});

describe("legacyPortalMeetingKey", () => {
  it("rebuilds the pre-#56 key from a WeekScheduleID", () => {
    expect(legacyPortalMeetingKey(900000001)).toBe("portal:meeting:900000001");
    expect(legacyPortalMeetingKey("900000001")).toBe(
      "portal:meeting:900000001",
    );
  });

  it("is recognisable, so a stored row can be found under its old name", () => {
    expect(isLegacyPortalMeetingKey("portal:meeting:900000001")).toBe(true);
    expect(
      isLegacyPortalMeetingKey("portal:lecture:99910AB100101:2026-10-26:1"),
    ).toBe(false);
    expect(isLegacyPortalMeetingKey("portal:exam:900001")).toBe(false);
  });

  it("does not collide with the new lecture prefix", () => {
    // "portal:meeting" vs "portal:lecture" — a startsWith check on either must
    // never match the other.
    expect(legacyPortalMeetingKey(1).startsWith("portal:lecture:")).toBe(false);
  });
});

describe("the keys #56 does not change", () => {
  it("portalExamKey keys on the shared Examination id", () => {
    expect(portalExamKey(900001)).toBe("portal:exam:900001");
  });

  it("lmsAssignKey and lmsQuizKey key on the activity instance", () => {
    expect(lmsAssignKey(500123)).toBe("lms:assign:500123");
    expect(lmsQuizKey(800123)).toBe("lms:quiz:800123");
  });

  it("an assignment and a quiz sharing an instance number stay distinct", () => {
    expect(lmsAssignKey(800123)).not.toBe(lmsQuizKey(800123));
  });
});

describe("unkeyablePortalLectureRef", () => {
  it("names the section when the row has one", () => {
    expect(unkeyablePortalLectureRef(SECTION)).toBe(
      "portal:lecture:99910AB100101",
    );
  });

  it("falls back to 'unknown' rather than an empty ref", () => {
    expect(unkeyablePortalLectureRef(null)).toBe("portal:lecture:unknown");
    expect(unkeyablePortalLectureRef(undefined)).toBe("portal:lecture:unknown");
  });
});
