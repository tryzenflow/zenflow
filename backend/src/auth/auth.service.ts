import type { Cache } from "cache-manager";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { generateOTP } from "./utils";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private usersService: UsersService,
    private mailService: MailService,
  ) {}

  async requestOTPCode(email: string) {
    try {
      const otpCode = generateOTP();
      await this.cacheManager.set(`otp:${email}`, otpCode);
      await this.mailService.sendLoginEmail(email, otpCode);
    } catch (error) {
      // Surface the real reason (SMTP auth failure, ECONNREFUSED, invalid
      // from address, template strict-mode error, …) instead of swallowing it.
      this.logger.error(
        `Failed to send OTP email to ${email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException({
        success: false,
        message: "Failed to send OTP code",
      });
    }
  }

  async createUserIfNotExists(email: string, timezone: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) return await this.usersService.create({ email, timezone });
    return user;
  }

  async verifyOTPCode(email: string, providedOtp: string) {
    try {
      const otpCode = await this.cacheManager.get<string | null>(
        `otp:${email}`,
      );
      if (!otpCode)
        throw new NotFoundException(
          "OTP Code is not found or may have been expired",
        );

      if (otpCode !== providedOtp) {
        throw new BadRequestException("Incorrect OTP provided");
      }
      await this.cacheManager.del(`otp:${email}`);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException();
    }
  }
}
