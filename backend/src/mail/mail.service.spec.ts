import { Test, TestingModule } from "@nestjs/testing";
import { MailService } from "./mail.service";
import { MailerService } from "@nestjs-modules/mailer";
import { userFixture } from "../users/test-utils";
import { ConfigService } from "@nestjs/config";
import { User } from "../../generated/prisma";

describe("MailService", () => {
  let service: MailService;
  let mailer: MailerService;
  let user: User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: MailerService,
          useValue: { sendMail: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    mailer = module.get<MailerService>(MailerService);
    user = userFixture();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("sendConfirmationEmail", () => {
    it("should send confirmation email to the right recipient with correct payload", async () => {
      const otp = "123456";
      await service.sendLoginEmail(user.email, otp);
      expect(mailer.sendMail).toHaveBeenCalledWith({
        to: user.email,
        subject: "Confirm your email account",
        template: "./confirm-email",
        context: { otp },
      });
    });
  });
});
