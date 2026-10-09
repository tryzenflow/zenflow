# DLU fixtures

Dev-facing. Synthetic data for 150 test students across 9 departments, standing in for the LMS and student portal.
No real names, ids or course content; placeholders only. Shapes follow `backend/src/ingestion/core/parse-{lms,portal}.ts`.

## Run

```bash
pnpm --filter backend dlu:fake          # fake DLU server on :4100
node generate.js                        # regenerate the JSON (deterministic, seeded)
node seed-and-sync.js [--limit N]       # seed accounts, connect LMS + PORTAL, print /_/stats
```

Run `generate.js` and `seed-and-sync.js` from this directory. Edit `generate.js` and re-run it rather than hand-editing the JSON, except for one-off change tests (below).

| Env | Used by | Default / effect |
| --- | ------- | ---------------- |
| `FAKE_DLU_PORT` | fake server | `4100` |
| `FAKE_DLU_LATENCY_MS` | fake server | delay on every upstream response (default `0`) |
| `FAKE_DLU_JITTER_MS` | fake server | extra random delay in `[0, n]` ms (default `0`) |
| `FAKE_DKHP_API_KEY` | fake server | require this exact `apikey` on DKHP calls; unset accepts any non-empty key |
| `ZENFLOW_API` | `seed-and-sync.js` | `http://localhost:8000/api/v1` |
| `MAIL_URL` | `seed-and-sync.js` | `http://localhost:8025` (Mailpit, OTP login) |
| `FAKE_DLU_URL` | `seed-and-sync.js`, `measure.js` | `http://localhost:4100` |

`seed-and-sync.js` prerequisites are listed in its header (dev stack, backend pointed at the fake, raised OTP limits).

## Files

| File | Mirrors | Keyed by |
| ---- | ------- | -------- |
| `students.json` | login + profile fixture | array |
| `lms-courses.json` | Moodle course catalog (current term) | array, `id` |
| `lms-enrollments.json` | `core_course_get_enrolled_courses_by_timeline_classification` | `studentId -> course id[]` |
| `lms-events.json` | `core_calendar_get_calendar_monthly_view` events | events by course id + `enrolledCourses` |
| `portal-sections.json` | class-section catalog (internal, not a real endpoint) | `{ sections: [...] }` |
| `portal-timetable.json` | `GET /api/student/DrawingStudentSchedules` | `studentId -> row[]`, one ISO week |
| `portal-exams.json` | `GET /api/student/exam` | `studentId -> row[]` |
| `portal-regist-history.json` | `POST /api/student/getAllRegistHistory` (DKHP) | `studentId -> event[]`, every term |
| `portal-year-term.json` | `GET /api/student/yearandterm` | static |

Scripts: `bench.sh`, `measure.js`, `mutate.js`, `bench-report.js` (benchmark, see below).

## Coverage

- **Departments:** IT, Economics, Tourism, Business, Chemistry, Biology, Social Studies, English, Linguistics.
  Each has its own program id and 6 core subjects (`101`/`102`, `201`/`202`, `301`/`302`).
- **Electives:** 4-item general pool (`GEN-EL1..4`), not department-scoped, so sections are shared across departments.
- **Retakes:** about 1 in 7 students fail their `201` course.
  Half retake and pass later (`retakeStatus: "resolved"`); half retake now (`"in-progress"`).
  Same `CurriculumID`, new `ScheduleStudyUnitID`.
- **Dual programs:** about 10% of students have a `SecondaryStudyProgramID` and an extra course from it.
- **Registration history (DKHP):** an event log per student.
  - The current term's latest-registered sections equal the timetable's sections.
  - Every 5th student re-registers a section (register, cancel, register).
  - Every 7th registered then cancelled a section they do not attend.
  - Every 3rd has an event in the previous term, served only when that term is asked for.
- **Groups vs. classes:** each department has 2 classes (`TESTCLASS-{DEPT}-A`/`-B`).
  Each core subject runs 2-3 parallel groups per term, chosen independently of class.
  Example: `TESTCUR-IT-302`.
- **Shared sections (issue #56):** `portal-sections.json` sections carry a `students` array.
  Department cores have about 9-12 students, electives up to about 19, retake/secondary sections 1-3.

## Simulating change

Fixtures are static snapshots; the fake serves them whenever the files are present.

- **New:** add a row or event.
- **Change:** edit room, period, time or grade.
- **Delete:** remove a row or event.
- **Reload without restart:** `POST /_/reload-fixtures`.
- **Stable ids:** `WeekScheduleID`, `Examination` and Moodle `instance` drive move/delete detection (`parse-portal.ts`, `parse-lms.ts`).
  Keep them for "same activity, new details"; mint new ids only for a new activity.

## Fake server behaviour

- **Student identity:** neither upstream data request names a student, so login bakes it in.
  - Portal token: `fake-portal-token-<StudentID>`.
  - Moodle cookie: `MoodleSession=auth-<StudentID>`.
- **Weeks:** the timetable is one reference week; other weeks of the term are that week shifted, with per-week `WeekScheduleID`s.
- **Unknown username:** falls back to the ad-hoc generator.
- **Discovery:** `getAllRegistHistory` (DKHP) and enrolled courses (paged 2 at a time) are served.
- **DKHP vs portal:** they share the login path; `clientid: dtl` means DKHP and needs a non-empty `apikey` (`DKHP_API_KEY` in `.env.dev`).
- **Counters:** `GET /_/stats` (keyed by resource, not raw URL), `GET /_/log` (ordered request log), `POST /_/reset`.
  DKHP keys: `dkhp:authenticate`, `dkhp:history:<year>:<term>:<studentId>`.

## Benchmark

`bench.sh` compares no cache (A) with cache + fanout (B) end to end.
Method, results and limits: [ingestion-cache-benchmark.md](../../../../docs/benchmarks/ingestion-cache-benchmark.md).
Ingestion design: [docs/backend/ingestion.md](../../../../docs/backend/ingestion.md).

- Destructive to the dev database; needs the dev docker stack and a built backend.
