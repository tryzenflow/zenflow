/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ApnsSender } from "./apns.sender";
import type { PushMessage } from "./types";

const send = jest.fn();
const shutdown = jest.fn(() => Promise.resolve());
const providerCtor = jest.fn();

jest.mock("@parse/node-apn", () => ({
  Provider: jest.fn().mockImplementation((opts: unknown) => {
    providerCtor(opts);
    return { send, shutdown };
  }),
  Notification: jest.fn().mockImplementation(function (
    this: Record<string, unknown>,
  ) {
    // a bare mutable object, like the real class
  }),
}));

const MSG: PushMessage = {
  title: "New exam: Môn học Mẫu Một",
  body: "Added to your calendar from DLU.",
  data: {
    notificationId: "n1",
    eventName: "exam.created",
    sessionId: "s1",
    url: "/calendar?session=s1",
  },
  tone: "default",
};

const FULL = {
  APNS_KEY: Buffer.from("-----BEGIN PRIVATE KEY-----\nk\n").toString("base64"),
  APNS_KEY_ID: "KEY123456",
  APNS_TEAM_ID: "TEAM123456",
  APNS_BUNDLE_ID: "com.zenflow.app",
  APNS_PRODUCTION: false,
};

async function make(env: Partial<typeof FULL>) {
  const config = {
    get: jest.fn((k: string) => (env as Record<string, unknown>)[k]),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [ApnsSender, { provide: ConfigService, useValue: config }],
  }).compile();
  return module.get<ApnsSender>(ApnsSender);
}

describe("ApnsSender", () => {
  afterEach(() => jest.clearAllMocks());

  it("is disabled unless all four APNS_* resolve", async () => {
    const sender = await make({
      APNS_KEY: FULL.APNS_KEY,
      APNS_KEY_ID: FULL.APNS_KEY_ID,
    });

    expect(sender.enabled).toBe(false);
    await expect(sender.send(["t1"], MSG)).resolves.toEqual({
      sent: 0,
      invalidTokens: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("enabled: builds the provider with token auth + decoded key", async () => {
    const sender = await make(FULL);

    expect(sender.enabled).toBe(true);
    const opts = providerCtor.mock.calls[0][0];
    expect(opts.token).toEqual({
      key: "-----BEGIN PRIVATE KEY-----\nk\n",
      keyId: "KEY123456",
      teamId: "TEAM123456",
    });
    expect(opts.production).toBe(false);
  });

  it("sends a notification carrying the bundle id as topic + alert + data", async () => {
    send.mockResolvedValue({ sent: [{ device: "t1" }], failed: [] });
    const sender = await make(FULL);

    const res = await sender.send(["t1"], MSG);

    expect(res).toEqual({ sent: 1, invalidTokens: [] });
    const [note, recipients] = send.mock.calls[0];
    expect(recipients).toEqual(["t1"]);
    expect(note.topic).toBe("com.zenflow.app");
    expect(note.alert).toEqual({ title: MSG.title, body: MSG.body });
    expect(note.sound).toBe("zenflow_default.wav");
    expect(note.payload).toEqual({
      notificationId: "n1",
      eventName: "exam.created",
      sessionId: "s1",
      url: "/calendar?session=s1",
    });
  });

  it("prunes tokens failed with 410 or an Unregistered/BadDeviceToken reason", async () => {
    send.mockResolvedValue({
      sent: [{ device: "ok" }],
      failed: [
        { device: "gone", status: 410 },
        { device: "unreg", status: 400, response: { reason: "Unregistered" } },
        { device: "bad", response: { reason: "BadDeviceToken" } },
        {
          device: "flaky",
          status: 429,
          response: { reason: "TooManyRequests" },
        },
      ],
    });
    const sender = await make(FULL);

    const res = await sender.send(["ok", "gone", "unreg", "bad", "flaky"], MSG);

    expect(res.invalidTokens.sort()).toEqual(["bad", "gone", "unreg"]);
  });

  it("swallows a thrown send", async () => {
    send.mockRejectedValue(new Error("http2 down"));
    const sender = await make(FULL);

    await expect(sender.send(["t1"], MSG)).resolves.toEqual({
      sent: 0,
      invalidTokens: [],
    });
  });

  it("shuts the provider down on module destroy", async () => {
    const sender = await make(FULL);
    await sender.onApplicationShutdown();
    expect(shutdown).toHaveBeenCalled();
  });
});
