import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { CourseColoursService } from "./course-colours.service";

const user = { id: "u1" } as User;

describe("CourseColoursService", () => {
  let service: CourseColoursService;
  const courseColour = {
    findMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CourseColoursService,
        { provide: PrismaService, useValue: { courseColour } },
      ],
    }).compile();
    service = moduleRef.get(CourseColoursService);
  });

  it("lists the user's picks scoped to their id", async () => {
    courseColour.findMany.mockResolvedValue([
      { courseKey: "lms:1", swatch: 2 },
    ]);
    await expect(service.list(user)).resolves.toEqual({
      colours: [{ courseKey: "lms:1", swatch: 2 }],
    });
    expect(courseColour.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } }),
    );
  });

  it("upserts on the (userId, courseKey) pair", async () => {
    courseColour.upsert.mockResolvedValue({ courseKey: "lms:1", swatch: 4 });
    await expect(service.set(user, "lms:1", 4)).resolves.toEqual({
      courseKey: "lms:1",
      swatch: 4,
    });
    expect(courseColour.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_courseKey: { userId: "u1", courseKey: "lms:1" } },
        create: { userId: "u1", courseKey: "lms:1", swatch: 4 },
        update: { swatch: 4 },
      }),
    );
  });

  it("accepts a portal course key", async () => {
    courseColour.upsert.mockResolvedValue({
      courseKey: "portal:99910AB100101",
      swatch: 0,
    });
    await service.set(user, "portal:99910AB100101", 0);
    expect(courseColour.upsert).toHaveBeenCalled();
  });

  it.each([12, -1, 1.5, Number.NaN])(
    "rejects swatch %p without writing",
    async (swatch) => {
      await expect(service.set(user, "lms:1", swatch)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(courseColour.upsert).not.toHaveBeenCalled();
    },
  );

  it.each(["", "lms:", "lms:1 2", "moodle:1", "portal:" + "x".repeat(111)])(
    "rejects course key %p without writing",
    async (courseKey) => {
      await expect(service.set(user, courseKey, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.reset(user, courseKey)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(courseColour.upsert).not.toHaveBeenCalled();
      expect(courseColour.deleteMany).not.toHaveBeenCalled();
    },
  );

  it("resets by deleting the user's own row", async () => {
    courseColour.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.reset(user, "lms:1")).resolves.toEqual({
      courseKey: "lms:1",
    });
    expect(courseColour.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", courseKey: "lms:1" },
    });
  });
});
