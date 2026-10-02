# Ingestion benchmark: no cache vs cache + fanout

Date: 2026-10-02. Branch: `feat/issue-56-ingestion-cache`.

## Goal
Measure how many upstream requests the ingestion pipeline sends to DLU while the timetable changes, with and without the occurrence cache and fanout, and check that students' own moves and deletes survive.

## System under test
- **Rolling schedule.** The ticker fires every minute and claims a batch of the most-overdue students. A student's next sync is due one period after their claim.
- **Discovery.** Once per term, each student's enrolled subjects are read from DKHP. A timetable fetch never runs before that student's discovery.
- **Timetable and LMS calendar.** Fetched per student. These are the two syncs the cache and fanout apply to.
- **Exams.** Fetched per student on the same schedule. They never use the cache or fanout.
- **Cache.** One student's live walk records each section's lectures. Classmates claimed while that read is within `INGESTION_CACHE_TTL_MS` (default 7 days) are served from it with no upstream request. Past the TTL, the next student's walk refetches and populates everyone.
- **Fanout.** A change found by a walk is applied to the other students in that section. Lectures a student moved are left alone, lectures a student deleted are not recreated, and one student's Moodle override never travels to others.

## Test setup
- **Environment.** Dev Docker stack, the built backend and the local fake DLU server (`backend/scripts/fake-dlu-server.ts`). No real DLU or DKHP host is contacted.
- **Population.** 150 fake students, seeded once with ingestion off. Discovery is done once during setup and reported separately, so it adds nothing to the measured counts. Each run starts from the same database snapshot.
- **Schedule.** The ticker fires every minute. Every sync period is 2 minutes, so each tick claims 75 of the 150 students and two ticks make one window in which every student is synced once.
- **Cache TTL.** 90 s here (production default 7 days). It is shorter than the period so that a read from one window has expired by the next, while still serving the rest of its own window.
- **Latency.** The fake server adds 4 ms plus a random 0-4 ms to each response.
- **Run length.** 5 ticks, one run per case. A is `INGESTION_OCCURRENCE_CACHE_ENABLED=false`, B is `true`.

Timeline of each run:

| Tick | What happens |
| ---- | ------------ |
| 1-2 | First window: everything is new. |
| after 2 | Students move lectures (104) and delete lectures (65) in Zenflow; then upstream, 8 sections change room and 8 others are removed. |
| 3-4 | Second window: the batches pick up the changes. |
| 5 | Spare, for a batch whose due time slipped a tick. |

## Checks
1. **Same calendars.** After a 70 s settle, the calendar rows from LMS and portal data are compared between A and B.
2. **Student customizations.** Moved lectures keep their time and room, deleted lectures stay deleted, everyone else gets the room change, and upcoming sessions of removed sections are deleted.
3. **Discovery before timetable.** A separate gate run starts with no discovery done and every kind due at once. The fake server's ordered request log must show no timetable request before that student's DKHP history request.
4. **Exams outside the cache.** No exam cache table or row exists and every student had upstream exam requests.

## Results

One-time discovery, outside the runs: 911 requests (150 DKHP history, 161 LMS enrolled, the rest auth).

| Tick | A (no cache) total / data | B (cache + fanout) total / data |
| ---- | ------------------------- | ------------------------------- |
| 1 | 1,575 / 1,200 | 1,029 / 693 |
| 2 | 1,575 / 1,200 | 623 / 316 |
| 3 | 0 / 0 | 651 / 527 |
| 4 | 1,575 / 1,200 | 0 / 0 |
| 5 | 1,575 / 1,200 | 894 / 676 |
| **Run** | **6,300 / 4,800** | **3,197 / 2,212** |

| Case | Auth | Busy s per tick (mean) | Skipped ticks | Exam passes per student |
| ---- | ---- | ---------------------- | ------------- | ----------------------- |
| A | 1,500 | 29.2 | 0 | 2.5 |
| B | 985 | 19.5 | 0 | 2.5 |

"Busy s per tick" is the span between the first and last request in each minute, from the fake server's timestamps. Both cases did the same work (5 batches of 75, so 2.5 passes per student), which makes the totals directly comparable.

Checks:
- **Calendars:** identical between A and B (4,020 rows).
- **Moves and deletes:** all 104 moved lectures kept their time and room, all 65 deleted lectures stayed deleted, 208 other students' sessions got the new room with none stale, and every upcoming session of the removed sections was deleted. Same in A and B.
- **Order:** 0 timetable requests before a student's DKHP history request (150 students, 140 timetable requests seen).
- **Exams:** no exam cache table or row, and every student had upstream exam requests in both runs.

## Findings
1. **The cache cuts total requests by 49% and data requests by 54%** for the same work. Auth drops 34% because students served from the cache skip their login.
2. **Busy time per tick falls from 29 s to 19.5 s**, and neither case skipped a tick at this scale.
3. **Updates and removals reach everyone through fanout.** Calendars are identical to the no-cache run, and no student's own move or delete was overwritten or undone.
4. **B is not free of data requests.** Ticks 3 and 5 still send 500-700 data requests, because the TTL expired and a representative per section refetched live.

## Limitations
- **One run per case.** There is no spread. A tick with 0 requests (A tick 3, B tick 4) appears when a batch's due time lands a few milliseconds after the next tick and waits a tick; the spare tick 5 absorbs it.
- **Synthetic upstream.** Latency is 4-8 ms, far below real DLU. The fake assumes DKHP `CurriculumID` equals the timetable `ScheduleStudyUnitID`; this is not checked against the real DKHP API.
- **Compressed schedule.** A 2-minute period and a 90 s TTL stand in for production's daily periods and 7-day TTL.
- **Removals are checked for upcoming sessions only.** A walk reconciles from now onward, so past occurrences of a removed section correctly remain as history.
- **No backend timing.** The portal client duration histogram was not collected (OpenTelemetry is off in the dev stack); timing comes from fake-server timestamps.

## Reproduce
```bash
cd backend
docker compose -f compose.dev.yml up -d
npm run build
REPEATS=1 scripts/fixtures/dlu/bench.sh   # ticks=5, latency=4 ms
```
`bench.sh` drops and recreates the dev `zenflow` database (and temporary `zenflow_seed*` copies). `.env.dev` must point `LMS_URL`, `PORTAL_API_URL` and `DKHP_API_URL` at the fake server on port 4100 and carry any non-empty `DKHP_API_KEY`. Output goes to `$OUT` (default `/tmp/dlu-bench`, wiped at start). The one-time setup takes about 5 minutes and each run about 7.
