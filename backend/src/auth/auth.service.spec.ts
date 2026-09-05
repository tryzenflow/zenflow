/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { AuthService } from "./auth.service";
import type { User } from "../../generated/prisma";

/**
 * Focused coverage for `AuthService.createUserIfNotExists`'s new-user seeding:
 * a brand-new signup gets 4 default recurring DND blocks (breakfast, lunch,
 * evening chill/dinner, sleep) via `SessionsService.create`; an existing user
 * logging back in gets none (re)created; and a seeding failure never bubbles
 * up past `createUserIfNotExists` (best-effort, per CLAUDE.md invariant on
 * OTP/session flows never breaking on non-critical side effects).
 */

const newUser: User = {
  id: "user-1",
  name: "New User",
  email: "new@example.com",
  timezone: "UTC",
  lang: "EN_US",
  preferenceMatrix: [],
  preferenceMatrixDecayedAt: null,
  createdAt: new Date("2026-09-05T00:00:00.000Z"),
  updatedAt: new Date("2026-09-05T00:00:00.000Z"),
} as unknown as User;

function makeService(overrides?: {
  findByEmail?: jest.Mock;
  create?: jest.Mock;
  sessionsCreate?: jest.Mock;
}) {
  const usersService = {
    findByEmail: overrides?.findByEmail ?? jest.fn().mockResolvedValue(null),
    create: overrides?.create ?? jest.fn().mockResolvedValue(newUser),
  };
  const mailService = { sendLoginEmail: jest.fn() };
  const sessionsService = {
    create: overrides?.sessionsCreate ?? jest.fn().mockResolvedValue({}),
  };
  const cacheManager = { set: jest.fn(), get: jest.fn(), del: jest.fn() };

  const service = new AuthService(
    cacheManager as never,
    usersService as never,
    mailService as never,
    sessionsService as never,
  );
  return { service, usersService, mailService, sessionsService };
}

describe("AuthService.createUserIfNotExists", () => {
  beforeEach(() => {
    // `seedDefaultDndBlocks` anchors "today" off the real clock — freeze it
    // so the expected ISO instants below are deterministic regardless of
    // when the suite actually runs.
    jest.useFakeTimers().setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("seeds exactly 4 default DND blocks with the right times/rrule for a brand-new user", async () => {
    const { service, sessionsService } = makeService();

    const result = await service.createUserIfNotExists(
      "new@example.com",
      "UTC",
    );

    expect(result).toBe(newUser);
    expect(sessionsService.create).toHaveBeenCalledTimes(4);

    const calls = sessionsService.create.mock.calls.map((c) => c[0]);
    expect(calls.every((dto) => dto.type === "DND")).toBe(true);
    expect(calls.every((dto) => dto.rrule === "FREQ=DAILY")).toBe(true);
    expect(
      sessionsService.create.mock.calls.every((c) => c[1] === newUser),
    ).toBe(true);

    expect(calls).toEqual([
      expect.objectContaining({
        title: "Breakfast",
        durationMinutes: 60,
        scheduledStartTime: "2026-09-05T06:00:00.000Z",
      }),
      expect.objectContaining({
        title: "Lunch & rest",
        durationMinutes: 120,
        scheduledStartTime: "2026-09-05T11:00:00.000Z",
      }),
      expect.objectContaining({
        title: "Evening chill & dinner",
        durationMinutes: 120,
        scheduledStartTime: "2026-09-05T17:00:00.000Z",
      }),
      expect.objectContaining({
        title: "Sleep",
        durationMinutes: 480,
        scheduledStartTime: "2026-09-05T22:00:00.000Z",
      }),
    ]);
  });

  it("does NOT (re)create any sessions for an existing user logging in again", async () => {
    const existing = { ...newUser, id: "user-existing" };
    const { service, sessionsService, usersService } = makeService({
      findByEmail: jest.fn().mockResolvedValue(existing),
    });

    const result = await service.createUserIfNotExists(
      "existing@example.com",
      "UTC",
    );

    expect(result).toBe(existing);
    expect(usersService.create).not.toHaveBeenCalled();
    expect(sessionsService.create).not.toHaveBeenCalled();
  });

  it("still returns the created user when seeding throws — signup is never broken by a seeding failure", async () => {
    const { service, sessionsService } = makeService({
      sessionsCreate: jest.fn().mockRejectedValue(new Error("boom")),
    });

    const result = await service.createUserIfNotExists(
      "new@example.com",
      "UTC",
    );

    expect(result).toBe(newUser);
    // All 4 blocks are attempted independently — one failing doesn't stop
    // the others.
    expect(sessionsService.create).toHaveBeenCalledTimes(4);
  });
});
