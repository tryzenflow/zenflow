/**
 * Applies one deterministic edit to portal-timetable.json for bench.sh.
 *
 *   node mutate.js update   first 8 sections (sorted by ScheduleStudyUnitID) move
 *                           to a new room for every student who attends them
 *   node mutate.js remove   the next 8 sections disappear from every student's
 *                           timetable
 *
 *   node mutate.js ids update|remove   print the section ids of that set, "|"-joined
 *
 * bench.sh backs the file up first and restores it afterwards; this script only
 * edits.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const idsOnly = process.argv[2] === "ids";
const phase = idsOnly ? process.argv[3] : process.argv[2];
if (phase !== "update" && phase !== "remove") {
  console.error("usage: node mutate.js [ids] update|remove");
  process.exit(2);
}
const file = path.join(__dirname, "portal-timetable.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const all = [...new Set(Object.values(data.rows).flat().map((r) => r.ScheduleStudyUnitID))].sort();
const ids = phase === "update" ? all.slice(0, 8) : all.slice(8, 16);
if (idsOnly) {
  console.log(ids.join("|"));
  process.exit(0);
}
let touched = 0;
for (const [student, rows] of Object.entries(data.rows)) {
  if (phase === "update") {
    for (const row of rows) {
      if (ids.includes(row.ScheduleStudyUnitID)) {
        row.RoomID = `CHG-${ids.indexOf(row.ScheduleStudyUnitID)}`;
        touched++;
      }
    }
  } else {
    const kept = rows.filter((r) => !ids.includes(r.ScheduleStudyUnitID));
    touched += rows.length - kept.length;
    data.rows[student] = kept;
  }
}
fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log(`mutate ${phase}: ${ids.length} sections, ${touched} student rows`);
