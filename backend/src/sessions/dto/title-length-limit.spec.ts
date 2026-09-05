import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateSessionDto } from "./create-session.dto";
import { UpdateSessionDto } from "./update-session.dto";

const chars = (n: number) => "a".repeat(n);
// Always well beyond `Date.now()` — not this spec's concern (feasibility is
// covered by feasible-task-window.decorator.spec.ts) — so it never trips the
// deadline's `@IsFeasibleTaskWindow` check regardless of when this runs.
const FAR_FUTURE_DEADLINE = new Date(
  Date.now() + 365 * 24 * 60 * 60 * 1000,
).toISOString();

describe("CreateSessionDto — title character limit", () => {
  it("accepts a title of exactly 60 characters", async () => {
    const dto = plainToInstance(CreateSessionDto, {
      type: "TASK",
      title: chars(60),
      durationMinutes: 30,
      deadline: FAR_FUTURE_DEADLINE,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects a title of 61 characters", async () => {
    const dto = plainToInstance(CreateSessionDto, {
      type: "TASK",
      title: chars(61),
      durationMinutes: 30,
      deadline: FAR_FUTURE_DEADLINE,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "title")).toBe(true);
    expect(errors.find((e) => e.property === "title")?.constraints).toEqual(
      expect.objectContaining({
        maxLength: "Title must be at most 60 characters.",
      }),
    );
  });
});

describe("UpdateSessionDto — title character limit", () => {
  it("accepts an omitted title (unchanged)", async () => {
    const dto = plainToInstance(UpdateSessionDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts a title of exactly 60 characters", async () => {
    const dto = plainToInstance(UpdateSessionDto, { title: chars(60) });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects a title of 61 characters", async () => {
    const dto = plainToInstance(UpdateSessionDto, { title: chars(61) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "title")).toBe(true);
  });
});
