import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { randomUUID } from "crypto";
import { ApnsSender } from "../src/devices/apns.sender";
import { FcmSender } from "../src/devices/fcm.sender";
import { PushProviderError, PushService } from "../src/devices/push.service";
import type { PushMessage, SendResult } from "../src/devices/types";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Push delivery against the real database with fake FCM / APNs senders: who a
 * notification is sent to, what is sent, what is pruned and when the queue job
 * must retry. (The real providers need Firebase / Apple credentials, so the two
 * senders are the only fakes; `PushService`, Prisma and Postgres are real.)
 */
jest.setTimeout(60_000);

type Sender = {
  enabled: boolean;
  send: jest.Mock<Promise<SendResult>, [string[], PushMessage]>;
};
const acceptAll = (tokens: string[]): Promise<SendResult> =>
  Promise.resolve({ sent: tokens.length, invalidTokens: [] });
const sender = (enabled = true): Sender => ({
  enabled,
  send: jest.fn<Promise<SendResult>, [string[], PushMessage]>(acceptAll),
});

let prisma: PrismaService;
let push: PushService;
let fcm: Sender;
let apns: Sender;

async function boot(opts: { fcm?: Sender; apns?: Sender } = {}) {
  fcm = opts.fcm ?? sender();
  apns = opts.apns ?? sender();
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
    providers: [
      PushService,
      PrismaService,
      { provide: FcmSender, useValue: fcm },
      { provide: ApnsSender, useValue: apns },
    ],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  push = moduleRef.get(PushService);
  return moduleRef;
}

let closeModule: () => Promise<void>;
beforeAll(async () => {
  const moduleRef = await boot();
  closeModule = () => moduleRef.close();
});
afterAll(async () => {
  // Cascades to devices, notifications and sessions.
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await closeModule();
});
beforeEach(() => {
  fcm.enabled = true;
  apns.enabled = true;
  fcm.send.mockClear();
  apns.send.mockClear();
  fcm.send.mockImplementation(acceptAll);
  apns.send.mockImplementation(acceptAll);
});

const createdUsers: string[] = [];

async function user(
  over: { allowNotifications?: boolean; lang?: "EN_US" | "VI_VN" } = {},
) {
  const created = await prisma.user.create({
    data: {
      name: "Push Student",
      email: `push-${randomUUID()}@example.test`,
      allowNotifications: over.allowNotifications ?? true,
      lang: over.lang ?? "EN_US",
    },
  });
  createdUsers.push(created.id);
  return created;
}
const device = (
  userId: string,
  platform: "ANDROID" | "IOS",
  token = randomUUID(),
) => prisma.userDevice.create({ data: { userId, platform, pushToken: token } });
const note = (userId: string, over: Record<string, unknown> = {}) =>
  prisma.notification.create({
    data: {
      userId,
      eventName: "assignment.created",
      title: "New assignment: Graph theory report",
      content: "Added from your LMS. Plan the work that leads up to it.",
      sessionId: null,
      ...over,
    },
  });
const tokensOf = (userId: string) =>
  prisma.userDevice
    .findMany({ where: { userId } })
    .then((rows) => rows.map((r) => r.pushToken).sort());

describe("routing", () => {
  it("sends Android tokens through FCM and iOS tokens through APNs, with the notification's details", async () => {
    const u = await user();
    const a = await device(u.id, "ANDROID");
    const i = await device(u.id, "IOS");
    const n = await note(u.id);
    await push.sendToUser(u.id, n);
    expect(fcm.send).toHaveBeenCalledTimes(1);
    expect(fcm.send.mock.calls[0][0]).toEqual([a.pushToken]);
    expect(apns.send).toHaveBeenCalledTimes(1);
    expect(apns.send.mock.calls[0][0]).toEqual([i.pushToken]);
    expect(fcm.send.mock.calls[0][1]).toMatchObject({
      title: "New assignment: Graph theory report",
      body: "Added from your LMS. Plan the work that leads up to it.",
      data: {
        notificationId: n.id,
        eventName: "assignment.created",
        url: "/notifications",
      },
    });
  });

  it("links a notification about a session to that session on the calendar", async () => {
    const u = await user();
    await device(u.id, "ANDROID");
    const session = await prisma.session.create({
      data: {
        userId: u.id,
        title: "Lab",
        type: "LECTURE",
        durationMinutes: 60,
        scheduledStartTime: new Date(Date.now() + 86_400_000),
      },
    });
    await push.sendToUser(u.id, await note(u.id, { sessionId: session.id }));
    expect(fcm.send.mock.calls[0][1].data).toMatchObject({
      sessionId: session.id,
      url: `/calendar?session=${session.id}`,
    });
  });

  it("a per-provider job only touches that provider", async () => {
    const u = await user();
    await device(u.id, "ANDROID");
    await device(u.id, "IOS");
    const n = await note(u.id);
    await push.deliver(n.id, { provider: "fcm" });
    expect(fcm.send).toHaveBeenCalledTimes(1);
    expect(apns.send).not.toHaveBeenCalled();
    await push.deliver(n.id, { provider: "apns" });
    expect(apns.send).toHaveBeenCalledTimes(1);
    expect(fcm.send).toHaveBeenCalledTimes(1);
  });

  it("reaches every device a student has registered on a platform", async () => {
    const u = await user();
    await device(u.id, "ANDROID");
    await device(u.id, "ANDROID");
    await push.sendToUser(u.id, await note(u.id));
    expect(fcm.send.mock.calls[0][0]).toHaveLength(2);
  });

  it("never sends one student's notification to another student's device", async () => {
    const a = await user();
    const b = await user();
    await device(a.id, "ANDROID");
    const bToken = (await device(b.id, "ANDROID")).pushToken;
    await push.sendToUser(a.id, await note(a.id));
    expect(fcm.send.mock.calls[0][0]).not.toContain(bToken);
  });
});

