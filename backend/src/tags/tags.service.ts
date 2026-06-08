import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { type User } from "../../generated/prisma";
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
}
