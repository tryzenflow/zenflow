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
