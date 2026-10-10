/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { Notification } from "../../generated/prisma";
import {
  NOTIFICATION_CHANNEL,
  NotificationPubSub,
  reviveNotification,
} from "./notification-pubsub.service";

type Listener = (...args: string[]) => void;
const instances: FakeRedis[] = [];

class FakeRedis {
  handlers: Record<string, Listener> = {};
  publish = jest.fn().mockResolvedValue(1);
  subscribe = jest.fn().mockResolvedValue(1);
  disconnect = jest.fn();
  constructor(public opts: Record<string, unknown>) {
    instances.push(this);
  }
  on(event: string, fn: Listener) {
    this.handlers[event] = fn;
    return this;
  }
}

jest.mock("ioredis", () => ({
  __esModule: true,
  default: jest.fn((opts: Record<string, unknown>) => new FakeRedis(opts)),
}));

const ROW = {
  id: "n1",
  userId: "u1",
  title: "t",
  content: "c",
  eventName: "exam.created",
  sentAt: new Date("2026-01-01T00:00:00Z"),
  readAt: null,
  actionTakenAt: null,
  eventEndsAt: new Date("2026-01-02T00:00:00Z"),
  sessionId: null,
} as unknown as Notification;

const make = async (cfg: Record<string, unknown>) => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      NotificationPubSub,
      {
        provide: ConfigService,
        useValue: new ConfigService({ NODE_ENV: "test", ...cfg }),
      },
    ],
  }).compile();
  return moduleRef.get(NotificationPubSub);
};

describe("NotificationPubSub", () => {
  beforeEach(() => (instances.length = 0));

  it("without REDIS_PUBSUB_HOST emits locally and opens no connection", async () => {
    const ps = await make({});
    const seen = jest.fn();
    ps.emitter.on("e", seen);
    await ps.publish("e", ROW);
    ps.onModuleInit();
    expect(seen).toHaveBeenCalledWith(ROW);
    expect(instances).toHaveLength(0);
    expect(ps.distributed).toBe(false);
  });

  it("publishes JSON to the channel instead of emitting locally", async () => {
    const ps = await make({ REDIS_PUBSUB_HOST: "x", REDIS_PUBSUB_PORT: 6382 });
    const seen = jest.fn();
    ps.emitter.on("e", seen);
    await ps.publish("e", ROW);
    expect(instances[0].publish).toHaveBeenCalledWith(
      NOTIFICATION_CHANNEL,
      JSON.stringify({ event: "e", id: "n1", row: ROW }),
    );
    expect(seen).not.toHaveBeenCalled();
  });

  it("the publisher fails fast (no offline queue, short timeout)", async () => {
    await make({ REDIS_PUBSUB_HOST: "x", REDIS_PUBSUB_TIMEOUT_MS: 100 });
    // Never lazy (even under NODE_ENV=test): a lazy publisher would reject its first publish.
    expect(instances[0].opts.lazyConnect).toBeUndefined();
    expect(instances[0].opts).toMatchObject({
      commandTimeout: 100,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  });

  it("falls back to a local emit and does not throw when Redis is down", async () => {
    const ps = await make({ REDIS_PUBSUB_HOST: "x" });
    instances[0].publish.mockRejectedValue(new Error("down"));
    const seen = jest.fn();
    ps.emitter.on("e", seen);
    await expect(ps.publish("e", ROW)).resolves.toBeUndefined();
    expect(seen).toHaveBeenCalledWith(ROW);
  });

  it("an HTTP process subscribes and re-emits with Dates revived", async () => {
    const ps = await make({ REDIS_PUBSUB_HOST: "x", ROLE: "api" });
    ps.onModuleInit();
    const sub = instances[1];
    sub.handlers.ready();
    expect(sub.subscribe).toHaveBeenCalledWith(NOTIFICATION_CHANNEL);
    const seen = jest.fn();
    ps.emitter.on("session.new", seen);

    sub.handlers.message(
      NOTIFICATION_CHANNEL,
      JSON.stringify({ event: "session.new", row: ROW }),
    );

    const got = seen.mock.calls[0][0] as Notification;
    expect(got.sentAt).toBeInstanceOf(Date);
    expect(got.eventEndsAt).toEqual(ROW.eventEndsAt);
    expect(got.readAt).toBeNull();
  });

  it("a worker role never subscribes", async () => {
    const ps = await make({
      REDIS_PUBSUB_HOST: "x",
      ROLE: "worker-notify",
    });
    ps.onModuleInit();
    expect(instances).toHaveLength(1); // publisher only
  });

  it("ignores a malformed message", async () => {
    const ps = await make({ REDIS_PUBSUB_HOST: "x", ROLE: "all" });
    ps.onModuleInit();
    expect(() => instances[1].handlers.message("c", "{nope")).not.toThrow();
  });

  it("closes both connections on destroy", async () => {
    const ps = await make({ REDIS_PUBSUB_HOST: "x", ROLE: "api" });
    ps.onModuleInit();
    ps.onApplicationShutdown();
    expect(instances.every((i) => i.disconnect.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("reviveNotification leaves non-string dates alone", () => {
    expect(reviveNotification({ sentAt: null }).sentAt).toBeNull();
  });
});
