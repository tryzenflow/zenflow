import {
  consumesQueue,
  getRole,
  runsHttp,
  runsJobs,
  runsWatcher,
} from "./role";

describe("getRole", () => {
  it("defaults to all and ignores unknown values", () => {
    expect(getRole({})).toBe("all");
    expect(getRole({ ROLE: "nope" })).toBe("all");
  });

  it("parses every role", () => {
    for (const r of [
      "api",
      "watcher",
      "worker-portal",
      "worker-lms",
      "worker-notify",
      "worker",
      "all",
    ]) {
      expect(getRole({ ROLE: r })).toBe(r);
    }
  });

  it("only api and all serve HTTP", () => {
    expect(runsHttp("api")).toBe(true);
    expect(runsHttp("all")).toBe(true);
    for (const r of [
      "watcher",
      "worker",
      "worker-portal",
      "worker-lms",
      "worker-notify",
    ] as const) {
      expect(runsHttp(r)).toBe(false);
    }
  });

  it("api runs no jobs; only watcher/worker/all run the cron heartbeat", () => {
    expect(runsJobs("api")).toBe(false);
    expect(runsWatcher("api")).toBe(false);
    expect(runsWatcher("watcher")).toBe(true);
    expect(runsWatcher("worker")).toBe(true);
    expect(runsWatcher("all")).toBe(true);
    expect(runsWatcher("worker-portal")).toBe(false);
    expect(runsWatcher("worker-notify")).toBe(false);
  });

  it("maps consumer roles to their queue; the watcher consumes nothing", () => {
    expect(consumesQueue("worker-portal", "portal-fetch")).toBe(true);
    expect(consumesQueue("worker-portal", "lms-fetch")).toBe(false);
    expect(consumesQueue("worker-lms", "lms-fetch")).toBe(true);
    expect(consumesQueue("worker-notify", "notify")).toBe(true);
    expect(consumesQueue("worker-notify", "portal-fetch")).toBe(false);
    expect(consumesQueue("watcher", "notify")).toBe(false);
    expect(consumesQueue("api", "notify")).toBe(false);
    for (const q of ["portal-fetch", "lms-fetch", "notify"] as const) {
      expect(consumesQueue("all", q)).toBe(true);
      expect(consumesQueue("worker", q)).toBe(true);
    }
  });
});
