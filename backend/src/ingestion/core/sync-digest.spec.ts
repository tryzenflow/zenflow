import {
  type DigestItem,
  digestNotifications,
  SyncDigest,
} from "./sync-digest";

const NOW = new Date("2026-09-10T00:00:00.000Z");

function item(over: Partial<DigestItem> = {}): DigestItem {
  return {
    type: "LECTURE",
    kind: "created",
    sessionId: "s1",
    title: "Đại số",
    startsAt: new Date("2026-09-12T02:00:00.000Z"),
    endsAt: new Date("2026-09-12T04:00:00.000Z"),
    ...over,
  };
}

describe("digestNotifications", () => {
  it("raises nothing for an empty run", () => {
    expect(digestNotifications([], NOW)).toEqual([]);
  });

  it("lists created, changed and removed counts, omitting zeros", () => {
    const [n] = digestNotifications(
      [
        item({ sessionId: "a" }),
        item({ sessionId: "b" }),
        item({ kind: "updated", sessionId: "c" }),
        item({ kind: "removed", sessionId: null }),
      ],
      NOW,
    );
    expect(n.title).toBe(
      "You have 2 new lectures, 1 change to your lectures, 1 lecture removed",
    );

    const [onlyChanges] = digestNotifications(
      [
        item({ kind: "updated", sessionId: "a" }),
        item({ kind: "updated", sessionId: "b" }),
      ],
      NOW,
    );
    expect(onlyChanges.title).toBe("You have 2 changes to your lectures");
    expect(onlyChanges.eventName).toBe("lecture.group_updated");
  });

  it("names the group's kind by its most significant change", () => {
    const names = (kinds: DigestItem["kind"][]) =>
      digestNotifications(
        kinds.map((kind, i) =>
          item({ kind, sessionId: kind === "removed" ? null : `s${i}` }),
        ),
        NOW,
      )[0].eventName;
    expect(names(["removed", "updated", "created"])).toBe(
      "lecture.group_created",
    );
    expect(names(["removed", "updated"])).toBe("lecture.group_updated");
    expect(names(["removed", "removed"])).toBe("lecture.group_removed");
  });

  it("opens the soonest upcoming session, else the latest past one", () => {
    const upcoming = digestNotifications(
      [
        item({ sessionId: "past", startsAt: new Date("2026-09-01T00:00:00Z") }),
        item({
          sessionId: "later",
          startsAt: new Date("2026-09-20T00:00:00Z"),
        }),
        item({ sessionId: "soon", startsAt: new Date("2026-09-11T00:00:00Z") }),
      ],
      NOW,
    )[0];
    expect(upcoming.sessionId).toBe("soon");

    const allPast = digestNotifications(
      [
        item({ sessionId: "old", startsAt: new Date("2026-08-01T00:00:00Z") }),
        item({
          sessionId: "recent",
          startsAt: new Date("2026-09-05T00:00:00Z"),
        }),
      ],
      NOW,
    )[0];
    expect(allPast.sessionId).toBe("recent");
  });

  it("has nothing to open when every item was removed", () => {
    const [n] = digestNotifications(
      [
        item({ kind: "removed", sessionId: null }),
        item({ kind: "removed", sessionId: null }),
      ],
      NOW,
    );
    expect(n.sessionId).toBeNull();
    expect(n.content).toContain("no longer on your calendar");
  });

  it("emits one row per type, exams first, grouping even a single change", () => {
    const rows = digestNotifications(
      [
        item({ sessionId: "l1" }),
        item({ sessionId: "l2" }),
        item({ type: "EXAM", sessionId: "e1", title: "Midterm" }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.eventName)).toEqual([
      "exam.group_created",
      "lecture.group_created",
    ]);
    expect(rows[0].title).toBe("You have a new exam");
    // A one-item row keeps its end instant for the inbox's "due" badge.
    expect(rows[0].eventEndsAt).toEqual(item().endsAt);
    expect(rows[1].eventEndsAt).toBeNull();
    expect(rows.every((r) => r.materializeSession === false)).toBe(true);
  });

  it("uses an article only for a lone phrase, digits inside a list", () => {
    const title = (items: DigestItem[]) =>
      digestNotifications(items, NOW)[0].title;
    expect(title([item({ type: "ASSIGNMENT" })])).toBe(
      "You have a new assignment",
    );
    expect(
      title([item({ type: "EXAM", kind: "removed", sessionId: null })]),
    ).toBe("You have an exam removed");
    expect(title([item({ kind: "updated" })])).toBe(
      "You have a change to your lectures",
    );
    expect(
      title([
        item({ sessionId: "a" }),
        item({ sessionId: "b" }),
        item({ kind: "removed", sessionId: null }),
      ]),
    ).toBe("You have 2 new lectures, 1 lecture removed");
  });
});

describe("SyncDigest", () => {
  it("drain hands the items over and empties the digest", () => {
    const d = new SyncDigest(NOW);
    d.add(item());
    expect(d.size).toBe(1);
    expect(d.drain()).toHaveLength(1);
    expect(d.size).toBe(0);
  });

  it("lists one conflict check per (source, type) with written blocks", () => {
    const d = new SyncDigest(NOW);
    d.add(item({ sessionId: "a" }), "PORTAL");
    d.add(item({ sessionId: "b" }), "PORTAL");
    d.add(item({ type: "EXAM", sessionId: "c" }), "PORTAL");
    // Removals put nothing on the calendar, so nothing new can clash.
    d.add(
      item({ type: "ASSIGNMENT", kind: "removed", sessionId: null }),
      "LMS",
    );

    expect(d.conflictChecks()).toEqual([
      { source: "PORTAL", type: "LECTURE" },
      { source: "PORTAL", type: "EXAM" },
    ]);
    expect(d.startedAt).toBe(NOW);
    d.drain();
    expect(d.conflictChecks()).toEqual([]);
  });

  it("names the source in the title when every item shares one", () => {
    const d = new SyncDigest(NOW);
    d.add(item({ sessionId: "a" }), "PORTAL");
    d.add(item({ sessionId: "b" }), "PORTAL");
    d.add(
      item({ type: "ASSIGNMENT", kind: "removed", sessionId: null }),
      "LMS",
    );

    const titles = digestNotifications(d.drain(), NOW).map((n) => n.title);
    expect(titles).toEqual([
      "You have an assignment removed from LMS",
      "You have 2 new lectures from the portal",
    ]);
  });

  it("drops the source when a type's items came from different ones", () => {
    const d = new SyncDigest(NOW);
    d.add(item({ sessionId: "a" }), "PORTAL");
    d.add(item({ sessionId: "b" }), "LMS");

    const [n] = digestNotifications(d.drain(), NOW);
    expect(n.title).toBe("You have 2 new lectures");
  });
});
