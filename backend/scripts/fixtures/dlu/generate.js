/**
 * Generates every fixture JSON file in this directory from scratch.
 *
 * Fully synthetic: no real student names, ids, or course content — every
 * name is a "Test Student N" / "Introduction to <Department>" placeholder.
 * Shapes mirror the real DLU endpoints (see lmsfetchall.md / marks.md at the
 * repo root, and backend/src/ingestion/core/parse-{lms,portal}.ts).
 *
 * Deterministic (seeded PRNG) so re-running reproduces the same output —
 * diffs only show up when this script itself changes.
 *
 * Run: node generate.js
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// deterministic RNG
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260922);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

// ---------------------------------------------------------------------------
// departments + subject catalog
// ---------------------------------------------------------------------------
const DEPARTMENTS = [
  { code: "IT", name: "Information Technology", program: "TEST-PROG-IT" },
  { code: "ECO", name: "Economics", program: "TEST-PROG-ECO" },
  { code: "TOUR", name: "Tourism", program: "TEST-PROG-TOUR" },
  { code: "BUS", name: "Business Administration", program: "TEST-PROG-BUS" },
  { code: "CHE", name: "Chemistry", program: "TEST-PROG-CHE" },
  { code: "BIO", name: "Biology", program: "TEST-PROG-BIO" },
  { code: "SOC", name: "Social Studies", program: "TEST-PROG-SOC" },
  { code: "ENG", name: "English Language", program: "TEST-PROG-ENG" },
  { code: "LING", name: "Linguistics", program: "TEST-PROG-LING" },
];

/** level -> [subjectSuffix, label, credits] */
const LEVELS = [
  ["101", "Introduction to {D}", 3],
  ["102", "{D} Fundamentals II", 3],
  ["201", "Intermediate {D} Topics", 4],
  ["202", "Intermediate {D} Topics II", 4],
  ["301", "Advanced {D} Topics", 3],
  ["302", "{D} Capstone Project", 3],
];

const GENERAL_ELECTIVES = [
  { code: "GEN-EL1", name: "General Elective: Soft Skills", credits: 2 },
  { code: "GEN-EL2", name: "General Elective: Entrepreneurship", credits: 2 },
  { code: "GEN-EL3", name: "General Elective: Introductory Psychology", credits: 2 },
  { code: "GEN-EL4", name: "General Elective: Civic & Legal Studies", credits: 2 },
];

/** dept code -> level suffix -> subject descriptor */
const subjectsByDept = new Map();
for (const dept of DEPARTMENTS) {
  const subjects = new Map();
  for (const [suffix, labelTpl, credits] of LEVELS) {
    subjects.set(suffix, {
      code: `${dept.code}${suffix}`,
      curriculumId: `TESTCUR-${dept.code}-${suffix}`,
      name: labelTpl.replace("{D}", dept.name),
      eng: labelTpl.replace("{D}", dept.name),
      credits: String(credits),
    });
  }
  subjectsByDept.set(dept.code, subjects);
}

// ---------------------------------------------------------------------------
// students
// ---------------------------------------------------------------------------
const STUDENT_COUNT = 150;
// Each department cohort is split into 2 official classes (A/B) — separate
// from the *group* a student registers into for a given subject/term (below).
// This is what lets the fixtures distinguish "same class, different group"
// from "different class" when two students don't share a section.
const CLASSES_PER_DEPT = 2;
const students = [];
{
  let deptIdx = 0;
  for (let i = 1; i <= STUDENT_COUNT; i++) {
    const dept = DEPARTMENTS[deptIdx % DEPARTMENTS.length];
    deptIdx++;
    const id = `TEST${String(i).padStart(5, "0")}`;
    const secondaryDept = chance(0.1)
      ? pick(DEPARTMENTS.filter((d) => d.code !== dept.code))
      : null;
    const classLetter = String.fromCharCode(65 + (i % CLASSES_PER_DEPT)); // A, B, ...
    students.push({
      id,
      name: `Test Student ${i}`,
      dob: `${String((i % 28) + 1).padStart(2, "0")}/${String((i % 12) + 1).padStart(2, "0")}/${2004 + (i % 3)}`,
      gender: chance(0.5) ? "Nam" : "Nữ",
      phone: `090${String(1000000 + i).slice(-7)}`,
      dept,
      cls: `TESTCLASS-${dept.code}-${classLetter}`,
      secondaryDept,
      // ~20 students retake one failed subject; half already resolved it
      // (failed a past semester, passed a later one), half are retaking it
      // THIS term (still in progress).
      retake: i % 7 === 0 ? (i % 14 === 0 ? "in-progress" : "resolved") : null,
    });
  }
}

