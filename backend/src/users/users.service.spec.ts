import { BadRequestException } from "@nestjs/common";
import { UsersService } from "./users.service";
import type { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import type { User } from "../../generated/prisma";

const user = { id: "user-1" } as User;

const basePrefs: UpdatePreferencesDto = {
  workStart: 540,
  workEnd: 1020,
  workDays: [1, 2, 3, 4, 5],
  timezone: "Asia/Ho_Chi_Minh",
};

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };

function makeService() {
  const update = jest.fn(
    (args: UpdateArgs): { id: string } & Record<string, unknown> => ({
      id: user.id,
      ...args.data,
    }),
  );
  const prisma = { user: { update } };
  const rescheduleAll = jest.fn().mockResolvedValue(undefined);
  const scheduler = { rescheduleAll };
  const service = new UsersService(prisma as never, scheduler as never);
  return { service, update, rescheduleAll };
}

describe("UsersService.updatePreferences", () => {
  it("persists the schedule and re-schedules all tasks", async () => {
    const { service, update, rescheduleAll } = makeService();

    const result = await service.updatePreferences(user, { ...basePrefs });

    expect(update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        workStart: 540,
        workEnd: 1020,
        workDays: [1, 2, 3, 4, 5],
        timezone: "Asia/Ho_Chi_Minh",
      },
    });
    expect(rescheduleAll).toHaveBeenCalledWith(result);
  });

  it("leaves roleArchetypeId untouched when the key is omitted", async () => {
    const { service, update } = makeService();

    await service.updatePreferences(user, { ...basePrefs });

    const { data } = update.mock.calls[0][0];
    expect("roleArchetypeId" in data).toBe(false);
  });

  it("updates roleArchetypeId when a value is provided", async () => {
    const { service, update } = makeService();

    await service.updatePreferences(user, {
      ...basePrefs,
      roleArchetypeId: "night-owl-dev",
    });

    const { data } = update.mock.calls[0][0];
    expect(data.roleArchetypeId).toBe("night-owl-dev");
  });

  it("clears roleArchetypeId when null is provided", async () => {
    const { service, update } = makeService();

    await service.updatePreferences(user, {
      ...basePrefs,
      roleArchetypeId: null,
    });

    const { data } = update.mock.calls[0][0];
    expect("roleArchetypeId" in data).toBe(true);
    expect(data.roleArchetypeId).toBeNull();
  });

  it("rejects an empty window where workStart equals workEnd", async () => {
    const { service, update } = makeService();

    await expect(
      service.updatePreferences(user, {
        ...basePrefs,
        workStart: 540,
        workEnd: 540,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a window shorter than one hour", async () => {
    const { service, update } = makeService();

    await expect(
      service.updatePreferences(user, {
        ...basePrefs,
        workStart: 540,
        workEnd: 570,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts a valid overnight (cross-midnight) window", async () => {
    const { service, update, rescheduleAll } = makeService();

    // 22:00 → 04:00 = 360 effective minutes (a night-owl shift).
    await service.updatePreferences(user, {
      ...basePrefs,
      workStart: 1320,
      workEnd: 240,
    });

    expect(update).toHaveBeenCalled();
    expect(rescheduleAll).toHaveBeenCalled();
  });

  it("rejects a wrap window shorter than one hour", async () => {
    const { service, update } = makeService();

    // 23:45 → 00:15 = 30 effective minutes (wraps, but under MIN_WORKDAY).
    await expect(
      service.updatePreferences(user, {
        ...basePrefs,
        workStart: 1425,
        workEnd: 15,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});
