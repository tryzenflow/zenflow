import assert from "node:assert/strict";
import { test } from "node:test";
import { clock, placeTasks } from "./slotting.ts";

const busy = [
  { start: 480, end: 570 },
  { start: 600, end: 690 },
  { start: 810, end: 900 },
  { start: 1020, end: 1050 },
];
const tasks = [
  { id: "essay", minutes: 90, deadline: 1260 },
  { id: "physics", minutes: 45, deadline: 810 },
  { id: "report", minutes: 60, deadline: 1020 },
];

test("places by earliest deadline in the first free slot", () => {
  const placed = placeTasks(busy, tasks, 480, 1080);
  assert.deepEqual(placed.get("physics"), { start: 690, end: 735 });
  assert.deepEqual(placed.get("report"), { start: 735, end: 795 });
  assert.deepEqual(placed.get("essay"), { start: 900, end: 990 });
});

test("the result does not depend on the order tasks were added", () => {
  const a = placeTasks(busy, tasks, 480, 1080);
  const b = placeTasks(busy, [...tasks].reverse(), 480, 1080);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
});

test("never overlaps a busy block and stays on the 15 minute grid", () => {
  const placed = placeTasks(busy, tasks, 487, 1080);
  for (const slot of placed.values()) {
    assert.equal(slot.start % 15, 0);
    assert.ok(busy.every((b) => slot.end <= b.start || slot.start >= b.end));
  }
});

test("leaves out a task with no room before its deadline", () => {
  const placed = placeTasks(busy, [{ id: "late", minutes: 120, deadline: 600 }], 480, 1080);
  assert.equal(placed.has("late"), false);
});

test("formats a wall clock", () => {
  assert.equal(clock(690), "11:30");
  assert.equal(clock(480), "8:00");
});
