/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { FcmSender } from "./fcm.sender";
import type { PushMessage } from "./types";

jest.mock("firebase-admin/app", () => ({
  initializeApp: jest.fn(() => ({ name: "zenflow-fcm" })),
  cert: jest.fn((x: unknown) => ({ _cert: x })),
  deleteApp: jest.fn(() => Promise.resolve()),
}));

const sendEachForMulticast = jest.fn();
jest.mock("firebase-admin/messaging", () => ({
  getMessaging: jest.fn(() => ({ sendEachForMulticast })),
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

/** base64 of a minimal service-account-shaped JSON. */
const FAKE_SA = Buffer.from(
  JSON.stringify({
    project_id: "demo",
    client_email: "x@y.z",
    private_key: "k",
  }),
).toString("base64");

function make(raw: string | undefined) {
  const config = { get: jest.fn().mockReturnValue(raw) };
  return new FcmSender(config as never);
}

describe("FcmSender", () => {
  afterEach(() => jest.clearAllMocks());

  it("is disabled with no FCM_SERVICE_ACCOUNT: no init, send is a no-op", async () => {
    const sender = make(undefined);

    expect(sender.enabled).toBe(false);
    expect(initializeApp).not.toHaveBeenCalled();
    await expect(sender.send(["t1"], MSG)).resolves.toEqual({
      sent: 0,
      invalidTokens: [],
    });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("is disabled when FCM_SERVICE_ACCOUNT is not valid base64 JSON", () => {
    const sender = make("not-base64-json!!!");
    expect(sender.enabled).toBe(false);
  });

  it("enabled: initializes a named app and sends title/body/data + high priority", async () => {
    sendEachForMulticast.mockResolvedValue({
      responses: [{ success: true }, { success: true }],
    });
    const sender = make(FAKE_SA);

    expect(sender.enabled).toBe(true);
    expect(cert).toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith(
      expect.anything(),
      "zenflow-fcm",
    );
    expect(getMessaging).toHaveBeenCalled();

    const res = await sender.send(["t1", "t2"], MSG);

    expect(res).toEqual({ sent: 2, invalidTokens: [] });
    const arg = sendEachForMulticast.mock.calls[0][0];
    expect(arg.tokens).toEqual(["t1", "t2"]);
    expect(arg.notification).toEqual({ title: MSG.title, body: MSG.body });
    expect(arg.data).toEqual({
      notificationId: "n1",
      topic: "EXAM",
      kind: "NEW",
      sessionId: "s1",
      url: "/calendar?session=s1",
    });
    expect(arg.android).toEqual({ priority: "high" });
  });

  it("collects only dead-token codes as invalid; logs the rest", async () => {
    sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true },
        {
          success: false,
          error: { code: "messaging/registration-token-not-registered" },
        },
        { success: false, error: { code: "messaging/internal-error" } },
      ],
    });
    const sender = make(FAKE_SA);

    const res = await sender.send(["good", "dead", "flaky"], MSG);

    expect(res.invalidTokens).toEqual(["dead"]);
  });

  it("chunks token lists over the 500 multicast limit", async () => {
    sendEachForMulticast.mockResolvedValue({ responses: [] });
    const sender = make(FAKE_SA);

    await sender.send(
      Array.from({ length: 501 }, (_, i) => `t${i}`),
      MSG,
    );

    expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(sendEachForMulticast.mock.calls[0][0].tokens).toHaveLength(500);
    expect(sendEachForMulticast.mock.calls[1][0].tokens).toHaveLength(1);
  });

  it("swallows a thrown multicast", async () => {
    sendEachForMulticast.mockRejectedValue(new Error("network"));
    const sender = make(FAKE_SA);

    await expect(sender.send(["t1"], MSG)).resolves.toEqual({
      sent: 0,
      invalidTokens: [],
    });
  });

  it("deletes the firebase app on module destroy", async () => {
    const sender = make(FAKE_SA);
    await sender.onModuleDestroy();
    expect(deleteApp).toHaveBeenCalled();
  });
});