// ---------------------------------------------------------------------------
// academic calendar: 3 past years (graded) + current in-progress term
// ---------------------------------------------------------------------------
const TERMS = [
  { year: "2023-2024", term: "HK01", levelSuffix: "101" },
  { year: "2023-2024", term: "HK02", levelSuffix: "102" },
  { year: "2024-2025", term: "HK01", levelSuffix: "201" },
  { year: "2024-2025", term: "HK02", levelSuffix: "202" },
  { year: "2025-2026", term: "HK01", levelSuffix: "301" },
  { year: "2025-2026", term: "HK02", levelSuffix: null }, // elective / retake slot
  { year: "2026-2027", term: "HK01", levelSuffix: "302", current: true },
];

function yearSeq(year) {
  // "2023-2024" -> 23, used to build ScheduleStudyUnitID prefixes.
  return year.slice(2, 4);
}
function termDigit(term) {
  return term === "HK01" ? "1" : term === "HK02" ? "2" : "3";
}

/** A stable-looking ScheduleStudyUnitID, DLU-style: <YY><term><DEPT><level><seq>. */
function scheduleId(year, term, deptCode, levelSuffix, seq) {
  return `${yearSeq(year)}${termDigit(term)}20${deptCode}${levelSuffix}${String(seq).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// marks generation (with retakes + dual-program records)
// ---------------------------------------------------------------------------
const marksOut = {}; // studentId -> [{NamHoc, DanhSachDiem}]
const currentCourseLoad = new Map(); // studentId -> [{subject, programId, sectionKey}]

function gradeFor(rand2) {
  const g10 = Math.round((6 + rand2() * 4) * 10) / 10; // 6.0 - 10.0
  const g4 = g10 >= 9 ? 4.0 : g10 >= 8 ? 3.5 : g10 >= 7 ? 3.0 : 2.5;
  const letter = g10 >= 9 ? "A" : g10 >= 8 ? "B" : g10 >= 7 ? "B+" : "C";
  const rank = g10 >= 9 ? "Xuất sắc" : g10 >= 8 ? "Giỏi" : g10 >= 7 ? "Khá" : "Trung bình";
  return { g10: String(g10), g4: String(g4), letter, rank };
}
function failingGrade() {
  return { g10: "3.5", g4: "0.0", letter: "F", rank: "Yếu" };
}

function buildMarkRecord(student, programId, cls, termInfo, subject, unitId, seq, overrides) {
  const inProgress = !!termInfo.current && !overrides?.forcePast;
  const g = overrides?.failing ? failingGrade() : gradeFor(rand);
  return {
    TenXepLoai: inProgress ? null : g.rank,
    StudentID: student.id,
    StudentName: student.name,
    StudentName_Eng: "",
    BirthDay: student.dob,
    GenderVN: student.gender,
    BirthPlace: "Test Province",
    BirthPlace_Eng: "",
    MobilePhone: student.phone,
    ClassStudentID: cls,
    ClassStudentName: cls,
    EnglishClassStudentName: null,
    GraduateLevelID: "DH",
    GraduateLevelName: "Đại học",
    EnglishGraduateLevelName: "",
    StudyTypeName: "Chính quy",
    OlogyID: student.dept.code,
    OlogyName: `${student.dept.name.toUpperCase()} (TEST DATA)`,
    OlogyEngName: null,
    ScheduleStudyUnitID: unitId,
    StudyProgramID: programId,
    YearStudy: termInfo.year,
    TermID: termInfo.term,
    StudyUnitID: subject.curriculumId,
    CurriculumID: subject.curriculumId,
    CurriculumName: subject.name,
    CurriculumNamePrint: subject.name,
    EnglishCurriculumName: subject.eng,
    Credits: subject.credits,
    CurriculumGroupID: "NC",
    DiemTK_10: inProgress ? null : g.g10,
    DiemTK_4: inProgress ? null : g.g4,
    DiemTK_Chu: inProgress ? null : g.letter,
    DiemChuyenMien: "",
    IsPass: inProgress ? null : overrides?.failing ? "" : "x",
    IsGather: "x",
    ToanKhoa: "1",
    NamHoc: "1",
    HocKy: "1",
    NotScore: inProgress ? "1" : "0",
    Note: "",
    NotComputeAverageScore: false,
    Dat_HK: inProgress ? null : String(10 + seq),
    TB_HK: inProgress ? null : "3.50",
    TB_HK_10: inProgress ? null : "8.20",
    TB_HK_4: inProgress ? null : "3.50",
    Dat_TL_HK: String(10 + seq),
    TongTC_DK_HK: String(10 + seq),
    TB_TL_HK: "3.50",
    TB_TL_HK_10: "8.20",
    TB_TL_HK_4: "3.50",
    DiemRenLuyenHK: inProgress ? null : "76",
    CourseTime: "2023 - 2028",
    ThoiGianDaoTao: "5",
    ChuyenNganh: `${student.dept.name} (test data)`,
    AttendedDate: null,
    T_TC_TL_TN: "101",
    TB_TL_TN: "3.50",
    TenXepLoai1: null,
    Eng_TenXepLoai1: null,
    SoHieuBang: null,
    SoVaoSo: null,
    QuyetDinhTotNghiep: null,
    NgayKyQuyetDinh: null,
    NgonNguDaoTao: null,
    NotPrint: false,
    KTESurvey: 0,
    DGKS: 1,
    SurveyClassID: "",
    SurveyData: "",
    ListOfProfessorID: "",
    ListOfProfessorName: "",
    _TermID: 3,
    MD5: md5(`${student.id}:${unitId}:${termInfo.year}:${termInfo.term}`),
  };
}

// One section id per (subject, year, term) — classmates taking the same
// subject in the same term share the identical ScheduleStudyUnitID, matching
// how the real portal addresses a class *offering*, not a per-student
// enrollment. This is what makes per-section response caching (issue #56)
// meaningful against this fixture set.
const sectionIdCache = new Map();
let seqCounter = 1;
function unitIdFor(key, compute) {
  if (!sectionIdCache.has(key)) sectionIdCache.set(key, compute());
  return sectionIdCache.get(key);
}

for (const student of students) {
  const subjects = subjectsByDept.get(student.dept.code);
  const byYear = new Map();
  const load = [];
  currentCourseLoad.set(student.id, load);

  // Which core subject this student retakes (only set when student.retake).
  const retakeLevelSuffix = "201";
  const retakeSubject = subjects.get(retakeLevelSuffix);

  for (const termInfo of TERMS) {
    const records = [];
    const seq = seqCounter++;

    if (termInfo.levelSuffix) {
      const subject = subjects.get(termInfo.levelSuffix);
      // Each department offers the subject in 2 (past terms) or 3 (current
      // term, bigger cohort) parallel groups — a different ScheduleStudyUnitID
      // per group, same as a different offering entirely. A student's group
      // choice is independent of their class (`student.cls`), so two students
      // from the same class can land in different groups, and two students
      // from different classes can land in the same one — both cases this is
      // meant to exercise.
      const groupCount = termInfo.current ? 3 : 2;
      const groupNo = 1 + Math.floor(rand() * groupCount);
      const key = `core|${student.dept.code}|${termInfo.levelSuffix}|${termInfo.year}|${termInfo.term}|g${groupNo}`;
      const unitId = unitIdFor(key, () => scheduleId(termInfo.year, termInfo.term, student.dept.code, termInfo.levelSuffix, groupNo));

      const isFailedAttempt =
        student.retake && termInfo.levelSuffix === retakeLevelSuffix;
      records.push(
        buildMarkRecord(student, student.dept.program, student.cls, termInfo, subject, unitId, seq, {
          failing: isFailedAttempt,
        }),
      );

      if (termInfo.current) {
        load.push({ subject, programId: student.dept.program, unitId, kind: "core", groupNo });
      }
    }

    // Elective slot: every student takes one general elective in 2025-2026 HK02,
    // and about half also carry one in the current term. Electives are NOT
    // department-scoped, so students from different departments who pick the
    // same elective in the same term land in the same section.
    if (termInfo.year === "2025-2026" && termInfo.term === "HK02") {
      const elective = pick(GENERAL_ELECTIVES);
      const key = `elective|${elective.code}|${termInfo.year}|${termInfo.term}`;
      const unitId = unitIdFor(key, () => `${yearSeq(termInfo.year)}${termDigit(termInfo.term)}${elective.code}01`);
      records.push(
        buildMarkRecord(
          student,
          student.dept.program,
          student.cls,
          termInfo,
          { curriculumId: elective.code, name: elective.name, eng: elective.name, credits: String(elective.credits) },
          unitId,
          seq,
          {},
        ),
      );
    }
    if (termInfo.current && chance(0.5)) {
      const elective = pick(GENERAL_ELECTIVES);
      const key = `elective|${elective.code}|${termInfo.year}|${termInfo.term}`;
      const unitId = unitIdFor(key, () => `${yearSeq(termInfo.year)}${termDigit(termInfo.term)}${elective.code}01`);
      const subject = { curriculumId: elective.code, name: elective.name, eng: elective.name, credits: String(elective.credits) };
      records.push(buildMarkRecord(student, student.dept.program, student.cls, termInfo, subject, unitId, seq, {}));
      load.push({ subject, programId: student.dept.program, unitId, kind: "elective" });
    }

    // Resolved retake: pass the same subject one year later than the failed attempt.
    // Shared per (dept, level, year, term): every resolved-retake student of
    // the same department retaking in the same term lands in one small
    // retake section together.
    if (student.retake === "resolved" && termInfo.year === "2025-2026" && termInfo.term === "HK01") {
      const key = `retake|${student.dept.code}|${retakeLevelSuffix}|${termInfo.year}|${termInfo.term}`;
      const unitId = unitIdFor(key, () => scheduleId(termInfo.year, termInfo.term, student.dept.code, `${retakeLevelSuffix}-RETAKE`, 1));
      records.push(buildMarkRecord(student, student.dept.program, student.cls, termInfo, retakeSubject, unitId, seq, {}));
    }
    // In-progress retake: retaking THIS term — a second, currently-ungraded
    // record for the same subject the student failed in 2024-2025 HK01.
    if (student.retake === "in-progress" && termInfo.current) {
      const key = `retake|${student.dept.code}|${retakeLevelSuffix}|${termInfo.year}|${termInfo.term}`;
      const unitId = unitIdFor(key, () => scheduleId(termInfo.year, termInfo.term, student.dept.code, `${retakeLevelSuffix}-RETAKE`, 1));
      records.push(
        buildMarkRecord(student, student.dept.program, student.cls, termInfo, retakeSubject, unitId, seq, {
          forcePast: false,
        }),
      );
      load.push({ subject: retakeSubject, programId: student.dept.program, unitId, kind: "retake", weekdayOffset: 5 });
    }

    // Dual-program students: one extra course from the secondary department,
    // tagged with the secondary StudyProgramID, in the second half of the
    // program and again in the current term.
    if (
      student.secondaryDept &&
      ((termInfo.year === "2025-2026" && termInfo.term === "HK02") || termInfo.current)
    ) {
      const secondarySubjects = subjectsByDept.get(student.secondaryDept.code);
      const secondarySubject = secondarySubjects.get("101");
      const key = `secondary|${student.secondaryDept.code}|101|${termInfo.year}|${termInfo.term}`;
      const unitId = unitIdFor(key, () => scheduleId(termInfo.year, termInfo.term, student.secondaryDept.code, "101", 1));
      records.push(
        buildMarkRecord(
          student,
          student.secondaryDept.program,
          `TESTCLASS-${student.secondaryDept.code}`,
          termInfo,
          secondarySubject,
          unitId,
          seq,
          {},
        ),
      );
      if (termInfo.current) {
        load.push({
          subject: secondarySubject,
          programId: student.secondaryDept.program,
          unitId,
          kind: "secondary-program",
          deptOverride: student.secondaryDept,
        });
      }
    }

    if (records.length === 0) continue;
    if (!byYear.has(termInfo.year)) byYear.set(termInfo.year, []);
    byYear.get(termInfo.year).push({ HocKy: termInfo.term, DanhSachDiemHK: records });
  }

  marksOut[student.id] = [...byYear.entries()].map(([NamHoc, DanhSachDiem]) => ({ NamHoc, DanhSachDiem }));
}

// ---------------------------------------------------------------------------
// current-term sections (portal) + Moodle courses (LMS), grouped by subject
// ---------------------------------------------------------------------------
const WEEKDAY_SLOTS = [
  { weekdayOffset: 0, periodId: 1, numberOfPeriods: 4 }, // Mon morning
  { weekdayOffset: 1, periodId: 7, numberOfPeriods: 4 }, // Tue afternoon
  { weekdayOffset: 2, periodId: 11, numberOfPeriods: 4 }, // Wed evening
  { weekdayOffset: 3, periodId: 1, numberOfPeriods: 4 }, // Thu morning
  { weekdayOffset: 4, periodId: 7, numberOfPeriods: 4 }, // Fri afternoon
];
const ROOMS = ["T101", "T102", "T203", "T204", "T305", "B105", "B110", "B210"];
const TEACHERS = [
  "Test Lecturer A", "Test Lecturer B", "Test Lecturer C", "Test Lecturer D",
  "Test Lecturer E", "Test Lecturer F", "Test Lecturer G", "Test Lecturer H",
];

// key = unitId (== ScheduleStudyUnitID) -> section descriptor
const sections = new Map();
let moodleCourseId = 20001;
let slotIdx = 0;

for (const [studentId, load] of currentCourseLoad) {
  for (const item of load) {
    if (!sections.has(item.unitId)) {
      const isRetake = item.kind === "retake";
      const slot = isRetake
        ? { weekdayOffset: 5, periodId: 1, numberOfPeriods: 4 } // Saturday — real retake sections run off the normal grid
        : WEEKDAY_SLOTS[slotIdx++ % WEEKDAY_SLOTS.length];
      sections.set(item.unitId, {
        scheduleStudyUnitId: item.unitId,
        curriculumId: item.subject.curriculumId,
        curriculumName: item.subject.name,
        credits: item.subject.credits,
        moodleCourseId: moodleCourseId++,
        teacher: pick(TEACHERS),
        room: pick(ROOMS),
        building: chance(0.5) ? "Test Building A" : "Test Building B",
        campus: "Test Campus 1",
        ...slot,
        kind: item.kind,
        groupNo: item.groupNo ?? 1,
        students: [],
      });
    }
    sections.get(item.unitId).students.push(studentId);
  }
}

// ---------------------------------------------------------------------------
// output: students.json
// ---------------------------------------------------------------------------
const studentsOut = students.map((s) => ({
  StudentID: s.id,
  StudentName: s.name,
  BirthDay: s.dob,
  GenderVN: s.gender,
  BirthPlace: "Test Province",
  MobilePhone: s.phone,
  ClassStudentID: s.cls,
  StudyProgramID: s.dept.program,
  StudyProgramName: s.dept.program,
  SecondaryStudyProgramID: s.secondaryDept ? s.secondaryDept.program : null,
  OlogyID: s.dept.code,
  OlogyName: `${s.dept.name.toUpperCase()} (TEST DATA)`,
  GraduateLevelID: "DH",
  GraduateLevelName: "Đại học",
  StudyTypeName: "Chính quy",
  CourseTime: "2023 - 2028",
  ThoiGianDaoTao: "5",
  ChuyenNganh: `${s.dept.name} (test data)`,
  retakeStatus: s.retake,
  portalUsername: s.id.toLowerCase(),
  portalPassword: "testpass123",
  lmsUsername: s.id.toLowerCase(),
  lmsPassword: "testpass123",
}));

// ---------------------------------------------------------------------------
// output: lms-courses.json / lms-enrollments.json / lms-events.json
// ---------------------------------------------------------------------------
const lmsCoursesOut = [...sections.values()].map((sec) => ({
  id: sec.moodleCourseId,
  fullname: `${sec.curriculumName} (Nhóm ${String(sec.groupNo).padStart(2, "0")}) - Section ${sec.scheduleStudyUnitId}`,
  shortname: `${sec.curriculumId}-${sec.scheduleStudyUnitId}`,
  coursecategory: "Học kỳ 1",
  startdate: 1790737200,
  hidden: false,
}));

const lmsEnrollmentsOut = {};
for (const sec of sections.values()) {
  for (const studentId of sec.students) {
    (lmsEnrollmentsOut[studentId] ??= []).push(sec.moodleCourseId);
  }
}

// One assignment for every section; the capstone/core sections also get a
// same-day quiz, and exactly one section (the first "core" one) gets the
// split-month quiz case parse-lms.ts exists to handle.
const lmsEventsOut = { courses: {}, events: {} };
let eventIdSeq = 1;
let mintedSplitQuiz = false;
for (const sec of [...sections.values()]) {
  lmsEventsOut.courses[sec.moodleCourseId] = {
    id: sec.moodleCourseId,
    fullname: sec.curriculumName,
    shortname: sec.curriculumId,
  };
  const evs = [];
  const assignInstance = 500000 + sec.moodleCourseId;
  evs.push({
    id: eventIdSeq++,
    name: `Assignment: ${sec.curriculumName}`,
    modulename: "assign",
    instance: assignInstance,
    eventtype: "due",
    timestart: 1792944000, // 2026-10-25 23:00 +07
    url: `https://lms.example.test/mod/assign/view.php?id=${assignInstance}`,
    description: `<p>Assignment for ${sec.curriculumName}.</p>`,
  });

  if (sec.kind === "core" && !mintedSplitQuiz) {
    mintedSplitQuiz = true;
    const quizInstance = 800000 + sec.moodleCourseId;
    evs.push(
      { id: eventIdSeq++, name: "Quiz opens", modulename: "quiz", instance: quizInstance, eventtype: "open", timestart: 1793458800, url: `https://lms.example.test/mod/quiz/view.php?id=${quizInstance}`, description: "" },
      { id: eventIdSeq++, name: "Quiz closes", modulename: "quiz", instance: quizInstance, eventtype: "close", timestart: 1793581200, url: `https://lms.example.test/mod/quiz/view.php?id=${quizInstance}`, description: "" },
    );
  } else if (sec.kind === "core" || sec.kind === "secondary-program") {
    const quizInstance = 800000 + sec.moodleCourseId;
    evs.push(
      { id: eventIdSeq++, name: "Quiz opens", modulename: "quiz", instance: quizInstance, eventtype: "open", timestart: 1792454400, url: `https://lms.example.test/mod/quiz/view.php?id=${quizInstance}`, description: "" },
      { id: eventIdSeq++, name: "Quiz closes", modulename: "quiz", instance: quizInstance, eventtype: "close", timestart: 1792461600, url: `https://lms.example.test/mod/quiz/view.php?id=${quizInstance}`, description: "" },
    );
  }
  lmsEventsOut.events[sec.moodleCourseId] = evs;
}
lmsEventsOut.enrolledCourses = lmsEnrollmentsOut;

