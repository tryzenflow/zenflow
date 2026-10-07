import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "./tags.service";
import type { User } from "../../generated/prisma";

const user = { id: "user-1" } as User;

async function makeService(findMany: jest.Mock) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TagsService,
      { provide: PrismaService, useValue: { tag: { findMany } } },
    ],
  }).compile();
  return module.get<TagsService>(TagsService);
}

describe("TagsService.list", () => {
  it("returns the user's tags name-sorted, wrapped in { tags }", async () => {
    const rows = [
      { id: "t1", name: "admin" },
      { id: "t2", name: "work" },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const service = await makeService(findMany);

    const res = await service.list(user);

    expect(res).toEqual({ tags: rows });
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  });

  it("returns an empty list when the user has no tags", async () => {
    const service = await makeService(jest.fn().mockResolvedValue([]));

    const res = await service.list(user);

    expect(res).toEqual({ tags: [] });
  });
});

describe("TagsService.bulkCreate", () => {
  it("trims, dedupes, skips duplicates and returns the tags", async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const findMany = jest.fn().mockResolvedValue([{ id: "t1", name: "Exam" }]);
    const module = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: { tag: { createMany, findMany } } },
      ],
    }).compile();
    const service = module.get(TagsService);

    const res = await service.bulkCreate(user, [" Exam ", "Exam", "", "Lab"]);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", name: "Exam" },
        { userId: "user-1", name: "Lab" },
      ],
      skipDuplicates: true,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", name: { in: ["Exam", "Lab"] } },
      }),
    );
    expect(res.tags).toHaveLength(1);
  });

  it("does nothing for blank-only input", async () => {
    const createMany = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: { tag: { createMany } } },
      ],
    }).compile();
    const res = await module.get(TagsService).bulkCreate(user, ["  "]);
    expect(res).toEqual({ tags: [] });
    expect(createMany).not.toHaveBeenCalled();
  });
});
