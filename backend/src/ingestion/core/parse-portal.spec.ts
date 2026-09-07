import {
  type PortalExamRow,
  type PortalTimetableRow,
  parseExams,
  parseTimetable,
} from "./parse-portal";

const VN = "Asia/Ho_Chi_Minh"; // UTC+7, no DST

/**
 * The captured `DrawingStudentSchedules` row from `INTEGRATION_DOCS.md`, with
 * every value as DLU returned it (the `TKHHienThi` blob is kept verbatim —
 * it is the only source of the curriculum id and group number).
 */
const LECTURE_ROW: PortalTimetableRow = {
  CurriculumName: "Môn học Mẫu Một",
  WeekScheduleID: 600001,
  ScheduleStudyUnitID: "99910AB100101",
  PeriodID: 1,
  NumberOfPeriods: 4,
  Ngay: "17/08/2026",
  RoomID: "X01.01",
  CampusName: "CSMAU",
  FullName: "Nguyễn Văn A",
  BuildingName: "A27",
  YearStudy: "2026-2027",
  TermID: "HK01",
  TKHHienThi:
    '<span style="color: red;font-weight:bold">Môn học Mẫu Một (10AB1001)</span><br/><span style="color:#0a4358">- Nhóm: 01</span><br/><span style="color:#0a4358">- Lớp: MHK99-PM, MHK99SP</span><br/><span style="color:#0a4358">- Tiết: 1-4</span><br/><span style="color:#0a4358">- Phòng: X01.01</span><br/><span style="color: blue">- GV: Nguyễn Văn A</span><br/><span style="color:#0a4358">- Đã học: 0/30 tiết</span>',
};

/** The captured `exam` rows, including the stray `""` key the API emits. */
const EXAM_ROWS: PortalExamRow[] = [
  {
    ScheduleStudyUnitID: "99810AB100302",
    CurriculumID: "10AB1003",
    CurriculumName: "Môn học Mẫu Bốn",
    NgayThi: "01/12/2025",
    GioThi: "07g30",
    PhongThi: "X02.01",
    DiaDiem: "Cơ sở Mẫu, Đại học Mẫu",
    Examination: "500001",
    ThoiLuong: "120",
    HinhThucThi: "Thi máy",
    "": "2025-12-01T00:00:00",
  } as PortalExamRow,
  {
    ScheduleStudyUnitID: "99810AB100402",
    CurriculumID: "10AB1004",
    CurriculumName: "Đồ án Mẫu",
    NgayThi: "08/12/2025",
    GioThi: "07g30",
    PhongThi: "VP_MAU",
    DiaDiem: "Cơ sở Mẫu, Đại học Mẫu",
    Examination: "500003",
    ThoiLuong: "60",
    HinhThucThi: "Báo cáo TTTT,TL",
    "": "2025-12-08T00:00:00",
  } as PortalExamRow,
  {
    ScheduleStudyUnitID: "99810AB1005D02",
    CurriculumID: "10AB1005D",
    CurriculumName: "Môn học Mẫu Năm",
    NgayThi: "12/12/2025",
    GioThi: "09g30",
    PhongThi: "X02.01",
    DiaDiem: "Cơ sở Mẫu, Đại học Mẫu",
    Examination: "500002",
    ThoiLuong: "90",
    HinhThucThi: "Thi máy",
    "": "2025-12-12T00:00:00",
  } as PortalExamRow,
];

describe("parseTimetable", () => {
  it("turns the captured 4-period lecture into one grid-snapped LECTURE", () => {
    const { items } = parseTimetable([LECTURE_ROW], VN);

    expect(items).toEqual([
      {
        externalKey: "portal:meeting:600001",
        title: "Môn học Mẫu Một",
        type: "LECTURE",
        // Periods 1–4 = 07:30–11:15 VN, already on the 15-min grid (225 min).
        scheduledStartTime: new Date("2026-08-17T00:30:00.000Z"),
        durationMinutes: 225,
        location: "X01.01",
        note: "GV: Nguyễn Văn A",
        scheduleStudyUnitId: "99910AB100101",
      },
    ]);
  });

  it("falls back to a null note when the row names no teacher", () => {
    const { items } = parseTimetable([{ ...LECTURE_ROW, FullName: null }], VN);
    expect(items[0].note).toBeNull();
  });

  it("maps the evening block (periods 11–14) straight through, on grid", () => {
    const { items } = parseTimetable(
      [{ ...LECTURE_ROW, WeekScheduleID: 2, PeriodID: 11 }],
      VN,
    );

    // Periods 11–14 = 16:45–20:00 VN, already on the 15-min grid (195 min);
    // 16:45 VN = 09:45 UTC.
    expect(items[0].scheduledStartTime).toEqual(
      new Date("2026-08-17T09:45:00.000Z"),
    );
    expect(items[0].durationMinutes).toBe(195);
  });

  it("returns the section bundle, deduped, with curriculum id and group from the HTML blob", () => {
    const { sections } = parseTimetable(
      [LECTURE_ROW, { ...LECTURE_ROW, WeekScheduleID: 600002 }],
      VN,
    );

    expect(sections).toEqual([
      {
        scheduleStudyUnitId: "99910AB100101",
        curriculumId: "10AB1001",
        curriculumName: "Môn học Mẫu Một",
        yearStudy: "2026-2027",
        termId: "HK01",
        groupNo: "01",
        teacherName: "Nguyễn Văn A",
        roomId: "X01.01",
        buildingName: "A27",
        campusName: "CSMAU",
      },
    ]);
  });

  it("still emits the meeting when the section coordinates are missing", () => {
    const { items, sections } = parseTimetable(
      [{ ...LECTURE_ROW, YearStudy: null, TermID: "" }],
      VN,
    );

    expect(items).toHaveLength(1);
    expect(sections).toEqual([]);
  });

  it("degrades curriculumId / groupNo to null when the blob changes shape", () => {
    const { sections } = parseTimetable(
      [{ ...LECTURE_ROW, TKHHienThi: "<span>something else entirely</span>" }],
      VN,
    );

    expect(sections[0]).toMatchObject({ curriculumId: null, groupNo: null });
  });

  it("skips undocumented periods 5–6 and says why", () => {
    const { items, skipped } = parseTimetable(
      [{ ...LECTURE_ROW, PeriodID: 5, NumberOfPeriods: 2 }],
      VN,
    );

    expect(items).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].ref).toBe("portal:meeting:600001");
    expect(skipped[0].reason).toMatch(/periods 5–6 are undocumented/);
  });

  it("skips a row with no WeekScheduleID or an unparseable Ngay", () => {
    const { items, skipped } = parseTimetable(
      [
        { ...LECTURE_ROW, WeekScheduleID: null },
        { ...LECTURE_ROW, WeekScheduleID: 7, Ngay: "2026-08-17" },
      ],
      VN,
    );

    expect(items).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "timetable row has no WeekScheduleID",
      'unparseable Ngay "2026-08-17"',
    ]);
  });

  it("tolerates a null or empty payload", () => {
    expect(parseTimetable(null, VN)).toEqual({
      items: [],
      sections: [],
      skipped: [],
    });
    expect(parseTimetable([], VN).items).toEqual([]);
  });
});