// ---------------------------------------------------------------------------
// output: portal-sections.json / portal-timetable.json / portal-exams.json
// ---------------------------------------------------------------------------
const portalSectionsOut = [...sections.values()].map((sec) => ({
  ScheduleStudyUnitID: sec.scheduleStudyUnitId,
  CurriculumID: sec.curriculumId,
  CurriculumName: sec.curriculumName,
  StudyUnitID: sec.curriculumId,
  YearStudy: "2026-2027",
  TermID: "HK01",
  GroupNo: String(sec.groupNo).padStart(2, "0"),
  weekdayOffset: sec.weekdayOffset,
  PeriodID: sec.periodId,
  NumberOfPeriods: sec.numberOfPeriods,
  RoomID: sec.room,
  BuildingName: sec.building,
  CampusName: sec.campus,
  FullName: sec.teacher,
  students: sec.students,
}));

// Reference week: tuan 44, 2026-2027 HK01 -> Monday 26/10/2026.
const WEEK_DATES = ["26/10/2026", "27/10/2026", "28/10/2026", "29/10/2026", "30/10/2026", "31/10/2026", "01/11/2026"];
const timetableRows = {};
let weekScheduleSeq = 900000000;
for (const sec of sections.values()) {
  for (const studentId of sec.students) {
    (timetableRows[studentId] ??= []).push({
      WeekScheduleID: weekScheduleSeq++,
      ScheduleStudyUnitID: sec.scheduleStudyUnitId,
      CurriculumName: sec.curriculumName,
      PeriodID: sec.periodId,
      NumberOfPeriods: sec.numberOfPeriods,
      Ngay: WEEK_DATES[sec.weekdayOffset],
      RoomID: sec.room,
      BuildingName: sec.building,
      CampusName: sec.campus,
      FullName: sec.teacher,
      YearStudy: "2026-2027",
      TermID: "HK01",
      TKHHienThi: `<span>${sec.curriculumName} (${sec.curriculumId})</span><br/><span>- Nhóm: ${String(sec.groupNo).padStart(2, "0")}</span><br/>`,
    });
  }
}

