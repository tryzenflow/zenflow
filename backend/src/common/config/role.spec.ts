import { getRole, runsHttp, runsJobs } from "./role";

describe("getRole", () => {
  it("defaults to all and ignores unknown values", () => {
    expect(getRole({})).toBe("all");
    expect(getRole({ ROLE: "nope" })).toBe("all");
  });

  it("api serves HTTP only, worker runs jobs only, all does both", () => {
    expect([runsHttp("api"), runsJobs("api")]).toEqual([true, false]);
    expect([runsHttp("worker"), runsJobs("worker")]).toEqual([false, true]);
    expect([runsHttp("all"), runsJobs("all")]).toEqual([true, true]);
    expect(getRole({ ROLE: "worker" })).toBe("worker");
  });
});
