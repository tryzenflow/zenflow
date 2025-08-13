import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import * as utils from "./utils";
import { InternalServerErrorException } from "@nestjs/common";
import { MailerService } from "@nestjs-modules/mailer";
import { PrismaService } from "../prisma/prisma.service";

describe("AuthController (integration with AuthService)", () => {
  let controller: AuthController;
  let mailService: MailService;
  let cacheManager: Cache;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        UsersService,
        MailService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findUniqueOrThrow: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: MailerService,
          useValue: {
            sendMail: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    mailService = module.get(MailService);
    cacheManager = module.get(CACHE_MANAGER);
  });

  describe("POST /auth/otp/request", () => {
    it("should generate OTP and send email", async () => {
      jest.spyOn(utils, "generateOTP").mockReturnValue("111222");
      jest.spyOn(mailService, "sendLoginEmail");

      await controller.requestOTP({ email: "test@example.com" });

      expect(cacheManager.set).toHaveBeenCalledWith(
        "otp:test@example.com",
        "111222"
      );
      expect(mailService.sendLoginEmail).toHaveBeenCalledWith(
        "test@example.com",
        "111222"
      );
    });

    it("should bubble up InternalServerErrorException if service fails", async () => {
      jest.spyOn(utils, "generateOTP").mockImplementation(() => {
        throw new Error("fail");
      });

      await expect(
        controller.requestOTP({ email: "err@example.com" })
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("POST /auth/otp/verify", () => {
    it("should return the logged in user", async () => {
      const mockUser = { id: 1, email: "existing@test.com" } as any;
      expect(await controller.verifyOTP(mockUser)).toEqual(mockUser);
    });
  });

  describe("POST /auth/logout", () => {
    it("should logout correctly", () => {
      const req = {
        logOut: jest.fn(),
        session: { cookie: { maxAge: 1248902 } },
      };
      jest.spyOn(req, "logOut");
      controller.logout(req as any);
      expect(req.logOut).toHaveBeenCalled();
      expect(req.session.cookie.maxAge).toBe(0) as any;
    });
  });
});
