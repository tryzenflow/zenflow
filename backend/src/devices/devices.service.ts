import { Injectable } from "@nestjs/common";
import type { RegisterDeviceInput } from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The native-push device registry.
 *
 * One row per (device, provider), keyed by the opaque `pushToken`. Rows are
 * also removed by {@link PushService} when a provider reports a token dead.
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /devices` — register this device, or refresh an existing row.
   *
   * Upserts on the unique `pushToken`, so a token that has moved to a new user
   * (a shared handset, a reinstall) re-homes to the caller instead of hitting a
   * unique-constraint error. `lastSeenAt` is the only activity kept.
   */
  async registerDevice(
    user: User,
    dto: RegisterDeviceInput,
  ): Promise<{ id: string }> {
    const now = new Date();
    const row = await this.prisma.userDevice.upsert({
      where: { pushToken: dto.pushToken },
      create: {
        platform: dto.platform,
        pushToken: dto.pushToken,
        userId: user.id,
        lastSeenAt: now,
      },
      update: { platform: dto.platform, userId: user.id, lastSeenAt: now },
      select: { id: true },
    });
    return { id: row.id };
  }

  /**
   * `DELETE /devices` — drop this device. Scoped to the caller and idempotent:
   * another user's token, or one already gone, is a no-op rather than a 404.
   */
  async unregisterDevice(
    user: User,
    pushToken: string,
  ): Promise<{ pushToken: string }> {
    await this.prisma.userDevice.deleteMany({
      where: { pushToken, userId: user.id },
    });
    return { pushToken };
  }
}
