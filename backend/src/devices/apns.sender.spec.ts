/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
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
    topic: "EXAM",
    kind: "NEW",
    sessionId: "s1",
    url: "/calendar?session=s1",
  },
};

const FULL = {
  APNS_KEY: Buffer.from("-----BEGIN PRIVATE KEY-----\nk\n").toString("base64"),
  APNS_KEY_ID: "KEY123456",
  APNS_TEAM_ID: "TEAM123456",
  APNS_BUNDLE_ID: "com.zenflow.app",
  APNS_PRODUCTION: false,
};

function make(env: Partial<typeof FULL>) {
  const config = {
    get: jest.fn((k: string) => (env as Record<string, unknown>)[k]),
  };
  return new ApnsSender(config as never);
}

describe("ApnsSender", () => {
  afterEach(() => jest.clearAllMocks());

  it("is disabled unless all four APNS_* resolve", async () => {
    const sender = make({
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

  it("enabled: builds the provider with token auth + decoded key", () => {
    const sender = make(FULL);

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
    const sender = make(FULL);

    const res = await sender.send(["t1"], MSG);

    expect(res).toEqual({ sent: 1, invalidTokens: [] });
    const [note, recipients] = send.mock.calls[0];
    expect(recipients).toEqual(["t1"]);
    expect(note.topic).toBe("com.zenflow.app");
    expect(note.alert).toEqual({ title: MSG.title, body: MSG.body });
    expect(note.payload).toEqual({
      notificationId: "n1",
      topic: "EXAM",
      kind: "NEW",
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
    const sender = make(FULL);

    const res = await sender.send(["ok", "gone", "unreg", "bad", "flaky"], MSG);

    expect(res.invalidTokens.sort()).toEqual(["bad", "gone", "unreg"]);
  });

  it("swallows a thrown send", async () => {
    send.mockRejectedValue(new Error("http2 down"));
    const sender = make(FULL);

    await expect(sender.send(["t1"], MSG)).resolves.toEqual({
      sent: 0,
      invalidTokens: [],
    });
  });

  it("shuts the provider down on module destroy", async () => {
    const sender = make(FULL);
    await sender.onModuleDestroy();
    expect(shutdown).toHaveBeenCalled();
  });
});
