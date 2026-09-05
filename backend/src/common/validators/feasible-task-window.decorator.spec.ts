import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateSessionDto } from "../../sessions/dto/create-session.dto";

/**
 * `@IsFeasibleTaskWindow` — the coarse `now + duration × sessionCount >
 * deadline` guard on `CreateSessionDto.deadline` (issue #33).
 */

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

const MIN = 60_000;

async function deadlineErrors(dto: CreateSessionDto) {
  const errors = await validate(plainToInstance(CreateSessionDto, dto));
  return errors.filter((e) => e.property === "deadline");
}

describe("IsFeasibleTaskWindow", () => {
  it("accepts a single TASK with enough room before its deadline", async () => {
    const errors = await deadlineErrors({
      type: "TASK",
      title: "Write report",
      durationMinutes: 30,
      deadline: isoIn(2 * 60 * MIN),
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects a single TASK whose duration doesn't fit before the deadline", async () => {
    const errors = await deadlineErrors({
      type: "TASK",
      title: "Write report",
      durationMinutes: 60,
      deadline: isoIn(30 * MIN),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.IsFeasibleTaskWindow).toContain("Won't fit");
    // Title/description are "\n"-split for the mobile toast (splitToastMessage).
    expect(errors[0].constraints?.IsFeasibleTaskWindow).toContain("\n");
  });

  it("accounts for sessionCount — 3 × 60min fits inside a 4h window", async () => {
    const errors = await deadlineErrors({
      type: "TASK",
      title: "Exam prep",
      durationMinutes: 60,
      sessionCount: 3,
      deadline: isoIn(4 * 60 * MIN),
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects a series whose sessionCount can't fit even back-to-back before the deadline", async () => {
    const errors = await deadlineErrors({
      type: "TASK",
      title: "Exam prep",
      durationMinutes: 60,
      sessionCount: 3,
      deadline: isoIn(2 * 60 * MIN), // needs 3h, only has 2h
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.IsFeasibleTaskWindow).toContain("3 sessions");
  });

  it("does not run for a fixed type (no deadline at all)", async () => {
    const errors = await deadlineErrors({
      type: "ASSIGNMENT",
      title: "Essay",
      durationMinutes: 90,
      scheduledStartTime: isoIn(60 * MIN),
    });
    expect(errors).toHaveLength(0);
  });

  it("leaves a malformed deadline to @IsISO8601 (doesn't double-report)", async () => {
    const errors = await deadlineErrors({
      type: "TASK",
      title: "X",
      durationMinutes: 30,
      deadline: "not-a-date",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isIso8601).toEqual(expect.any(String));
    expect(errors[0].constraints?.IsFeasibleTaskWindow).toBeUndefined();
  });
});
