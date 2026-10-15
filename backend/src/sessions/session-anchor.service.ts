import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Session as SharedSession, SessionAnchor } from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { toSessionDto } from "./session-mapper";
import { WITH_TAGS_AND_SERIES } from "./types/session-row";

/**
 * `POST /sessions/:id/pin` and `DELETE /sessions/:id/pin` (ADR-0022): a
 * pinned task is never moved by the scheduler; unpinning returns it to `AUTO`.
 */
@Injectable()
export class SessionAnchorService {
  constructor(private readonly prisma: PrismaService) {}

  pin(id: string, user: User): Promise<SharedSession> {
    return this.setAnchor(id, "PINNED", user);
  }

  unpin(id: string, user: User): Promise<SharedSession> {
    return this.setAnchor(id, "AUTO", user);
  }

  private async setAnchor(
    id: string,
    anchor: SessionAnchor,
    user: User,
  ): Promise<SharedSession> {
    const existing = await this.prisma.session.findFirst({
      where: { id, userId: user.id, deleted: false },
      select: { id: true, type: true },
    });
    if (!existing) {
      throw new NotFoundException(`Cannot find session with id ${id}`);
    }
    if (anchor === "PINNED" && existing.type !== "TASK") {
      throw new BadRequestException(
        "Only tasks can be pinned\nFixed sessions never move.",
      );
    }
    const row = await this.prisma.session.update({
      where: { id },
      data: { anchor, anchoredAt: anchor === "AUTO" ? null : new Date() },
      include: WITH_TAGS_AND_SERIES,
    });
    return toSessionDto(row);
  }
}