const examRows = {};
let examSeq = 900001;
for (const sec of sections.values()) {
  const exam = {
    Examination: examSeq++,
    ScheduleStudyUnitID: sec.scheduleStudyUnitId,
    CurriculumID: sec.curriculumId,
    CurriculumName: sec.curriculumName,
    NgayThi: "15/12/2026",
    GioThi: chance(0.5) ? "07g30" : "13g00",
    ThoiLuong: String(pick([45, 60, 90, 120])),
    PhongThi: sec.room,
    DiaDiem: sec.building,
    HinhThucThi: pick(["Tự luận", "Thi máy", "Vấn đáp"]),
  };
  for (const studentId of sec.students) {
    (examRows[studentId] ??= []).push(exam);
  }
}

// ---------------------------------------------------------------------------
// output: portal-year-term.json / portal-study-program.json
// ---------------------------------------------------------------------------
const yearTermOut = {
  _comment: "GET /api/student/yearandterm response shape — static, same for every student.",
  YearStudy: ["2026-2027", "2025-2026", "2024-2025", "2023-2024"],
  Terms: [
    { TermID: "HK01", TermName: "Học kỳ 1" },
    { TermID: "HK02", TermName: "Học kỳ 2" },
    { TermID: "HK03", TermName: "Học kỳ 3" },
  ],
  CurrentYear: "2026-2027",
  CurrentTerm: "HK01",
};

