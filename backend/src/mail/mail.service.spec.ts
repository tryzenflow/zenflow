import { Test, TestingModule } from "@nestjs/testing";
import { MailerService } from "@nestjs-modules/mailer";
import { MailService } from "./mail.service";
import { PrismaService } from "../prisma/prisma.service";

// `render` loads react-dom by dynamic import, which jest's CJS runtime rejects;
// the rendered markup is checked in the preview run instead.
jest.mock("@react-email/components", () => ({
  render: async (props: object) => JSON.stringify(props),
}));
jest.mock("./templates/confirm-email", () => ({
  ConfirmEmail: (props: object) => props,
}));

interface MailPayload {
  from?: string;
  attachments?: { path: string }[];
  [key: string]: unknown;
}

describe("MailService", () => {
  let service: MailService;
  const sendMail = jest.fn<Promise<void>, [MailPayload]>().mockResolvedValue();
  const findUnique = jest.fn().mockResolvedValue({ lang: "EN_US" });

  beforeEach(async () => {
    sendMail.mockClear();
    findUnique.mockClear();
    findUnique.mockResolvedValue({ lang: "EN_US" });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MailerService, useValue: { sendMail } },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique,
            },
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("sendLoginEmail", () => {
    it("uses Vietnamese subject and template copy for a Vietnamese recipient", async () => {
      findUnique.mockResolvedValue({ lang: "VI_VN" });
      await service.sendLoginEmail("user@example.com", "123456");
      expect(sendMail.mock.calls[0][0]).toMatchObject({
        subject: "Xác nhận địa chỉ email của bạn",
        html: expect.stringContaining("Xin chào,"),
      });
    });
    it("prefers the explicit language over the stored one, without a lookup", async () => {
      await service.sendLoginEmail(
        "new@example.com",
        "123456",
        undefined,
        "vi",
      );
      expect(findUnique).not.toHaveBeenCalled();
      expect(sendMail.mock.calls[0][0]).toMatchObject({
        subject: "Xác nhận địa chỉ email của bạn",
        html: expect.stringContaining('"language":"vi"'),
      });
    });
    it("sends the rendered confirm email with the otp", async () => {
      await service.sendLoginEmail("user@example.com", "123456");

      expect(sendMail).toHaveBeenCalledTimes(1);
      const payload = sendMail.mock.calls[0][0];
      expect(payload).toMatchObject({
        to: "user@example.com",
        subject: "Confirm your email account",
        html: expect.stringContaining("123456"),
        text: expect.stringContaining("123456"),
      });
    });

    it("attaches the logo as an inline CID image", async () => {
      await service.sendLoginEmail("user@example.com", "123456");

      const payload = sendMail.mock.calls[0][0];
      expect(payload.attachments).toEqual([
        expect.objectContaining({
          filename: "logo.png",
          cid: "logo",
          path: expect.stringContaining("logo.png") as string,
        }),
      ]);
      // The CID attachment path must resolve into the templates/assets dir so
      // it works from dist at runtime.
      expect(payload.attachments?.[0].path).toContain("assets");
    });

    it("forwards an explicit from address when provided", async () => {
      await service.sendLoginEmail("user@example.com", "123456", "x@y.z");

      expect(sendMail.mock.calls[0][0].from).toBe("x@y.z");
    });

    it("omits the from key entirely when none is provided so the transport default applies", async () => {
      await service.sendLoginEmail("user@example.com", "123456");

      // Must NOT be present (even as undefined) — nodemailer treats a present
      // `from` key as set and skips `defaults.from`, producing a mail with no
      // From header that Gmail rejects.
      expect("from" in sendMail.mock.calls[0][0]).toBe(false);
    });
  });
});
