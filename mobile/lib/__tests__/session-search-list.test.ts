import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { makeSession } from "../../test/fixtures";
import { setLanguage } from "../i18n";
import {
  flattenDayGroups,
  groupSessionsByDay,
  mergeSearchPage,
  sessionTimeRange,
} from "../session-search-list";

const at = (id: string, iso: string | null): Session =>
  makeSession({ id, scheduledStartTime: iso });

const ids = (list: Session[]) => list.map((s) => s.id);

describe("groupSessionsByDay", () => {
  it("groups sessions under their calendar day in the user's timezone", () => {
    // 23:30 UTC on 14 Oct is 06:30 on 15 Oct in Ho Chi Minh (UTC+7).
    const groups = groupSessionsByDay(
      [
        at("a", "2026-10-14T23:30:00.000Z"),
        at("b", "2026-10-15T02:00:00.000Z"),
        at("c", "2026-10-15T09:00:00.000Z"),
      ],
      "Asia/Ho_Chi_Minh",
    );
    expect(groups.map((g) => g.date)).toEqual(["2026-10-15"]);
    expect(ids(groups[0].sessions)).toEqual(["a", "b", "c"]);
  });

  it("starts a new group when the day changes and sorts out-of-order input", () => {
    const groups = groupSessionsByDay(
      [at("late", "2026-10-16T08:00:00.000Z"), at("early", "2026-10-15T08:00:00.000Z")],
      "UTC",
    );
    expect(groups.map((g) => [g.date, ids(g.sessions)])).toEqual([
      ["2026-10-15", ["early"]],
      ["2026-10-16", ["late"]],
    ]);
  });

  it("skips sessions without a start time", () => {
    expect(groupSessionsByDay([at("x", null)], "UTC")).toEqual([]);
  });
});

describe("flattenDayGroups", () => {
  it("emits one header row per day followed by its session rows", () => {
    const rows = flattenDayGroups(
      groupSessionsByDay(
        [at("a", "2026-10-15T08:00:00.000Z"), at("b", "2026-10-15T10:00:00.000Z")],
        "UTC",
      ),
    );
    const labels = rows.map((r) =>
      r.kind === "day" ? `day ${r.date}` : `session ${r.session.id}`,
    );
    expect(labels).toEqual(["day 2026-10-15", "session a", "session b"]);
  });
});

describe("mergeSearchPage", () => {
  it("appends a forward page after the current rows", () => {
    const merged = mergeSearchPage([at("a", null), at("b", null)], [at("c", null)], "forward");
    expect(ids(merged)).toEqual(["a", "b", "c"]);
  });

  it("prepends a backward page before the current rows", () => {
    const merged = mergeSearchPage([at("c", null)], [at("a", null), at("b", null)], "backward");
    expect(ids(merged)).toEqual(["a", "b", "c"]);
  });

  it("drops duplicates and keeps the first position", () => {
    const forward = mergeSearchPage(
      [at("a", null), at("b", null)],
      [at("b", null), at("c", null)],
      "forward",
    );
    expect(ids(forward)).toEqual(["a", "b", "c"]);
    const backward = mergeSearchPage(
      [at("b", null), at("c", null)],
      [at("a", null), at("b", null)],
      "backward",
    );
    expect(ids(backward)).toEqual(["a", "b", "c"]);
  });
});

describe("sessionTimeRange", () => {
  it("shows start and end in the user's timezone", () => {
    const session = makeSession({
      scheduledStartTime: "2026-10-15T02:00:00.000Z",
      durationMinutes: 90,
    });
    setLanguage("vi");
    expect(sessionTimeRange(session, "Asia/Ho_Chi_Minh")).toBe("09:00 – 10:30");
  });

  it("uses 12-hour times in English", () => {
    const session = makeSession({
      scheduledStartTime: "2026-10-15T02:00:00.000Z",
      durationMinutes: 90,
    });
    expect(sessionTimeRange(session, "Asia/Ho_Chi_Minh")).toBe("9:00 AM – 10:30 AM");
  });
});