describe("parseExams", () => {
  it("parses the captured exam rows, ignoring the stray empty-string key", () => {
    const { items, skipped } = parseExams(EXAM_ROWS, VN);

    expect(skipped).toEqual([]);
    expect(items).toEqual([
      {
        externalKey: "portal:exam:500001",
        title: "Môn học Mẫu Bốn",
        type: "EXAM",
        // 07g30 VN on 01/12/2025 = 00:30 UTC.
        scheduledStartTime: new Date("2025-12-01T00:30:00.000Z"),
        durationMinutes: 120,
        location: "X02.01",
        note: null,
        scheduleStudyUnitId: "99810AB100302",
      },
      {
        externalKey: "portal:exam:500003",
        title: "Đồ án Mẫu",
        type: "EXAM",
        scheduledStartTime: new Date("2025-12-08T00:30:00.000Z"),
        durationMinutes: 60,
        location: "VP_MAU",
        note: null,
        scheduleStudyUnitId: "99810AB100402",
      },
      {
        externalKey: "portal:exam:500002",
        title: "Môn học Mẫu Năm",
        type: "EXAM",
        // 09g30 VN = 02:30 UTC.
        scheduledStartTime: new Date("2025-12-12T02:30:00.000Z"),
        durationMinutes: 90,
        location: "X02.01",
        note: null,
        scheduleStudyUnitId: "99810AB1005D02",
      },
    ]);
  });

  it("rounds ThoiLuong up to a multiple of 15", () => {
    const durations = ["45", "50", "100", "1"].map(
      (ThoiLuong) =>
        parseExams([{ ...EXAM_ROWS[0], ThoiLuong }], VN).items[0]
          .durationMinutes,
    );

    expect(durations).toEqual([45, 60, 105, 15]);
  });

  it("snaps an off-grid start time down", () => {
    const [item] = parseExams(
      [{ ...EXAM_ROWS[0], GioThi: "07g40", ThoiLuong: "50" }],
      VN,
    ).items;

    // 07:40 + 50 min = 08:30; the start snaps back to 07:30 → 60 minutes.
    expect(item.scheduledStartTime).toEqual(
      new Date("2025-12-01T00:30:00.000Z"),
    );
    expect(item.durationMinutes).toBe(60);
  });

  it("falls back to DiaDiem when there is no room", () => {
    const [item] = parseExams([{ ...EXAM_ROWS[0], PhongThi: "" }], VN).items;
    expect(item.location).toBe("Cơ sở Mẫu, Đại học Mẫu");
  });

  it.each([
    [{ Examination: null }, "exam row has no Examination id"],
    [{ NgayThi: "1/12/2025" }, 'unparseable NgayThi "1/12/2025"'],
    [{ GioThi: "07:3" }, 'unparseable GioThi "07:3"'],
    [{ ThoiLuong: "" }, 'unusable ThoiLuong ""'],
    [{ ThoiLuong: "0" }, 'unusable ThoiLuong "0"'],
  ])("skips a malformed row (%o)", (patch, reason) => {
    const { items, skipped } = parseExams([{ ...EXAM_ROWS[0], ...patch }], VN);

    expect(items).toEqual([]);
    expect(skipped[0].reason).toBe(reason);
  });

  it("accepts a `:` separator as well as the portal's `g`", () => {
    const [item] = parseExams([{ ...EXAM_ROWS[0], GioThi: "13:00" }], VN).items;
    expect(item.scheduledStartTime).toEqual(
      new Date("2025-12-01T06:00:00.000Z"),
    );
  });

  it("tolerates a null payload", () => {
    expect(parseExams(null, VN)).toEqual({ items: [], skipped: [] });
  });
});
