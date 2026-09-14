import { Test, TestingModule } from "@nestjs/testing";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { User } from "../../generated/prisma";
import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";

const existingUser: User = {
  id: "user-existing",
  name: "Existing User",
  email: "existing@example.com",
  timezone: "UTC",
  lang: "EN_US",
  preferenceMatrix: [],
  preferenceMatrixDecayedAt: null,
  createdAt: new Date("2026-09-05T00:00:00.000Z"),
  updatedAt: new Date("2026-09-05T00:00:00.000Z"),
} as unknown as User;

describe("AuthService", () => {
  let service: AuthService;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let usersService: { findByEmail: jest.Mock; create: jest.Mock };
  let mailService: { sendLoginEmail: jest.Mock };

  beforeEach(async () => {
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    usersService = {
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(existingUser),
    };
    mailService = { sendLoginEmail: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe("requestOTPCode", () => {
    it("caches the generated OTP and emails it to the given address", async () => {
      await service.requestOTPCode("new@example.com");

      expect(cacheManager.set).toHaveBeenCalledWith(
        "otp:new@example.com",
        expect.any(String),
      );
      const [, cachedOtp] = cacheManager.set.mock.calls[0] as [string, string];
      expect(mailService.sendLoginEmail).toHaveBeenCalledWith(
        "new@example.com",
        cachedOtp,
      );
    });

    it("wraps a mail delivery failure in an InternalServerErrorException", async () => {
      mailService.sendLoginEmail.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.requestOTPCode("new@example.com")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("createUserIfNotExists", () => {
    it("creates a new user when none exists for the email", async () => {
      const result = await service.createUserIfNotExists(
        "new@example.com",
        "UTC",
      );

      expect(usersService.create).toHaveBeenCalledWith({
        email: "new@example.com",
        timezone: "UTC",
      });
      expect(result).toBe(existingUser);
    });

    it("returns the existing user without creating one when the email is already registered", async () => {
      usersService.findByEmail.mockResolvedValue(existingUser);

      const result = await service.createUserIfNotExists(
        "existing@example.com",
        "UTC",
      );

      expect(result).toBe(existingUser);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe("verifyOTPCode", () => {
    it("clears the cached OTP on a correct code", async () => {
      cacheManager.get.mockResolvedValue("123456");

      await service.verifyOTPCode("a@example.com", "123456");

      expect(cacheManager.del).toHaveBeenCalledWith("otp:a@example.com");
    });

    it("throws NotFoundException when no OTP is cached (missing/expired)", async () => {
      cacheManager.get.mockResolvedValue(null);

      await expect(
        service.verifyOTPCode("a@example.com", "123456"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException on a mismatched code", async () => {
      cacheManager.get.mockResolvedValue("123456");

      await expect(
        service.verifyOTPCode("a@example.com", "000000"),
      ).rejects.toThrow(BadRequestException);
    });

    it("wraps an unexpected cache failure in an InternalServerErrorException", async () => {
      cacheManager.get.mockRejectedValue(new Error("Redis down"));

      await expect(
        service.verifyOTPCode("a@example.com", "123456"),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
