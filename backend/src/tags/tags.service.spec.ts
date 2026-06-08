import { TagsService } from "./tags.service";
import type { User } from "../../generated/prisma";

const user = { id: "user-1" } as User;

describe("TagsService.list", () => {
  it("returns the user's tags name-sorted, wrapped in { tags }", async () => {
    const rows = [
      { id: "t1", name: "admin" },
      { id: "t2", name: "work" },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { tag: { findMany } };
    const service = new TagsService(prisma as never);

    const res = await service.list(user);

    expect(res).toEqual({ tags: rows });
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  });

  it("returns an empty list when the user has no tags", async () => {
    const prisma = { tag: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new TagsService(prisma as never);

    const res = await service.list(user);

    expect(res).toEqual({ tags: [] });
  });
});
