import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateTaskDto } from "./create-task.dto";
import { UpdateTaskDto } from "./update-task.dto";

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

describe("CreateTaskDto — title word limit", () => {
  it("accepts a title of exactly 60 words", async () => {
    const dto = plainToInstance(CreateTaskDto, {
      title: words(60),
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects a title of 61 words", async () => {
    const dto = plainToInstance(CreateTaskDto, {
      title: words(61),
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "title")).toBe(true);
    expect(errors.find((e) => e.property === "title")?.constraints).toEqual(
      expect.objectContaining({ maxWords: "Title must be at most 60 words." }),
    );
  });
});

describe("UpdateTaskDto — title word limit", () => {
  it("accepts an omitted title (unchanged)", async () => {
    const dto = plainToInstance(UpdateTaskDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts a title of exactly 60 words", async () => {
    const dto = plainToInstance(UpdateTaskDto, { title: words(60) });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects a title of 61 words", async () => {
    const dto = plainToInstance(UpdateTaskDto, { title: words(61) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "title")).toBe(true);
  });
});
