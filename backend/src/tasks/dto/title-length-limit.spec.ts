import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateTaskDto } from "./create-task.dto";
import { UpdateTaskDto } from "./update-task.dto";

const chars = (n: number) => "a".repeat(n);

describe("CreateTaskDto — title character limit", () => {
  it("accepts a title of exactly 60 characters", async () => {
    const dto = plainToInstance(CreateTaskDto, {
      title: chars(60),
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects a title of 61 characters", async () => {
    const dto = plainToInstance(CreateTaskDto, {
      title: chars(61),
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
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

describe("UpdateTaskDto — title character limit", () => {
  it("accepts an omitted title (unchanged)", async () => {
    const dto = plainToInstance(UpdateTaskDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts a title of exactly 60 characters", async () => {
    const dto = plainToInstance(UpdateTaskDto, { title: chars(60) });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects a title of 61 characters", async () => {
    const dto = plainToInstance(UpdateTaskDto, { title: chars(61) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "title")).toBe(true);
  });
});
