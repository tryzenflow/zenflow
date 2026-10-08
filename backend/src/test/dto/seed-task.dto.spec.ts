import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SeedTaskDto } from "./seed-task.dto";

const errors = (body: object) =>
  validate(plainToInstance(SeedTaskDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const valid = {
  title: "E2E Seeded local-20261007-001",
  type: "TASK",
  deadline: "2026-10-09T12:00:00.000Z",
  durationMinutes: 60,
  sessionCount: 1,
  scheduledStartTime: "2026-10-07T12:00:00.000Z",
};

describe("SeedTaskDto", () => {
  it("accepts a fully-specified seed and one without sessionCount", async () => {
    expect(await errors(valid)).toHaveLength(0);
    const { title, type, deadline, durationMinutes, scheduledStartTime } =
      valid;
    expect(
      await errors({
        title,
        type,
        deadline,
        durationMinutes,
        scheduledStartTime,
      }),
    ).toHaveLength(0);
  });

  it.each([
    { ...valid, title: "" },
    { ...valid, type: "BLOCKED" },
    { ...valid, deadline: "tomorrow" },
    { ...valid, durationMinutes: 20 }, // off the 15-minute grid
    { ...valid, durationMinutes: 0 }, // below the grid
    { ...valid, durationMinutes: "60" }, // not an integer
    { ...valid, sessionCount: 0 },
    { ...valid, sessionCount: 1.5 },
    { ...valid, scheduledStartTime: undefined }, // live tasks always have a start
    { ...valid, scheduledStartTime: "noon" },
    { ...valid, unknown: 1 },
  ])("rejects %j", async (body) => {
    expect((await errors(body)).length).toBeGreaterThan(0);
  });
});
