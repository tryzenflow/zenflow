import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import * as utils from "./utils";
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { MailerService } from "@nestjs-modules/mailer";
import { PrismaService } from "../prisma/prisma.service";

describe("AuthController (integration with AuthService)", () => {
  let controller: AuthController;
  let usersService: UsersService;
  let mailService: MailService;
  let cacheManager: Cache;
  let prisma: PrismaService;

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
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    cacheManager = module.get(CACHE_MANAGER);
    prisma = module.get(PrismaService);
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
    it("should delete OTP if found", async () => {
      jest.spyOn(cacheManager, "get").mockResolvedValue("999888");

      await controller.verifyOTP({
        email: "verify@example.com",
        providedOtp: "999888",
      });

      expect(cacheManager.del).toHaveBeenCalledWith("otp:verify@example.com");
    });

    it("should throw BadRequestException if OTP missing", async () => {
      jest.spyOn(cacheManager, "get").mockResolvedValue("123456");

      await expect(
        controller.verifyOTP({
          email: "missing@example.com",
          providedOtp: "654321",
        })
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException if OTP missing", async () => {
      jest.spyOn(cacheManager, "get").mockResolvedValue(null);

      await expect(
        controller.verifyOTP({
          email: "missing@example.com",
          providedOtp: "123456",
        })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("POST /auth/register", () => {
    it("should return existing user with isNewUser=false", async () => {
      const mockUser = { id: 1, email: "existing@test.com" } as any;
      jest.spyOn(usersService, "findByEmail");
      jest.spyOn(usersService, "create");
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(mockUser);

      await controller.register({
        email: "existing@test.com",
        timezone: "UTC",
      });

      expect(usersService.findByEmail).toHaveBeenCalledWith(
        "existing@test.com"
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it("should create a new user if not existing", async () => {
      const mockUser = { id: 2, email: "new@test.com" } as any;
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.user, "create").mockResolvedValue(mockUser);
      jest.spyOn(usersService, "findByEmail");
      jest.spyOn(usersService, "create");

      await controller.register({ email: "new@test.com", timezone: "UTC" });

      expect(usersService.create).toHaveBeenCalledWith({
        email: "new@test.com",
        timezone: "UTC",
      });
    });
  });
});
