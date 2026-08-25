import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type User } from "../../generated/prisma";
import type { TagsListResponse } from "@zenflow/shared";

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A user's existing tags, name-sorted, for the create/edit combobox. */
  async list(user: User): Promise<TagsListResponse> {
    const tags = await this.prisma.tag.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return { tags };
  }

  async resolveTagIds(
    tx: Prisma.TransactionClient,
    userId: string,
    names: string[],
  ): Promise<string[]> {
    const cleaned = Array.from(
      new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)),
    );
    if (cleaned.length === 0) return [];

    await tx.tag.createMany({
      data: cleaned.map((name) => ({ userId, name })),
      skipDuplicates: true,
    });
    const tags = await tx.tag.findMany({
      where: { userId, name: { in: cleaned } },
      select: { id: true },
    });
    return tags.map((t) => t.id);
  }
}