const studyProgramOut = {};
for (const s of students) {
  const rows = [{ StudentID: s.id, StudyProgramID: s.dept.program, StudyProgramName: s.dept.program, Type: 1 }];
  if (s.secondaryDept) {
    rows.push({ StudentID: s.id, StudyProgramID: s.secondaryDept.program, StudyProgramName: s.secondaryDept.program, Type: 2 });
  }
  studyProgramOut[s.id] = rows;
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------
function write(name, data, comment) {
  const body = comment ? { _comment: comment, ...data } : data;
  fs.writeFileSync(path.join(__dirname, name), JSON.stringify(body, null, 2) + "\n");
  console.log(`wrote ${name}`);
}

write("students.json", studentsOut);
write("lms-courses.json", lmsCoursesOut);
write(
  "lms-enrollments.json",
  lmsEnrollmentsOut,
  "studentId -> Moodle course ids enrolled THIS TERM (see lms-courses.json). The fake server joins these to build a core_course_get_enrolled_courses_by_timeline_classification response.",
);
write(
  "lms-events.json",
  lmsEventsOut,
  "Current-term Moodle calendar events (assign/quiz) per course id, in core_calendar_get_calendar_monthly_view event shape. timestart is Unix epoch seconds (Asia/Ho_Chi_Minh wall clock). One 'core' section's quiz is deliberately split across a month boundary — the case parse-lms.ts exists to stitch back together.",
);
write(
  "portal-sections.json",
  { sections: portalSectionsOut },
  "Current-term (2026-2027 HK01) class sections, one per distinct subject/offering. Sections with 2+ students in `students` are shared — real classmates in the same section, useful for exercising per-section response caching across students (issue #56). `kind: \"retake\"` sections meet on Saturday, off the normal weekday grid, matching how DLU runs small retake offerings.",
);
write(
  "portal-timetable.json",
  { namhoc: "2026-2027", hocky: "HK01", tuan: 44, rows: timetableRows },
  "One concrete week (tuan 44 -> Mon 26/10/2026) expanded from portal-sections.json into PortalTimetableRow shape, per student. WeekScheduleID is the per-meeting id parse-portal.ts keys move/delete detection on.",
);
write(
  "portal-exams.json",
  { rows: examRows },
  "studentId -> PortalExamRow[] for the current term, one exam per section the student is in (classmates in the same section share the exam row's Examination id).",
);
write(
  "portal-marks.json",
  marksOut,
  "studentId -> GET /api/student/marks response shape. 3 past graded academic years + the current in-progress term (NotScore=\"1\", grades null). Students with retakeStatus (see students.json) carry a failing record for one subject plus either a later passing retake (\"resolved\") or a currently-in-progress retake (\"in-progress\") — same CurriculumID, a NEW ScheduleStudyUnitID. Dual-program students (secondaryDept in students.json) carry extra records tagged with their secondary StudyProgramID.",
);
write("portal-year-term.json", yearTermOut);
write(
  "portal-study-program.json",
  studyProgramOut,
  "studentId -> GET /api/student/getstudyprogram rows. Dual-program students have two rows (Type 1 = primary, Type 2 = secondary).",
);

console.log(`\n${students.length} students, ${sections.size} current-term sections, ${[...sections.values()].reduce((n, s) => n + s.students.length, 0)} section-enrollments.`);
