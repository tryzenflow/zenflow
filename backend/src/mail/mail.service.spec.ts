import { Test, TestingModule } from "@nestjs/testing";
import { MailerService } from "@nestjs-modules/mailer";
import { MailService } from "./mail.service";

describe("MailService", () => {
  let service: MailService;
  const sendMail = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    sendMail.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MailerService, useValue: { sendMail } },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("sendLoginEmail", () => {
    it("sends the confirm-email template with the otp context", async () => {
      await service.sendLoginEmail("user@example.com", "123456");

      expect(sendMail).toHaveBeenCalledTimes(1);
      const payload = sendMail.mock.calls[0][0];
      expect(payload).toMatchObject({
        to: "user@example.com",
        subject: "Confirm your email account",
        template: "./confirm-email",
        context: { otp: "123456" },
      });
    });

    it("attaches the logo as an inline CID image", async () => {
      await service.sendLoginEmail("user@example.com", "123456");

      const payload = sendMail.mock.calls[0][0];
      expect(payload.attachments).toEqual([
        expect.objectContaining({
          filename: "logo.png",
          cid: "logo",
          path: expect.stringContaining("logo.png"),
        }),
      ]);
      // The CID attachment path must resolve into the templates/assets dir so
      // it works from dist at runtime.
      expect(payload.attachments[0].path).toContain("assets");
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
