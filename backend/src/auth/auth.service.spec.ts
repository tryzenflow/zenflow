import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Cache } from "cache-manager";
import * as utils from "./utils";
import { MailerService } from "@nestjs-modules/mailer";
import { PrismaService } from "../prisma/prisma.service";
import { userFixture } from "../users/test-utils";

describe("AuthService", () => {
  let service: AuthService;
  let cacheManager: Cache;
  let usersService: UsersService;
  let mailService: MailService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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

    service = module.get<AuthService>(AuthService);
    cacheManager = module.get(CACHE_MANAGER);
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    prisma = module.get(PrismaService);
  });

  describe("requestOTPCode", () => {
    it("should generate OTP, store in cache, and send email", async () => {
      jest.spyOn(utils, "generateOTP").mockReturnValue("123456");
      jest.spyOn(mailService, "sendLoginEmail");

      await service.requestOTPCode("test@example.com");

      expect(utils.generateOTP).toHaveBeenCalled();
      expect(cacheManager.set).toHaveBeenCalledWith(
        "otp:test@example.com",
        "123456"
      );
      expect(mailService.sendLoginEmail).toHaveBeenCalledWith(
        "test@example.com",
        "123456"
      );
    });

    it("should throw InternalServerErrorException on failure", async () => {
      jest.spyOn(utils, "generateOTP").mockImplementation(() => {
        throw new Error("fail");
      });

      expect(service.requestOTPCode("test@example.com")).rejects.toThrow(
        InternalServerErrorException
      );
    });
  });

  describe("updateBasicInfo", () => {
    it("should update a user", async () => {
      const mockUser = { id: 1, email: "a@test.com" } as any;
      jest.spyOn(usersService, "update");
      jest.spyOn(prisma.user, "update").mockResolvedValue(mockUser);

      const dto = {
        name: "Foo",
        timezone: "UTC",
      };
      const result = await service.updateBasicInfo(mockUser.id, dto);

      expect(result).toEqual(mockUser);
      expect(usersService.update).toHaveBeenCalledWith(mockUser.id, dto);
    });

    it("should throw InternalServerErrorException on unexpected error", async () => {
      jest
        .spyOn(prisma.user, "update")
        .mockRejectedValue(new Error("some error"));

      expect(
        service.updateBasicInfo(1, { name: "Some name", timezone: "UTC" })
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("verifyOTPCode", () => {
    it("should delete OTP and return existing user if found", async () => {
      const mockedUser = userFixture({ email: "test@example.com" });
      jest.spyOn(cacheManager, "get").mockResolvedValue("654321");
      jest.spyOn(usersService, "findByEmail");
      jest.spyOn(usersService, "create");
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(mockedUser);

      const result = await service.verifyOTPCode("test@example.com", "654321");
      expect(result).toEqual({ isNewUser: false, user: mockedUser });
      expect(usersService.findByEmail).toHaveBeenCalledWith("test@example.com");
      expect(usersService.create).not.toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalledWith("otp:test@example.com");
    });

    it("should create a new user if not found", async () => {
      const mockedUser = userFixture({ email: "test@example.com" });
      jest.spyOn(cacheManager, "get").mockResolvedValue("654321");
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
      jest.spyOn(usersService, "create").mockResolvedValue(mockedUser);

      const result = await service.verifyOTPCode("test@example.com", "654321");
      expect(result).toEqual({ isNewUser: true, user: mockedUser });
      expect(usersService.create).toHaveBeenCalledWith({
        email: "test@example.com",
      });
      expect(cacheManager.del).toHaveBeenCalledWith("otp:test@example.com");
    });

    it("should throw NotFoundException if OTP not found", async () => {
      jest.spyOn(cacheManager, "get").mockResolvedValue(null);

      await expect(
        service.verifyOTPCode("test@example.com", "123456")
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException if the provided OTP is incorrect", async () => {
      jest.spyOn(cacheManager, "get").mockResolvedValue("654321");

      expect(
        service.verifyOTPCode("test@example.com", "123456")
      ).rejects.toThrow(BadRequestException);
      expect(cacheManager.del).not.toHaveBeenCalled();
    });

    it("should throw InternalServerErrorException on unexpected error", async () => {
      jest.spyOn(cacheManager, "get").mockRejectedValue(new Error("fail"));

      await expect(
        service.verifyOTPCode("test@example.com", "123456")
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