describe("when not to send", () => {
  it("sends nothing to a student who turned notifications off", async () => {
    const u = await user({ allowNotifications: false });
    await device(u.id, "ANDROID");
    await push.sendToUser(u.id, await note(u.id));
    expect(fcm.send).not.toHaveBeenCalled();
  });

  it("is a quiet no-op for a student with no devices", async () => {
    const u = await user();
    await expect(
      push.sendToUser(u.id, await note(u.id)),
    ).resolves.toBeUndefined();
    expect(fcm.send).not.toHaveBeenCalled();
    expect(apns.send).not.toHaveBeenCalled();
  });

  it("is a quiet no-op when no provider is configured", async () => {
    fcm.enabled = false;
    apns.enabled = false;
    const u = await user();
    await device(u.id, "ANDROID");
    await expect(
      push.sendToUser(u.id, await note(u.id)),
    ).resolves.toBeUndefined();
    expect(fcm.send).not.toHaveBeenCalled();
  });

  it("skips an unconfigured provider but still uses the other", async () => {
    apns.enabled = false;
    const u = await user();
    await device(u.id, "ANDROID");
    await device(u.id, "IOS");
    await push.sendToUser(u.id, await note(u.id));
    expect(fcm.send).toHaveBeenCalledTimes(1);
    expect(apns.send).not.toHaveBeenCalled();
  });
});

describe("the message", () => {
  it("is in the student's language", async () => {
    const u = await user({ lang: "VI_VN" });
    await device(u.id, "ANDROID");
    await push.sendToUser(u.id, await note(u.id));
    expect(fcm.send.mock.calls[0][1].title).toBe(
      "Bài tập mới: Graph theory report",
    );
  });

  it("is left as written for an English student", async () => {
    const u = await user({ lang: "EN_US" });
    await device(u.id, "ANDROID");
    await push.sendToUser(u.id, await note(u.id));
    expect(fcm.send.mock.calls[0][1].title).toBe(
      "New assignment: Graph theory report",
    );
  });
});

describe("dead tokens and failures", () => {
  it("deletes the tokens a provider reports dead and keeps the rest", async () => {
    const u = await user();
    const dead = await device(u.id, "ANDROID");
    const live = await device(u.id, "ANDROID");
    fcm.send.mockResolvedValue({ sent: 1, invalidTokens: [dead.pushToken] });
    await push.sendToUser(u.id, await note(u.id));
    expect(await tokensOf(u.id)).toEqual([live.pushToken]);
  });

  it("treats a partial success as delivered", async () => {
    const u = await user();
    await device(u.id, "ANDROID");
    await device(u.id, "ANDROID");
    fcm.send.mockResolvedValue({ sent: 1, invalidTokens: [] });
    await expect(
      push.sendToUser(u.id, await note(u.id)),
    ).resolves.toBeUndefined();
  });

  it("fails the job when a provider took nothing, so the queue retries it", async () => {
    const u = await user();
    await device(u.id, "ANDROID");
    fcm.send.mockResolvedValue({ sent: 0, invalidTokens: [] });
    await expect(
      push.sendToUser(u.id, await note(u.id)),
    ).rejects.toBeInstanceOf(PushProviderError);
  });

  it("still prunes one provider's dead tokens when the other one fails", async () => {
    const u = await user();
    const dead = await device(u.id, "ANDROID");
    const ios = await device(u.id, "IOS");
    fcm.send.mockResolvedValue({ sent: 0, invalidTokens: [dead.pushToken] });
    apns.send.mockResolvedValue({ sent: 0, invalidTokens: [] });
    await expect(
      push.sendToUser(u.id, await note(u.id)),
    ).rejects.toBeInstanceOf(PushProviderError);
    expect(await tokensOf(u.id)).toEqual([ios.pushToken]);
  });

  it("fails the job for a notification that doesn't exist (yet), so the retry finds it", async () => {
    await expect(
      push.deliver(randomUUID(), { provider: "fcm" }),
    ).rejects.toThrow(/not found/);
  });
});
